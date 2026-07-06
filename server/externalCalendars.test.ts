import assert from "node:assert/strict";
import test from "node:test";
import { ExternalCalendarError, fetchExternalCalendarFeedContent, normalizeExternalCalendarFeedUrl, parseIcs, redactExternalCalendarFeedUrl } from "./services/externalCalendars.js";

const calendar = (event: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${event}\r\nEND:VCALENDAR\r\n`;
const event = (id: number, body = "SUMMARY:Import test") => [
  "BEGIN:VEVENT",
  `UID:test-${id}`,
  body,
  "DTSTART:20260501T090000Z",
  "DTEND:20260501T100000Z",
  "END:VEVENT"
].join("\r\n");

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

test("parses timed events and normalizes missing recurrence IDs", () => {
  const [event] = parseIcs(calendar("BEGIN:VEVENT\r\nUID:test-2\r\nSUMMARY:Timed\r\nDTSTART:20260501T090000Z\r\nDTEND:20260501T100000Z\r\nEND:VEVENT"));
  assert.equal(event?.allDay, false);
  assert.equal(event?.recurrenceId, "");
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
});

test("fetches external calendar feeds with generic errors and size limits", async () => {
  const validCalendar = calendar(event(10));
  const successfulFetch: typeof fetch = async () => new Response(validCalendar, {
    status: 200,
    headers: { "content-length": String(Buffer.byteLength(validCalendar, "utf8")) }
  });
  assert.equal(
    await fetchExternalCalendarFeedContent("https://calendar.example.net/private.ics?token=RAW_PRIVATE_TOKEN", successfulFetch),
    validCalendar
  );

  await assert.rejects(
    () => fetchExternalCalendarFeedContent("https://calendar.example.net/private.ics?token=RAW_PRIVATE_TOKEN", async () => new Response("", { status: 403 })),
    (error: unknown) => {
      assert.ok(error instanceof ExternalCalendarError);
      assert.equal(error.code, "external_calendar_fetch_failed");
      assert.doesNotMatch(error.message, /RAW_PRIVATE_TOKEN|calendar\.example\.net/);
      return true;
    }
  );

  await assert.rejects(
    () => fetchExternalCalendarFeedContent("https://calendar.example.net/large.ics", async () => new Response("", {
      status: 200,
      headers: { "content-length": "1000001" }
    })),
    (error: unknown) => error instanceof ExternalCalendarError && error.code === "external_calendar_limit"
  );
});
