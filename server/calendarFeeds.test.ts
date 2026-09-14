import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "betreuungskalender-calendar-feeds-"));
process.env.DATABASE_PATH = join(temporaryDirectory, "test.sqlite");
process.env.BACKUP_DIR = join(temporaryDirectory, "backups");

const { runMigrations } = await import("./db/migrate.js");
const { persistence } = await import("./db/connection.js");
const { requireSqlitePersistenceRuntime } = await import("./db/runtime.js");
const {
  buildPersonalCalendarFeed,
  isCalendarFeedProcessingLimitError
} = await import("./services/calendarFeeds.js");
const db = requireSqlitePersistenceRuntime(persistence).sqliteDatabase;

runMigrations();

const token = {
  id: "feed-token-test",
  user_id: "local-dev",
  external_subject: "local-dev",
  display_name: "Local Development",
  role: "admin" as const,
  scope_type: "legacy" as const,
  scope_party_id: null,
  scope_party_name: null,
  created_at: "2026-07-01T10:00:00.000Z",
  last_used_at: null
};

function resetDatabase(): void {
  db.transaction(() => {
    db.prepare("DELETE FROM care_entry_children").run();
    db.prepare("DELETE FROM care_entries").run();
    db.prepare("DELETE FROM children").run();
  })();
}

function insertFeedEntry(id: string): void {
  const timestamp = "2026-07-01T10:00:00.000Z";
  db.prepare(`
    INSERT INTO care_entries (
      id, start_datetime, end_datetime, status, care_scope,
      overnight, school_handover, holiday, weekend, additional_care,
      duration_minutes, is_contact_time, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, 'planned', 'hourly', 0, 0, 0, 0, 0, 120, 0, 'local-dev', 'local-dev', ?, ?)
  `).run(id, "2026-07-02T16:00:00.000Z", "2026-07-02T18:00:00.000Z", timestamp, timestamp);
}

function linkChildren(entryId: string, count: number): void {
  const timestamp = "2026-07-01T10:00:00.000Z";
  const insertChild = db.prepare(`
    INSERT INTO children (
      id, name, birth_month, birth_year, color, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, 1, 2018, '#087f7b', 'local-dev', 'local-dev', ?, ?)
  `);
  const insertLink = db.prepare(`
    INSERT INTO care_entry_children (care_entry_id, child_id, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  for (let index = 0; index < count; index += 1) {
    const childId = `feed-child-${index}`;
    insertChild.run(childId, `Testkind ${index + 1}`, timestamp, timestamp);
    insertLink.run(entryId, childId, timestamp, timestamp);
  }
}

beforeEach(resetDatabase);

after(async () => {
  await persistence.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("builds an empty personal calendar within the configured limits", async () => {
  const calendar = await buildPersonalCalendarFeed({
    token,
    database: persistence.query,
    generatedAt: "2026-07-03T08:00:00.000Z",
    limits: { maximumEntries: 1, maximumChildLinks: 1, maximumBytes: 2048 }
  });

  assert.match(calendar, /^BEGIN:VCALENDAR\r\n/);
  assert.match(calendar, /END:VCALENDAR\r\n$/);
  assert.doesNotMatch(calendar, /BEGIN:VEVENT/);
});

test("accepts the exact calendar entry limit and rejects one entry over it", async () => {
  insertFeedEntry("feed-entry-a");
  const exact = await buildPersonalCalendarFeed({
    token,
    database: persistence.query,
    generatedAt: "2026-07-03T08:00:00.000Z",
    limits: { maximumEntries: 1, maximumChildLinks: 1, maximumBytes: 4096 }
  });
  assert.equal(exact.match(/BEGIN:VEVENT/g)?.length, 1);

  insertFeedEntry("feed-entry-b");
  await assert.rejects(
    buildPersonalCalendarFeed({
      token,
      database: persistence.query,
      generatedAt: "2026-07-03T08:00:00.000Z",
      limits: { maximumEntries: 1, maximumChildLinks: 1, maximumBytes: 4096 }
    }),
    isCalendarFeedProcessingLimitError
  );
});

test("rejects calendar output that exceeds the byte budget", async () => {
  insertFeedEntry("feed-entry-a");

  await assert.rejects(
    buildPersonalCalendarFeed({
      token,
      database: persistence.query,
      generatedAt: "2026-07-03T08:00:00.000Z",
      limits: { maximumEntries: 1, maximumChildLinks: 1, maximumBytes: 128 }
    }),
    isCalendarFeedProcessingLimitError
  );
});

test("accepts the exact child-link limit and rejects one link over it", async () => {
  insertFeedEntry("feed-entry-a");
  linkChildren("feed-entry-a", 2);

  const exact = await buildPersonalCalendarFeed({
    token,
    database: persistence.query,
    limits: { maximumEntries: 1, maximumChildLinks: 2, maximumBytes: 4096 }
  });
  assert.match(exact, /Testkind 1 und Testkind 2/);

  await assert.rejects(
    buildPersonalCalendarFeed({
      token,
      database: persistence.query,
      limits: { maximumEntries: 1, maximumChildLinks: 1, maximumBytes: 4096 }
    }),
    isCalendarFeedProcessingLimitError
  );
});
