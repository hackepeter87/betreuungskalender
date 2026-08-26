import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import test from "node:test";
import Database from "better-sqlite3";
import type { ApiCareConflictList, ApiCareConflictPreview, ApiCareEntry, ApiCareParty, ApiChild } from "../shared/api.js";
import {
  CareConflictDetectionLimitError,
  CareEntryConflictError,
  assertNoActualCareConflict,
  detectCareConflicts,
  previewPlannedCareConflicts
} from "./services/careConflicts.js";

const projectRoot = resolve(import.meta.dirname, "..");

function entry(overrides: Partial<Parameters<typeof detectCareConflicts>[0][number]> = {}) {
  return {
    id: "entry-a",
    status: "planned" as const,
    startDateTime: "2026-07-04T16:00:00.000Z",
    endDateTime: "2026-07-04T18:00:00.000Z",
    childIds: ["child-a"],
    ...overrides
  };
}

test("detects planned overlaps and merges shared child context", () => {
  const conflicts = detectCareConflicts([
    entry({ childIds: ["child-a", "child-b"] }),
    entry({ id: "entry-b", startDateTime: "2026-07-04T17:00:00.000Z", childIds: ["child-a", "child-b"] })
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]?.severity, "planned_warning");
  assert.deepEqual(conflicts[0]?.entryIds, ["entry-a", "entry-b"]);
  assert.deepEqual(conflicts[0]?.childIds, ["child-a", "child-b"]);
  assert.equal(conflicts[0]?.startDateTime, "2026-07-04T17:00:00.000Z");
  assert.equal(conflicts[0]?.endDateTime, "2026-07-04T18:00:00.000Z");
});

test("uses actual children and time for partial-care conflicts", () => {
  const conflicts = detectCareConflicts([
    entry({
      status: "partial",
      actualStartDateTime: "2026-07-04T17:00:00.000Z",
      actualEndDateTime: "2026-07-04T19:00:00.000Z",
      actualChildIds: ["child-b"]
    }),
    entry({
      id: "entry-b",
      status: "completed",
      startDateTime: "2026-07-04T18:00:00.000Z",
      endDateTime: "2026-07-04T20:00:00.000Z",
      childIds: ["child-b"]
    })
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]?.severity, "unresolved_actual");
  assert.deepEqual(conflicts[0]?.childIds, ["child-b"]);
  assert.equal(conflicts[0]?.startDateTime, "2026-07-04T18:00:00.000Z");
  assert.equal(conflicts[0]?.endDateTime, "2026-07-04T19:00:00.000Z");
});

test("ignores adjacent, cancelled, and different-child entries", () => {
  const conflicts = detectCareConflicts([
    entry({ status: "completed" }),
    entry({
      id: "entry-adjacent",
      status: "completed",
      startDateTime: "2026-07-04T18:00:00.000Z",
      endDateTime: "2026-07-04T20:00:00.000Z"
    }),
    entry({ id: "entry-cancelled", status: "cancelled" }),
    entry({ id: "entry-other-child", status: "completed", childIds: ["child-b"] })
  ]);
  assert.deepEqual(conflicts, []);
});

test("stops conflict materialization at the configured result budget", () => {
  const denseEntries = Array.from({ length: 20 }, (_, index) => entry({
    id: `entry-${index}`
  }));
  assert.throws(
    () => detectCareConflicts(denseEntries, { maxConflicts: 25 }),
    CareConflictDetectionLimitError
  );
  assert.equal(
    detectCareConflicts(denseEntries.slice(0, 5), { maxConflicts: 25 }).length,
    10
  );
});

test("actual conflict validation only considers matching children and times", () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE care_entries (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      start_datetime TEXT NOT NULL,
      end_datetime TEXT NOT NULL,
      actual_start_datetime TEXT,
      actual_end_datetime TEXT,
      deleted_at TEXT
    );
    CREATE TABLE care_entry_children (
      care_entry_id TEXT NOT NULL,
      child_id TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE care_entry_actual_children (
      care_entry_id TEXT NOT NULL,
      child_id TEXT NOT NULL,
      deleted_at TEXT
    );
  `);
  const insertEntry = database.prepare(`
    INSERT INTO care_entries (
      id, status, start_datetime, end_datetime,
      actual_start_datetime, actual_end_datetime, deleted_at
    ) VALUES (?, 'completed', ?, ?, NULL, NULL, NULL)
  `);
  const insertChild = database.prepare(`
    INSERT INTO care_entry_children (care_entry_id, child_id, deleted_at)
    VALUES (?, ?, NULL)
  `);
  database.transaction(() => {
    for (let index = 0; index < 1_100; index += 1) {
      const id = `unrelated-${index}`;
      insertEntry.run(id, "2026-07-04T16:00:00.000Z", "2026-07-04T18:00:00.000Z");
      insertChild.run(id, "child-b");
    }
  })();

  const candidate = entry({ id: "candidate", status: "completed", childIds: ["child-a"] });
  assert.doesNotThrow(() => assertNoActualCareConflict(candidate, database));

  insertEntry.run("matching", "2026-07-04T17:00:00.000Z", "2026-07-04T19:00:00.000Z");
  insertChild.run("matching", "child-a");
  assert.throws(
    () => assertNoActualCareConflict(candidate, database),
    CareEntryConflictError
  );

  database.prepare("DELETE FROM care_entry_children WHERE care_entry_id = 'matching'").run();
  database.prepare("DELETE FROM care_entries WHERE id = 'matching'").run();
  insertEntry.run("offset-matching", "2026-07-04T16:30:00.000Z", "2026-07-04T17:30:00.000Z");
  insertChild.run("offset-matching", "child-a");
  assert.throws(
    () => assertNoActualCareConflict(entry({
      id: "offset-candidate",
      status: "completed",
      childIds: ["child-a"],
      startDateTime: "2026-07-04T18:00:00+02:00",
      endDateTime: "2026-07-04T19:00:00+02:00"
    }), database),
    CareEntryConflictError
  );
  database.close();
});

test("planned conflict previews are stable and change with the candidate range", () => {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE care_entries (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, start_datetime TEXT NOT NULL,
      end_datetime TEXT NOT NULL, actual_start_datetime TEXT,
      actual_end_datetime TEXT, deleted_at TEXT
    );
    CREATE TABLE care_entry_children (care_entry_id TEXT, child_id TEXT, deleted_at TEXT);
    CREATE TABLE care_entry_actual_children (care_entry_id TEXT, child_id TEXT, deleted_at TEXT);
    INSERT INTO care_entries VALUES (
      'existing', 'planned', '2026-07-04T17:00:00.000Z',
      '2026-07-04T19:00:00.000Z', NULL, NULL, NULL
    );
    INSERT INTO care_entry_children VALUES ('existing', 'child-a', NULL);
  `);
  const first = previewPlannedCareConflicts({
    status: "planned",
    startDateTime: "2026-07-04T16:00:00.000Z",
    endDateTime: "2026-07-04T18:00:00.000Z",
    childIds: ["child-a"]
  }, database);
  const repeated = previewPlannedCareConflicts({
    status: "planned",
    startDateTime: "2026-07-04T16:00:00.000Z",
    endDateTime: "2026-07-04T18:00:00.000Z",
    childIds: ["child-a"]
  }, database);
  const changed = previewPlannedCareConflicts({
    status: "planned",
    startDateTime: "2026-07-04T15:00:00.000Z",
    endDateTime: "2026-07-04T18:00:00.000Z",
    childIds: ["child-a"]
  }, database);
  assert.equal(first.conflicts.length, 1);
  assert.equal(first.fingerprint, repeated.fingerprint);
  assert.notEqual(first.fingerprint, changed.fingerprint);
  database.close();
});

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  server.close();
  await once(server, "close");
  return address.port;
}

async function waitForHealth(url: string, logs: () => string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Runtime is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  throw new Error(`Runtime did not become healthy.\n${logs()}`);
}

async function stop(process: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([
    once(process, "exit"),
    new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 5_000))
  ]);
  if (process.exitCode === null) process.kill("SIGKILL");
}

async function jsonRequest<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) {
    assert.fail(`${response.status} ${await response.text()}`);
  }
  return await response.json() as T;
}

test("care-entry API serializes actual writes and returns generic conflicts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "betreuungskalender-care-conflicts-"));
  const port = await freePort();
  let logs = "";
  const runtime = spawn(
    process.execPath,
    [resolve(projectRoot, "node_modules/tsx/dist/cli.mjs"), "server/index.ts"],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: "development",
        AUTH_MODE: "local",
        REQUIRE_AUTH: "false",
        HOST: "127.0.0.1",
        PORT: String(port),
        DATABASE_PATH: join(root, "app.sqlite"),
        BACKUP_DIR: join(root, "backups"),
        RATE_LIMIT_MAX: "200",
        RATE_LIMIT_WRITE_MAX: "200",
        LOG_LEVEL: "warn"
      }
    }
  );
  runtime.stdout.on("data", (chunk) => { logs += chunk; });
  runtime.stderr.on("data", (chunk) => { logs += chunk; });
  t.after(async () => {
    await stop(runtime);
    await rm(root, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(`${baseUrl}/api/health`, () => logs);
  const child = await jsonRequest<ApiChild>(baseUrl, "/api/children", {
    method: "POST",
    body: JSON.stringify({ name: "Testkind A", birthMonth: 7, birthYear: 2018, color: "#0d9488" })
  });
  const otherChild = await jsonRequest<ApiChild>(baseUrl, "/api/children", {
    method: "POST",
    body: JSON.stringify({ name: "Testkind B", birthMonth: 8, birthYear: 2020, color: "#6967d9" })
  });
  const party = await jsonRequest<ApiCareParty>(baseUrl, "/api/care-parties", {
    method: "POST",
    body: JSON.stringify({ name: "Testbetreuung", kind: "other" })
  });
  const baseInput = {
    startDateTime: "2026-07-04T16:00:00.000Z",
    endDateTime: "2026-07-04T18:00:00.000Z",
    childIds: [child.id],
    responsiblePartyId: party.id,
    status: "completed",
    careScope: "hourly",
    overnight: false,
    schoolHandover: false,
    holiday: false,
    weekend: true,
    additionalCare: false,
    hasEvidence: false,
    trips: [],
    costs: []
  };

  const concurrent = await Promise.all([
    fetch(`${baseUrl}/api/care-entries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(baseInput) }),
    fetch(`${baseUrl}/api/care-entries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(baseInput) })
  ]);
  assert.deepEqual(concurrent.map((response) => response.status).sort(), [201, 409]);
  const rejected = concurrent.find((response) => response.status === 409);
  assert.deepEqual(await rejected?.json(), { error: "care_entry_conflict" });

  const rejectedPlanned = await fetch(`${baseUrl}/api/care-entries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...baseInput, status: "planned" })
  });
  assert.equal(rejectedPlanned.status, 409);
  assert.equal((await rejectedPlanned.json() as { error: string }).error, "planned_care_conflict_confirmation_required");
  const preview = await jsonRequest<ApiCareConflictPreview>(baseUrl, "/api/care-conflicts/preview", {
    method: "POST",
    body: JSON.stringify({ ...baseInput, status: "planned" })
  });
  assert.equal(preview.items.length, 1);
  const planned = await jsonRequest<ApiCareEntry>(baseUrl, "/api/care-entries", {
    method: "POST",
    body: JSON.stringify({
      ...baseInput,
      status: "planned",
      confirmPlannedConflict: true,
      conflictFingerprint: preview.fingerprint
    })
  });
  const conflicts = await jsonRequest<ApiCareConflictList>(baseUrl, "/api/care-conflicts");
  assert.equal(conflicts.complete, true);
  assert.equal(conflicts.items.length, 1);
  assert.equal(conflicts.items[0]?.severity, "planned_warning");
  assert.equal(conflicts.items[0]?.entryIds.includes(planned.id), true);

  const actualUpdate = await fetch(`${baseUrl}/api/care-entries/${planned.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...baseInput, status: "completed" })
  });
  assert.equal(actualUpdate.status, 409);
  assert.deepEqual(await actualUpdate.json(), { error: "care_entry_conflict" });

  const resolutionDatabase = new Database(join(root, "app.sqlite"));
  resolutionDatabase.prepare(`
    UPDATE care_entries
    SET contact_rule_id = 'test-rule', contact_rule_sync_state = 'generated'
    WHERE id = ?
  `).run(planned.id);
  resolutionDatabase.close();
  const resolved = await jsonRequest<ApiCareEntry>(baseUrl, "/api/care-conflicts/resolve", {
    method: "POST",
    body: JSON.stringify({
      conflictId: conflicts.items[0]!.id,
      entryId: planned.id,
      action: "replace_rule_occurrence"
    })
  });
  assert.equal(resolved.status, "cancelled");
  assert.equal(resolved.contactRuleSyncState, "manual_override");

  await jsonRequest<ApiCareEntry>(baseUrl, "/api/care-entries", {
    method: "POST",
    body: JSON.stringify({
      ...baseInput,
      startDateTime: "2026-07-04T18:00:00.000Z",
      endDateTime: "2026-07-04T20:00:00.000Z"
    })
  });
  await jsonRequest<ApiCareEntry>(baseUrl, "/api/care-entries", {
    method: "POST",
    body: JSON.stringify({ ...baseInput, childIds: [otherChild.id] })
  });

  const direct = new Database(join(root, "app.sqlite"));
  const insertDenseEntry = direct.prepare(`
    INSERT INTO care_entries (
      id, start_datetime, end_datetime, status, care_scope,
      duration_minutes, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, 'planned', 'hourly', 120, 'test', 'test', ?, ?)
  `);
  const insertDenseChild = direct.prepare(`
    INSERT INTO care_entry_children (
      care_entry_id, child_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?)
  `);
  const timestamp = "2030-01-01T00:00:00.000Z";
  direct.transaction(() => {
    for (let index = 0; index < 102; index += 1) {
      const id = `dense-${index}`;
      insertDenseEntry.run(
        id,
        "2030-01-01T16:00:00.000Z",
        "2030-01-01T18:00:00.000Z",
        timestamp,
        timestamp
      );
      insertDenseChild.run(id, child.id, timestamp, timestamp);
    }
  })();
  direct.close();

  const limited = await jsonRequest<ApiCareConflictList>(baseUrl, "/api/care-conflicts");
  assert.equal(limited.complete, false);
  assert.deepEqual(limited.items, []);
});
