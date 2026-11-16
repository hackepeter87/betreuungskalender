import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { gzipSync } from "node:zlib";
import { createSqlitePersistenceRuntime, type PersistenceRuntime } from "./db/runtime.js";
import {
  ExternalCalendarError,
  type ExternalCalendarFetchDependencies,
  deriveHolidayPeriodsFromExternalCalendar,
  fetchExternalCalendarFeedContent,
  importExternalCalendar,
  listExternalCalendarBackupEvents,
  listExternalCalendarSources,
  normalizeExternalCalendarFeedUrl,
  parseIcs,
  redactExternalCalendarFeedUrl,
  visibleExternalCalendarEvents
} from "./services/externalCalendars.js";
import { config } from "./config.js";
import { externalCalendarRoutes } from "./routes/externalCalendars.js";

const calendar = (event: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${event}\r\nEND:VCALENDAR\r\n`;
const event = (id: number, body = "SUMMARY:Import test") => [
  "BEGIN:VEVENT",
  `UID:test-${id}`,
  body,
  "DTSTART:20260501T090000Z",
  "DTEND:20260501T100000Z",
  "END:VEVENT"
].join("\r\n");

async function withRuntime(run: (runtime: PersistenceRuntime) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "betreuungskalender-external-calendar-"));
  const runtime = createSqlitePersistenceRuntime(
    join(root, "app.sqlite"),
    resolve(process.cwd(), "server/migrations")
  );
  try {
    await runtime.migrate();
    await run(runtime);
  } finally {
    await runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function assertExternalCalendarError(
  action: () => unknown,
  code: ExternalCalendarError["code"]
): void {
  assert.throws(action, (error: unknown) =>
    error instanceof ExternalCalendarError && error.code === code);
}

test("parses all-day events with exclusive DTEND and escaped text", () => {
  const [event] = parseIcs(calendar("BEGIN:VEVENT\r\nUID:test-1\r\nSUMMARY:Spring\\, break\r\nDESCRIPTION:Line one\\nLine two\r\nDTSTART;VALUE=DATE:20260403\r\nDTEND;VALUE=DATE:20260406\r\nEND:VEVENT"));
  assert.equal(event?.allDay, true);
  assert.equal(event?.icalUid, "test-1");
  assert.equal(event?.title, "Spring, break");
  assert.equal(event?.startDateTime, "2026-04-03T00:00:00.000Z");
  assert.equal(event?.endDateTime, "2026-04-06T00:00:00.000Z");
});

test("external calendar export is not cacheable", async () => {
  await withRuntime(async (runtime) => {
    const app = Fastify({ logger: false });
    app.decorate("persistence", runtime);
    await app.register(externalCalendarRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/api/external-calendar-events/export"
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store, max-age=0");
    assert.equal(response.headers.pragma, "no-cache");
    await app.close();
  });
});

test("parses timed events and normalizes missing recurrence IDs", () => {
  const [event] = parseIcs(calendar("BEGIN:VEVENT\r\nUID:test-2\r\nSUMMARY:Timed\r\nDTSTART:20260501T090000Z\r\nDTEND:20260501T100000Z\r\nEND:VEVENT"));
  assert.equal(event?.allDay, false);
  assert.equal(event?.recurrenceId, "");
  assert.ok(event);
  assert.equal(Object.hasOwn(event, "description"), false);
  assert.equal(Object.hasOwn(event, "location"), false);
});

test("rejects malformed calendars and unsupported recurrence rules", () => {
  assertExternalCalendarError(() => parseIcs("BEGIN:VEVENT\nEND:VEVENT"), "external_calendar_invalid");
  assertExternalCalendarError(() => parseIcs(calendar("BEGIN:VEVENT\r\nUID:test-3\r\nDTSTART:20260501T090000Z\r\nDTEND:20260501T100000Z\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT")), "external_calendar_recurrence_unsupported");
});

test("enforces calendar file size and event count limits", () => {
  assertExternalCalendarError(() => parseIcs(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${"x".repeat(1_000_001)}\r\nEND:VCALENDAR\r\n`), "external_calendar_limit");

  const manyEvents = Array.from({ length: 2_001 }, (_, index) => event(index)).join("\r\n");
  assertExternalCalendarError(() => parseIcs(calendar(manyEvents)), "external_calendar_limit");
});

test("bounds individual and aggregate external calendar event lifetimes", () => {
  assertExternalCalendarError(
    () => parseIcs(calendar([
      "BEGIN:VEVENT",
      "UID:too-long",
      "SUMMARY:Long event",
      "DTSTART;VALUE=DATE:20260101",
      "DTEND;VALUE=DATE:20270103",
      "END:VEVENT"
    ].join("\r\n"))),
    "external_calendar_limit"
  );

  const denseCalendar = Array.from({ length: 101 }, (_, index) => [
    "BEGIN:VEVENT",
    `UID:dense-${index}`,
    "SUMMARY:Bounded event",
    "DTSTART;VALUE=DATE:20260101",
    "DTEND;VALUE=DATE:20260721",
    "END:VEVENT"
  ].join("\r\n")).join("\r\n");
  assertExternalCalendarError(() => parseIcs(calendar(denseCalendar)), "external_calendar_limit");
});

test("rejects invalid event dates and excessive text fields with generic errors", () => {
  const rawMarker = "RAW_PRIVATE_MARKER_DO_NOT_LEAK";
  assert.throws(
    () => parseIcs(calendar(`BEGIN:VEVENT\r\nUID:${rawMarker}\r\nSUMMARY:Bad dates\r\nDTSTART:20260501T100000Z\r\nDTEND:20260501T090000Z\r\nEND:VEVENT`)),
    (error: unknown) => {
      assert.ok(error instanceof ExternalCalendarError);
      assert.equal(error.code, "external_calendar_invalid");
      assert.doesNotMatch(error.message, new RegExp(rawMarker));
      return true;
    }
  );

  assert.throws(
    () => parseIcs(calendar(event(4, `SUMMARY:${"A".repeat(501)}`))),
    (error: unknown) => {
      assert.ok(error instanceof ExternalCalendarError);
      assert.equal(error.code, "external_calendar_limit");
      assert.doesNotMatch(error.message, /AAAAA/);
      return true;
    }
  );

  assertExternalCalendarError(
    () => parseIcs(calendar(event(5, `SUMMARY:Valid\r\nDESCRIPTION:${"B".repeat(10_001)}`))),
    "external_calendar_limit"
  );
  assertExternalCalendarError(
    () => parseIcs(calendar(event(6, `SUMMARY:Valid\r\nLOCATION:${"C".repeat(501)}`))),
    "external_calendar_limit"
  );
});

test("treats HTML and special characters in imported calendar text as data", () => {
  const [parsed] = parseIcs(calendar([
    "BEGIN:VEVENT",
    "UID:test-html",
    "SUMMARY:<script>alert(1)</script> & family event",
    "DESCRIPTION:<b>bold</b>\\nLine two\\, with comma",
    "LOCATION:<img src=x onerror=alert(1)>",
    "DTSTART:20260501T090000Z",
    "DTEND:20260501T100000Z",
    "END:VEVENT"
  ].join("\r\n")));

  assert.equal(parsed?.title, "<script>alert(1)</script> & family event");
  assert.equal(parsed?.description, "<b>bold</b>\nLine two, with comma");
  assert.equal(parsed?.location, "<img src=x onerror=alert(1)>");
});

test("validates and redacts external calendar feed URLs", () => {
  assert.equal(
    normalizeExternalCalendarFeedUrl(" https://calendar.example.net/remote.php/dav/calendars/demo/private.ics?token=secret#fragment "),
    "https://calendar.example.net/remote.php/dav/calendars/demo/private.ics?token=secret"
  );
  assert.equal(
    redactExternalCalendarFeedUrl("https://calendar.example.net/remote.php/dav/calendars/demo/private.ics?token=secret"),
    "https://calendar.example.net/remote.php/dav/calendars/demo/private.ics?..."
  );
  assertExternalCalendarError(() => normalizeExternalCalendarFeedUrl("http://calendar.example.net/private.ics"), "external_calendar_invalid");
  assertExternalCalendarError(() => normalizeExternalCalendarFeedUrl("https://user:secret@calendar.example.net/private.ics"), "external_calendar_invalid");
  assertExternalCalendarError(() => normalizeExternalCalendarFeedUrl("https://localhost/private.ics"), "external_calendar_invalid");
  assertExternalCalendarError(() => normalizeExternalCalendarFeedUrl("https://192.168.1.10/private.ics"), "external_calendar_invalid");
  assertExternalCalendarError(() => normalizeExternalCalendarFeedUrl("https://[::ffff:169.254.169.254]/private.ics"), "external_calendar_invalid");
  for (const address of ["0.0.0.0", "100.64.0.1", "192.0.2.1", "224.0.0.1", "::", "::1", "2001:db8::1", "fe80::1", "fd00::1"]) {
    assertExternalCalendarError(
      () => normalizeExternalCalendarFeedUrl(`https://${address.includes(":") ? `[${address}]` : address}/private.ics`),
      "external_calendar_invalid"
    );
  }
});

function response(
  body: string | AsyncIterable<Uint8Array>,
  options: { statusCode?: number; headers?: Record<string, string | undefined> } = {}
) {
  return {
    statusCode: options.statusCode ?? 200,
    headers: options.headers ?? {},
    body: typeof body === "string"
      ? (async function* () { yield Buffer.from(body); })()
      : body,
    cancel() {}
  };
}

function dependencies(
  request: ExternalCalendarFetchDependencies["request"],
  resolve: ExternalCalendarFetchDependencies["resolve"] = async () => [
    { address: "93.184.216.34", family: 4 }
  ]
): ExternalCalendarFetchDependencies {
  return { request, resolve, timeoutMs: 100 };
}

test("fetches valid external calendar feeds with pinned public addresses", async () => {
  const validCalendar = calendar(event(10));
  const requested: Array<{ url: string; address: string }> = [];
  assert.equal(
    await fetchExternalCalendarFeedContent(
      "https://calendar.example.net/private.ics?token=RAW_PRIVATE_TOKEN",
      dependencies(async (url, address) => {
        requested.push({ url: url.href, address: address.address });
        return response(validCalendar, {
          headers: { "content-length": String(Buffer.byteLength(validCalendar, "utf8")) }
        });
      })
    ),
    validCalendar
  );
  assert.deepEqual(requested, [{
    url: "https://calendar.example.net/private.ics?token=RAW_PRIVATE_TOKEN",
    address: "93.184.216.34"
  }]);

  const compressedCalendar = gzipSync(validCalendar);
  assert.equal(
    await fetchExternalCalendarFeedContent(
      "https://calendar.example.net/compressed.ics",
      dependencies(async () => response((async function* () {
        yield compressedCalendar;
      })(), { headers: { "content-encoding": "gzip" } }))
    ),
    validCalendar
  );
});

test("rejects non-public and mixed DNS results before requesting a feed", async () => {
  let requested = false;
  const request: ExternalCalendarFetchDependencies["request"] = async () => {
    requested = true;
    return response("");
  };
  await assert.rejects(
    () => fetchExternalCalendarFeedContent(
      "https://calendar.example.net/private.ics",
      dependencies(request, async () => [{ address: "127.0.0.1", family: 4 }])
    ),
    (error: unknown) => error instanceof ExternalCalendarError && error.code === "external_calendar_fetch_failed"
  );
  await assert.rejects(
    () => fetchExternalCalendarFeedContent(
      "https://calendar.example.net/private.ics",
      dependencies(request, async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "::ffff:10.0.0.5", family: 6 }
      ])
    ),
    (error: unknown) => error instanceof ExternalCalendarError && error.code === "external_calendar_fetch_failed"
  );
  assert.equal(requested, false);
});

test("validates every redirect and limits redirect chains", async () => {
  const redirecting = dependencies(async () => response("", {
    statusCode: 302,
    headers: { location: "https://127.0.0.1/private.ics" }
  }));
  await assert.rejects(
    () => fetchExternalCalendarFeedContent("https://calendar.example.net/start.ics", redirecting),
    (error: unknown) => error instanceof ExternalCalendarError && error.code === "external_calendar_fetch_failed"
  );

  let requests = 0;
  const looping = dependencies(async (url) => {
    requests += 1;
    return response("", {
      statusCode: 302,
      headers: { location: `/redirect-${requests}.ics` }
    });
  });
  await assert.rejects(
    () => fetchExternalCalendarFeedContent("https://calendar.example.net/start.ics", looping),
    (error: unknown) => error instanceof ExternalCalendarError && error.code === "external_calendar_fetch_failed"
  );
  assert.equal(requests, 6);
});

test("returns generic feed errors without URL details", async () => {
  await assert.rejects(
    () => fetchExternalCalendarFeedContent(
      "https://calendar.example.net/private.ics?token=RAW_PRIVATE_TOKEN",
      dependencies(async () => response("", { statusCode: 403 }))
    ),
    (error: unknown) => {
      assert.ok(error instanceof ExternalCalendarError);
      assert.equal(error.code, "external_calendar_fetch_failed");
      assert.doesNotMatch(error.message, /RAW_PRIVATE_TOKEN|calendar\.example\.net/);
      return true;
    }
  );
});

test("enforces streamed feed size limits without Content-Length", async () => {
  const oversizedBody = (async function* () {
    yield Buffer.alloc(750_000, "A");
    yield Buffer.alloc(300_001, "B");
  })();
  await assert.rejects(
    () => fetchExternalCalendarFeedContent(
      "https://calendar.example.net/large.ics",
      dependencies(async () => response(oversizedBody))
    ),
    (error: unknown) => error instanceof ExternalCalendarError && error.code === "external_calendar_limit"
  );
});

test("aborts feed retrieval when the whole-operation timeout expires", async () => {
  let aborted = false;
  await assert.rejects(
    () => fetchExternalCalendarFeedContent(
      "https://calendar.example.net/slow.ics",
      {
        resolve: async () => [{ address: "93.184.216.34", family: 4 }],
        timeoutMs: 5,
        request: async (_url, _address, signal) => new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(signal.reason);
          }, { once: true });
        })
      }
    ),
    (error: unknown) => error instanceof ExternalCalendarError && error.code === "external_calendar_fetch_failed"
  );
  assert.equal(aborted, true);

  await assert.rejects(
    () => fetchExternalCalendarFeedContent(
      "https://calendar.example.net/slow-body.ics",
      {
        resolve: async () => [{ address: "93.184.216.34", family: 4 }],
        timeoutMs: 5,
        request: async () => response((async function* () {
          await new Promise(() => undefined);
        })())
      }
    ),
    (error: unknown) => error instanceof ExternalCalendarError && error.code === "external_calendar_fetch_failed"
  );
});

test("persists normalized events and derives inclusive holiday periods atomically", async () => {
  await withRuntime(async (runtime) => {
    const timestamp = "2026-04-01T10:00:00.000Z";
    await runtime.query.insertInto("children").values({
      id: "child-calendar-test",
      name: "Testkind",
      birth_month: 4,
      birth_year: 2018,
      color: "#087f7b",
      created_by: "tester",
      updated_by: "tester",
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null
    }).execute();
    const content = calendar([
      "BEGIN:VEVENT",
      "UID:holiday-test",
      "SUMMARY:Fiktive Frühlingsferien",
      "DTSTART;VALUE=DATE:20260403",
      "DTEND;VALUE=DATE:20260406",
      "END:VEVENT"
    ].join("\r\n"));

    const imported = await importExternalCalendar(runtime, {
      name: "Fiktiver Ferienkalender",
      color: "#f2b134",
      sourceType: "holiday",
      content
    });
    const sources = await listExternalCalendarSources(runtime.query);
    const events = await listExternalCalendarBackupEvents(runtime.query);
    const visible = await visibleExternalCalendarEvents(
      runtime.query,
      "2026-04-01T00:00:00.000Z",
      "2026-04-10T00:00:00.000Z"
    );
    const derived = await deriveHolidayPeriodsFromExternalCalendar(runtime, imported.source.id, {
      childIds: ["child-calendar-test"],
      assignedTo: "shared",
      userEmail: "tester"
    });
    const repeated = await deriveHolidayPeriodsFromExternalCalendar(runtime, imported.source.id, {
      childIds: ["child-calendar-test"],
      assignedTo: "shared",
      userEmail: "tester"
    });

    assert.equal(sources.length, 1);
    assert.equal(events.length, 1);
    assert.equal(visible.length, 1);
    assert.deepEqual(
      [derived.created, derived.holidays[0]?.startDate, derived.holidays[0]?.endDate],
      [1, "2026-04-03", "2026-04-05"]
    );
    assert.deepEqual(derived.holidays[0]?.childIds, ["child-calendar-test"]);
    assert.deepEqual([repeated.created, repeated.skippedExisting], [0, 1]);
  });
});

test("rolls back event replacement when the target source does not exist", async () => {
  await withRuntime(async (runtime) => {
    await assert.rejects(
      importExternalCalendar(runtime, {
        name: "Nicht vorhandene Quelle",
        color: "#087f7b",
        sourceType: "overlay",
        content: calendar(event(99))
      }, "missing-source"),
      (error: unknown) => error instanceof ExternalCalendarError && error.code === "external_calendar_not_found"
    );
    assert.equal((await listExternalCalendarSources(runtime.query)).length, 0);
    assert.equal((await listExternalCalendarBackupEvents(runtime.query)).length, 0);
  });
});

function privatePolicy(t: TestContext, addresses = ["10.77.0.10"]): void {
  const previous = Object.getOwnPropertyDescriptor(config, "externalCalendarPrivateTargets")!;
  Object.defineProperty(config, "externalCalendarPrivateTargets", {
    ...previous, value: [{ hostname: "calendar.example.test", addresses }]
  });
  t.after(() => { Object.defineProperty(config, "externalCalendarPrivateTargets", previous); });
}

// Synthetic private-unicast fixtures; no deployment destinations.
test("exact private calendar policy permits only the configured host/address pair", async (t) => {
  privatePolicy(t);
  let requests = 0;
  const request: ExternalCalendarFetchDependencies["request"] = async (url, address) => {
    requests += 1;
    assert.equal(url.hostname, "calendar.example.test");
    assert.equal(address.address, "10.77.0.10");
    return response(calendar(event(42)));
  };
  assert.equal(await fetchExternalCalendarFeedContent("https://calendar.example.test/feed.ics",
    dependencies(request, async () => [{ address: "10.77.0.10", family: 4 }])) , calendar(event(42)));
  for (const url of ["https://other.example.test/feed.ics", "https://calendar.example.test:8443/feed.ics",
    "https://10.77.0.10/feed.ics", "http://calendar.example.test/feed.ics"]) {
    await assert.rejects(fetchExternalCalendarFeedContent(url,
      dependencies(request, async () => [{ address: "10.77.0.10", family: 4 }])));
  }
  for (const addresses of [[], ["10.77.0.11"], ["10.77.0.10", "10.77.0.11"],
    ["10.77.0.10", "192.0.2.10"], ["192.0.2.10"], ["127.0.0.1"], ["169.254.1.1"]]) {
    await assert.rejects(fetchExternalCalendarFeedContent("https://calendar.example.test/feed.ics",
      dependencies(request, async () => addresses.map(address => ({ address, family: 4 })))));
  }
  // A configured host may not silently fall back to an otherwise public answer.
  await assert.rejects(fetchExternalCalendarFeedContent("https://calendar.example.test/feed.ics",
    dependencies(request)));
  await assert.rejects(fetchExternalCalendarFeedContent("https://calendar.example.test./feed.ics",
    dependencies(async () => response("must not bypass the configured host policy"))));
  // The exception does not restrict unrelated public feeds.
  assert.equal(await fetchExternalCalendarFeedContent("https://public.example.test/feed.ics",
    dependencies(async () => response("public feed"))), "public feed");
  assert.equal(requests, 1);
});

test("private calendar redirects are checked again and never reuse DNS approval", async (t) => {
  privatePolicy(t);
  const requested: string[] = [];
  const deps = dependencies(async (url, address) => {
    requested.push(address.address);
    return url.pathname === "/start" ? response("", { statusCode: 302, headers: { location: "/feed" } }) : response("feed");
  }, async () => [{ address: "10.77.0.10", family: 4 }]);
  assert.equal(await fetchExternalCalendarFeedContent("https://calendar.example.test/start", deps), "feed");
  assert.deepEqual(requested, ["10.77.0.10", "10.77.0.10"]);
  for (const location of ["https://other.example.test/feed", "https://10.77.0.10/feed",
    "http://calendar.example.test/feed", "https://calendar.example.test:8443/feed"]) {
    let calls = 0;
    await assert.rejects(fetchExternalCalendarFeedContent("https://calendar.example.test/start",
      dependencies(async () => { calls++; return response("", { statusCode: 302, headers: { location } }); },
        async () => [{ address: "10.77.0.10", family: 4 }])));
    assert.equal(calls, 1);
  }
  let resolutions = 0;
  let calls = 0;
  await assert.rejects(fetchExternalCalendarFeedContent("https://calendar.example.test/start", dependencies(
    async () => { calls++; return response("", { statusCode: 302, headers: { location: "/feed" } }); },
    async () => [{ address: ++resolutions === 1 ? "10.77.0.10" : "10.77.0.11", family: 4 }])));
  assert.equal(calls, 1);
  assert.equal(resolutions, 2);
});

test("default HTTPS transport keeps the approved address pinned and the DNS hostname intact", async (t) => {
  const https = await import("node:https");
  const dns = await import("node:dns/promises");
  const { syncBuiltinESMExports } = await import("node:module");
  const { EventEmitter } = await import("node:events");
  const { Readable } = await import("node:stream");
  privatePolicy(t);
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  let resolutions = 0;
  t.mock.method(dns.default, "lookup", async () => {
    resolutions++;
    return [{ address: resolutions === 1 ? "10.77.0.10" : "10.77.0.11", family: 4 }];
  });
  t.mock.method(https.default, "request", (url: URL, options: import("node:https").RequestOptions,
    callback: (response: import("node:http").IncomingMessage) => void) => {
    assert.equal(url.hostname, "calendar.example.test");
    assert.equal(options.rejectUnauthorized, undefined); // Node's certificate validation stays enabled.
    assert.equal(options.servername, undefined); // Node derives SNI/verification from the original URL.
    assert.ok(options.lookup);
    options.lookup(url.hostname, {}, (error, address, family) => {
      assert.equal(error, null);
      assert.equal(address, "10.77.0.10");
      assert.equal(family, 4);
    });
    options.lookup(url.hostname, { all: true }, (error, addresses) => {
      assert.equal(error, null);
      assert.deepEqual(addresses, [{ address: "10.77.0.10", family: 4 }]);
    });
    const stream = Object.assign(Readable.from([Buffer.from("synthetic feed")]), { statusCode: 200, headers: {} });
    const request = Object.assign(new EventEmitter(), { end() {
      queueMicrotask(() => callback(stream as import("node:http").IncomingMessage));
    } });
    return request;
  });
  syncBuiltinESMExports();
  assert.equal(await fetchExternalCalendarFeedContent("https://calendar.example.test/feed"), "synthetic feed");
  assert.equal(resolutions, 1);
});

test("approved private feed failures expose no transport credentials or calendar content", async (t) => {
  privatePolicy(t);
  const secretUrl = "https://calendar.example.test/PRIVATE_PATH?token=PRIVATE_TOKEN";
  await assert.rejects(fetchExternalCalendarFeedContent(secretUrl, dependencies(async () => {
    throw new Error(`${secretUrl} PRIVATE_CONTENT PRIVATE_PASSWORD`);
  }, async () => [{ address: "10.77.0.10", family: 4 }])), (error: unknown) => {
    assert.ok(error instanceof ExternalCalendarError);
    assert.equal(error.message, "Calendar feed could not be fetched.");
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(JSON.stringify(error) + error.stack, /PRIVATE_|calendar\.example\.test/);
    return true;
  });
});


test("exact private policy supports canonical IPv6 ULA and multiple approved answers", async (t) => {
  privatePolicy(t, ["fd12:3456::10", "10.77.0.10"]);
  assert.equal(await fetchExternalCalendarFeedContent("https://calendar.example.test/feed", dependencies(
    async (_url, address) => { assert.equal(address.family, 6); return response("feed"); },
    async () => [{ address: "fd12:3456:0:0:0:0:0:10", family: 6 }, { address: "10.77.0.10", family: 4 }]
  )), "feed");
  for (const address of ["fd12:3456::11", "::ffff:10.77.0.10", "fe80::1%eth0", "::1"]) {
    await assert.rejects(fetchExternalCalendarFeedContent("https://calendar.example.test/feed", dependencies(
      async () => { assert.fail("unapproved IPv6 must not reach transport"); },
      async () => [{ address, family: 6 }]
    )));
  }
});

test("public redirects may enter only an explicitly approved private calendar destination", async (t) => {
  privatePolicy(t);
  const publicResolve = dependencies(async () => response("")).resolve;
  const requested: string[] = [];
  assert.equal(await fetchExternalCalendarFeedContent("https://public.example.test/start", dependencies(
    async (url) => {
      requested.push(url.hostname);
      return url.hostname === "public.example.test"
        ? response("", { statusCode: 302, headers: { location: "https://calendar.example.test/feed" } })
        : response("feed");
    }, async hostname => hostname === "calendar.example.test"
      ? [{ address: "10.77.0.10", family: 4 }] : publicResolve(hostname)
  )), "feed");
  assert.deepEqual(requested, ["public.example.test", "calendar.example.test"]);
});

test("feed route errors and request diagnostics do not expose private URL or content", async (t) => {
  const dns = await import("node:dns/promises");
  const https = await import("node:https");
  const { syncBuiltinESMExports } = await import("node:module");
  const { Writable } = await import("node:stream");
  const { LogController } = await import("fastify");
  const { installRequestDiagnostics, logRedactionPaths } = await import("./logging.js");
  privatePolicy(t);
  t.mock.method(dns.default, "lookup", async () => [{ address: "10.77.0.10", family: 4 }]);
  t.mock.method(https.default, "request", () => {
    throw new Error("https://calendar.example.test/PRIVATE_PATH?token=PRIVATE_TOKEN PRIVATE_CONTENT PRIVATE_PASSWORD");
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await withRuntime(async runtime => {
    let logs = "";
    const stream = new Writable({ write(chunk, _encoding, callback) { logs += String(chunk); callback(); } });
    const app = Fastify({
      logController: new LogController({ disableRequestLogging: true }),
      logger: { stream, redact: { paths: [...logRedactionPaths], censor: "[redacted]" } }
    });
    app.decorate("persistence", runtime);
    installRequestDiagnostics(app);
    await app.register(externalCalendarRoutes);
    try {
      const result = await app.inject({ method: "POST", url: "/api/external-calendars/feed", payload: {
        name: "Synthetic calendar", color: "#087f7b", sourceType: "overlay",
        url: "https://calendar.example.test/PRIVATE_PATH?token=PRIVATE_TOKEN"
      } });
      assert.equal(result.statusCode, 400);
      assert.deepEqual(result.json(), { error: "external_calendar_fetch_failed" });
      assert.ok(logs.length > 0);
      assert.doesNotMatch(result.body + logs, /PRIVATE_|calendar\.example\.test/);
    } finally { await app.close(); }
  });
});
