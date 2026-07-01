import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { migrateDatabase } from "./db/migrationRunner.js";
import {
  expandContactRule,
  syncContactRule,
  upsertContactRuleFromPattern
} from "./services/contactRules.js";

const migrationsDirectory = resolve(process.cwd(), "server/migrations");
const timestamp = "2026-07-01T10:00:00.000Z";

function withDatabase(run: (database: Database.Database) => void): void {
  const root = mkdtempSync(join(tmpdir(), "betreuungskalender-contact-rules-"));
  const database = new Database(join(root, "app.sqlite"));
  database.pragma("foreign_keys = ON");
  try {
    migrateDatabase(database, migrationsDirectory);
    run(database);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function insertChild(database: Database.Database, id = "child-a", name = "Testkind"): void {
  database.prepare(`
    INSERT INTO children (
      id, name, birth_month, birth_year, color, created_by, updated_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    7,
    2018,
    "#087f7b",
    "tester",
    "tester",
    timestamp,
    timestamp
  );
}

function insertLegacyPattern(database: Database.Database): void {
  database.prepare(`
    INSERT INTO contact_patterns (
      id, name, start_date, frequency, friday_start_time, sunday_end_time,
      active, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "pattern-a",
    "14-Tage-Regel",
    "2026-07-03",
    "biweekly",
    "16:00",
    "18:00",
    1,
    "tester",
    "tester",
    timestamp,
    timestamp
  );
}

test("expands weekly recurrence with multiple weekdays and local time segments", () => {
  const entries = expandContactRule({
    startDate: "2026-07-01",
    active: true,
    childIds: ["child-a"],
    rangeStart: "2026-07-01",
    rangeEnd: "2026-07-10",
    recurrence: {
      kind: "weekly",
      intervalWeeks: 1,
      weekdays: ["WE", "FR"]
    },
    segments: [
      {
        id: "after-school",
        startDayOffset: 0,
        startTime: "15:00",
        endDayOffset: 0,
        endTime: "18:00"
      }
    ]
  });

  assert.deepEqual(
    entries.map((entry) => [entry.occurrenceDate, entry.startDateTime, entry.endDateTime]),
    [
      ["2026-07-01", "2026-07-01T15:00", "2026-07-01T18:00"],
      ["2026-07-03", "2026-07-03T15:00", "2026-07-03T18:00"],
      ["2026-07-08", "2026-07-08T15:00", "2026-07-08T18:00"],
      ["2026-07-10", "2026-07-10T15:00", "2026-07-10T18:00"]
    ]
  );
});

test("expands monthly ordinal weekday recurrence including last Friday", () => {
  const entries = expandContactRule({
    startDate: "2026-07-01",
    active: true,
    childIds: ["child-a"],
    rangeStart: "2026-07-01",
    rangeEnd: "2026-09-30",
    recurrence: {
      kind: "monthlyByWeekday",
      intervalMonths: 1,
      ordinals: [-1],
      weekdays: ["FR"]
    },
    segments: [
      {
        id: "weekend",
        startDayOffset: 0,
        startTime: "16:00",
        endDayOffset: 2,
        endTime: "18:00"
      }
    ]
  });

  assert.deepEqual(
    entries.map((entry) => [entry.occurrenceDate, entry.endDateTime]),
    [
      ["2026-07-31", "2026-08-02T18:00"],
      ["2026-08-28", "2026-08-30T18:00"],
      ["2026-09-25", "2026-09-27T18:00"]
    ]
  );
});

test("sync creates planned entries from a legacy pattern and does not duplicate them", () => {
  withDatabase((database) => {
    insertChild(database);
    insertLegacyPattern(database);
    const rule = upsertContactRuleFromPattern({
      id: "pattern-a",
      name: "14-Tage-Regel",
      startDate: "2026-07-03",
      fridayStartTime: "16:00",
      sundayEndTime: "18:00",
      childIds: ["child-a"],
      active: true,
      createdBy: "tester",
      updatedBy: "tester",
      createdAt: timestamp,
      updatedAt: timestamp
    }, database);

    const first = syncContactRule(rule.id, {
      database,
      userEmail: "tester",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      now: timestamp
    });
    const second = syncContactRule(rule.id, {
      database,
      userEmail: "tester",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      now: timestamp
    });

    assert.equal(first.created, 3);
    assert.equal(second.created, 0);
    const rows = database.prepare(`
      SELECT start_datetime AS startDateTime, end_datetime AS endDateTime,
        contact_rule_id AS contactRuleId, contact_rule_sync_state AS syncState
      FROM care_entries
      WHERE deleted_at IS NULL
      ORDER BY start_datetime
    `).all() as Array<{
      startDateTime: string;
      endDateTime: string;
      contactRuleId: string;
      syncState: string;
    }>;
    assert.deepEqual(
      rows.map((row) => [row.startDateTime, row.endDateTime, row.contactRuleId, row.syncState]),
      [
        ["2026-07-03T16:00", "2026-07-05T18:00", "pattern-a", "generated"],
        ["2026-07-17T16:00", "2026-07-19T18:00", "pattern-a", "generated"],
        ["2026-07-31T16:00", "2026-08-02T18:00", "pattern-a", "generated"]
      ]
    );
  });
});

test("sync preserves manually changed generated entries", () => {
  withDatabase((database) => {
    insertChild(database);
    insertLegacyPattern(database);
    upsertContactRuleFromPattern({
      id: "pattern-a",
      name: "14-Tage-Regel",
      startDate: "2026-07-03",
      fridayStartTime: "16:00",
      sundayEndTime: "18:00",
      childIds: ["child-a"],
      active: true,
      createdBy: "tester",
      updatedBy: "tester",
      createdAt: timestamp,
      updatedAt: timestamp
    }, database);
    syncContactRule("pattern-a", {
      database,
      userEmail: "tester",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      now: timestamp
    });

    database.prepare(`
      UPDATE care_entries
      SET status = 'completed', contact_rule_sync_state = 'manual_override',
          start_datetime = '2026-07-03T17:00'
      WHERE rule_occurrence_date = '2026-07-03'
    `).run();
    const summary = syncContactRule("pattern-a", {
      database,
      userEmail: "tester",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      now: timestamp
    });

    assert.equal(summary.preserved, 1);
    const changed = database.prepare(`
      SELECT status, start_datetime AS startDateTime, contact_rule_sync_state AS syncState
      FROM care_entries
      WHERE rule_occurrence_date = '2026-07-03'
    `).get() as { status: string; startDateTime: string; syncState: string };
    assert.deepEqual(changed, {
      status: "completed",
      startDateTime: "2026-07-03T17:00",
      syncState: "manual_override"
    });
  });
});

test("sync preserves cancelled generated entries as exceptions", () => {
  withDatabase((database) => {
    insertChild(database);
    insertLegacyPattern(database);
    upsertContactRuleFromPattern({
      id: "pattern-a",
      name: "14-Tage-Regel",
      startDate: "2026-07-03",
      fridayStartTime: "16:00",
      sundayEndTime: "18:00",
      childIds: ["child-a"],
      active: true,
      createdBy: "tester",
      updatedBy: "tester",
      createdAt: timestamp,
      updatedAt: timestamp
    }, database);
    syncContactRule("pattern-a", {
      database,
      userEmail: "tester",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      now: timestamp
    });

    database.prepare(`
      UPDATE care_entries
      SET status = 'cancelled', cancellation_reason = 'Fiktive Testabsage'
      WHERE rule_occurrence_date = '2026-07-17'
    `).run();
    const summary = syncContactRule("pattern-a", {
      database,
      userEmail: "tester",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      now: timestamp
    });

    assert.equal(summary.preserved, 1);
    const cancelled = database.prepare(`
      SELECT status, cancellation_reason AS cancellationReason, contact_rule_sync_state AS syncState
      FROM care_entries
      WHERE rule_occurrence_date = '2026-07-17'
    `).get() as { status: string; cancellationReason: string; syncState: string };
    assert.deepEqual(cancelled, {
      status: "cancelled",
      cancellationReason: "Fiktive Testabsage",
      syncState: "generated"
    });
  });
});

test("sync updates child assignments for unchanged planned entries", () => {
  withDatabase((database) => {
    insertChild(database);
    insertChild(database, "child-b", "Zweites Testkind");
    insertLegacyPattern(database);
    upsertContactRuleFromPattern({
      id: "pattern-a",
      name: "14-Tage-Regel",
      startDate: "2026-07-03",
      fridayStartTime: "16:00",
      sundayEndTime: "18:00",
      childIds: ["child-a"],
      active: true,
      createdBy: "tester",
      updatedBy: "tester",
      createdAt: timestamp,
      updatedAt: timestamp
    }, database);
    syncContactRule("pattern-a", {
      database,
      userEmail: "tester",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      now: timestamp
    });

    upsertContactRuleFromPattern({
      id: "pattern-a",
      name: "14-Tage-Regel",
      startDate: "2026-07-03",
      fridayStartTime: "16:00",
      sundayEndTime: "18:00",
      childIds: ["child-b"],
      active: true,
      createdBy: "tester",
      updatedBy: "tester",
      createdAt: timestamp,
      updatedAt: timestamp
    }, database);
    syncContactRule("pattern-a", {
      database,
      userEmail: "tester",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      now: timestamp
    });

    const rows = database.prepare(`
      SELECT child_id AS childId, deleted_at AS deletedAt
      FROM care_entry_children
      WHERE care_entry_id = (
        SELECT id FROM care_entries WHERE rule_occurrence_date = '2026-07-03'
      )
      ORDER BY child_id
    `).all() as Array<{ childId: string; deletedAt: string | null }>;
    assert.equal(rows.find((row) => row.childId === "child-a")?.deletedAt, timestamp);
    assert.equal(rows.find((row) => row.childId === "child-b")?.deletedAt, null);
  });
});
