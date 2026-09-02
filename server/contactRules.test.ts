import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { migrateDatabase } from "./db/migrationRunner.js";
import { createSqlitePersistenceRuntime, type DatabaseExecutor } from "./db/runtime.js";
import {
  isContactRuleSyncPreviewChangedError,
  expandContactRule as expandContactRuleOnServer,
  previewContactRuleSync,
  syncContactRule,
  upsertContactRule,
  upsertContactRuleFromPattern
} from "./services/contactRules.js";
import { expandContactRule as expandContactRuleInClient } from "../src/lib/contactRules.js";
import { expandContactRule } from "../shared/contactRuleExpansion.js";
import { contactRuleInputSchema } from "./validation/schemas.js";

const migrationsDirectory = resolve(process.cwd(), "server/migrations");
const timestamp = "2026-07-01T10:00:00.000Z";

async function withDatabase(
  run: (database: Database.Database, persistence: DatabaseExecutor) => Promise<void> | void
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "betreuungskalender-contact-rules-"));
  const database = new Database(join(root, "app.sqlite"));
  database.pragma("foreign_keys = ON");
  const runtime = createSqlitePersistenceRuntime(database);
  try {
    migrateDatabase(database, migrationsDirectory);
    await run(database, runtime.query);
  } finally {
    await runtime.close();
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

test("client and server expose the shared contact-rule expansion", () => {
  assert.equal(expandContactRuleInClient, expandContactRule);
  assert.equal(expandContactRuleOnServer, expandContactRule);
});

test("shared contact-rule expansion handles recurrence and range boundaries deterministically", () => {
  const cases = [
    {
      name: "weekly recurrence across a leap day",
      input: {
        startDate: "2024-02-23",
        active: true,
        childIds: ["child-a"],
        rangeStart: "2024-02-28",
        rangeEnd: "2024-03-08",
        recurrence: { kind: "weekly" as const, intervalWeeks: 1, weekdays: ["FR" as const] },
        segments: [{
          id: "weekend",
          startDayOffset: 0,
          startTime: "16:00",
          endDayOffset: 2,
          endTime: "18:00"
        }]
      },
      expected: [
        ["2024-03-01", "2024-03-01:weekend", "2024-03-03T18:00"],
        ["2024-03-08", "2024-03-08:weekend", "2024-03-10T18:00"]
      ]
    },
    {
      name: "monthly weekday recurrence at a month boundary",
      input: {
        startDate: "2026-01-01",
        active: true,
        childIds: ["child-a"],
        rangeStart: "2026-01-01",
        rangeEnd: "2026-03-31",
        recurrence: {
          kind: "monthlyByWeekday" as const,
          intervalMonths: 1,
          ordinals: [-1 as const],
          weekdays: ["TU" as const]
        },
        segments: [{
          id: "day",
          startDayOffset: 0,
          startTime: "10:00",
          endDayOffset: 0,
          endTime: "18:00"
        }]
      },
      expected: [
        ["2026-01-27", "2026-01-27:day", "2026-01-27T18:00"],
        ["2026-02-24", "2026-02-24:day", "2026-02-24T18:00"],
        ["2026-03-31", "2026-03-31:day", "2026-03-31T18:00"]
      ]
    },
    {
      name: "multiple RRULE lines retain stable rule indexes",
      input: {
        startDate: "2026-07-01",
        active: true,
        childIds: ["child-a"],
        rangeStart: "2026-07-01",
        rangeEnd: "2026-07-31",
        recurrence: {
          kind: "rrule" as const,
          rrules: ["FREQ=MONTHLY;BYMONTHDAY=15", "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1"]
        },
        segments: [{
          id: "day",
          startDayOffset: 0,
          startTime: "10:00",
          endDayOffset: 0,
          endTime: "18:00"
        }]
      },
      expected: [
        ["2026-07-15", "2026-07-15:r0:day", "2026-07-15T18:00"],
        ["2026-07-31", "2026-07-31:r1:day", "2026-07-31T18:00"]
      ]
    }
  ];

  for (const fixture of cases) {
    assert.deepEqual(
      expandContactRule(fixture.input).map((entry) => [
        entry.occurrenceDate,
        entry.occurrenceKey,
        entry.endDateTime
      ]),
      fixture.expected,
      fixture.name
    );
  }
});

test("shared contact-rule expansion rejects invalid segment offsets", () => {
  assert.throws(
    () => expandContactRule({
      startDate: "2026-07-01",
      active: true,
      childIds: ["child-a"],
      rangeStart: "2026-07-01",
      rangeEnd: "2026-07-10",
      recurrence: { kind: "weekly", intervalWeeks: 1, weekdays: ["WE"] },
      segments: [{
        id: "invalid",
        startDayOffset: 2,
        startTime: "10:00",
        endDayOffset: 1,
        endTime: "18:00"
      }]
    }),
    RangeError
  );
});

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

test("expands RRULE weekly recurrence with interval and multiple weekdays", () => {
  const entries = expandContactRule({
    startDate: "2026-07-01",
    active: true,
    childIds: ["child-a"],
    rangeStart: "2026-07-01",
    rangeEnd: "2026-07-21",
    recurrence: {
      kind: "rrule",
      rrules: ["FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"]
    },
    segments: [
      {
        id: "afternoon",
        startDayOffset: 0,
        startTime: "15:00",
        endDayOffset: 0,
        endTime: "18:00"
      }
    ]
  });

  assert.deepEqual(
    entries.map((entry) => [entry.occurrenceDate, entry.occurrenceKey]),
    [
      ["2026-07-01", "2026-07-01:r0:afternoon"],
      ["2026-07-13", "2026-07-13:r0:afternoon"],
      ["2026-07-15", "2026-07-15:r0:afternoon"]
    ]
  );
});

test("expands RRULE monthly day and nth weekday schedule lines", () => {
  const entries = expandContactRule({
    startDate: "2026-07-01",
    active: true,
    childIds: ["child-a"],
    rangeStart: "2026-07-01",
    rangeEnd: "2026-09-30",
    recurrence: {
      kind: "rrule",
      rrules: [
        "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15",
        "FREQ=MONTHLY;INTERVAL=1;BYDAY=FR;BYSETPOS=-1"
      ]
    },
    segments: [
      {
        id: "day",
        startDayOffset: 0,
        startTime: "10:00",
        endDayOffset: 0,
        endTime: "18:00"
      }
    ]
  });

  assert.deepEqual(
    entries.map((entry) => [entry.occurrenceDate, entry.occurrenceKey]),
    [
      ["2026-07-15", "2026-07-15:r0:day"],
      ["2026-07-31", "2026-07-31:r1:day"],
      ["2026-08-15", "2026-08-15:r0:day"],
      ["2026-08-28", "2026-08-28:r1:day"],
      ["2026-09-15", "2026-09-15:r0:day"],
      ["2026-09-25", "2026-09-25:r1:day"]
    ]
  );
});

test("expands RRULE with count and preserves local dates across DST boundary", () => {
  const entries = expandContactRule({
    startDate: "2026-10-23",
    active: true,
    childIds: ["child-a"],
    rangeStart: "2026-10-01",
    rangeEnd: "2026-11-30",
    recurrence: {
      kind: "rrule",
      rrules: ["FREQ=WEEKLY;COUNT=3;BYDAY=FR"]
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
    entries.map((entry) => [entry.startDateTime, entry.endDateTime]),
    [
      ["2026-10-23T16:00", "2026-10-25T18:00"],
      ["2026-10-30T16:00", "2026-11-01T18:00"],
      ["2026-11-06T16:00", "2026-11-08T18:00"]
    ]
  );
});

test("contact rule validation rejects unsupported or excessive RRULE input", () => {
  const base = {
    name: "Flexible Testregel",
    startDate: "2026-07-01",
    timezone: "Europe/Berlin",
    segments: [
      {
        id: "span-1",
        startDayOffset: 0,
        startTime: "15:00",
        endDayOffset: 0,
        endTime: "18:00"
      }
    ],
    syncHorizonMonths: 12,
    childIds: ["child-a"],
    active: true
  };

  for (const rrule of [
    "FREQ=HOURLY;INTERVAL=1",
    "FREQ=WEEKLY;COUNT=501;BYDAY=FR",
    "FREQ=WEEKLY;BYDAY=FR;BYHOUR=9"
  ]) {
    assert.equal(contactRuleInputSchema.safeParse({
      ...base,
      recurrence: {
        kind: "rrule",
        rrules: [rrule]
      }
    }).success, false);
  }

  assert.equal(contactRuleInputSchema.safeParse({
    ...base,
    startDate: "2026-01-01",
    endDate: "2028-12-31",
    recurrence: { kind: "rrule", rrules: ["FREQ=WEEKLY;BYDAY=FR"] }
  }).success, true);
  assert.equal(contactRuleInputSchema.safeParse({
    ...base,
    startDate: "2026-01-01",
    endDate: "2029-01-01",
    recurrence: { kind: "rrule", rrules: ["FREQ=WEEKLY;BYDAY=FR"] }
  }).success, false);
});

test("bounded rule sync covers the complete configured date range", async () => {
  await withDatabase(async (database, persistence) => {
    insertChild(database);
    const rule = await upsertContactRule({
      id: "rule-bounded",
      rule: {
        name: "Ganzjahresregel",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        timezone: "Europe/Berlin",
        recurrence: { kind: "rrule", rrules: ["FREQ=MONTHLY;BYMONTHDAY=15"] },
        segments: [{
          id: "day",
          startDayOffset: 0,
          startTime: "10:00",
          endDayOffset: 0,
          endTime: "18:00"
        }],
        syncHorizonMonths: 12,
        childIds: ["child-a"],
        active: true
      },
      createdBy: "tester",
      updatedBy: "tester",
      createdAt: timestamp,
      updatedAt: timestamp,
      database: persistence
    });

    const summary = await syncContactRule(rule.id, {
      database: persistence,
      userEmail: "tester",
      now: timestamp
    });
    const months = (database.prepare(`
      SELECT substr(start_datetime, 1, 7) AS month
      FROM care_entries
      WHERE contact_rule_id = ? AND deleted_at IS NULL
      ORDER BY start_datetime
    `).all(rule.id) as Array<{ month: string }>).map((row) => row.month);

    assert.deepEqual([summary.startDate, summary.endDate, summary.created], [
      "2026-01-01",
      "2026-12-31",
      12
    ]);
    assert.deepEqual(
      [months[0], months[5], months[6], months[11]],
      ["2026-01", "2026-06", "2026-07", "2026-12"]
    );
  });
});

test("open-ended rule sync keeps the rolling future horizon", async () => {
  await withDatabase(async (database, persistence) => {
    insertChild(database);
    const rule = await upsertContactRule({
      id: "rule-open",
      rule: {
        name: "Offene Regel",
        startDate: "2026-01-01",
        timezone: "Europe/Berlin",
        recurrence: { kind: "rrule", rrules: ["FREQ=MONTHLY;BYMONTHDAY=15"] },
        segments: [{
          id: "day",
          startDayOffset: 0,
          startTime: "10:00",
          endDayOffset: 0,
          endTime: "18:00"
        }],
        syncHorizonMonths: 12,
        childIds: ["child-a"],
        active: true
      },
      createdBy: "tester",
      updatedBy: "tester",
      createdAt: timestamp,
      updatedAt: timestamp,
      database: persistence
    });

    const summary = await syncContactRule(rule.id, {
      database: persistence,
      userEmail: "tester",
      now: timestamp
    });

    assert.deepEqual([summary.startDate, summary.endDate], ["2026-07-01", "2027-06-30"]);
  });
});

test("sync rejects stored bounded rules beyond the 36 month safety limit", async () => {
  await withDatabase(async (database, persistence) => {
    insertChild(database);
    const rule = await upsertContactRule({
      id: "rule-too-long",
      rule: {
        name: "Zu lange Regel",
        startDate: "2026-01-01",
        endDate: "2029-01-01",
        timezone: "Europe/Berlin",
        recurrence: { kind: "rrule", rrules: ["FREQ=MONTHLY;BYMONTHDAY=15"] },
        segments: [{
          id: "day",
          startDayOffset: 0,
          startTime: "10:00",
          endDayOffset: 0,
          endTime: "18:00"
        }],
        syncHorizonMonths: 12,
        childIds: ["child-a"],
        active: true
      },
      createdBy: "tester",
      updatedBy: "tester",
      createdAt: timestamp,
      updatedAt: timestamp,
      database: persistence
    });

    await assert.rejects(
      syncContactRule(rule.id, { database: persistence, userEmail: "tester", now: timestamp }),
      /höchstens 36 Monate/
    );
  });
});

test("sync creates planned entries from a legacy pattern and does not duplicate them", async () => {
  await withDatabase(async (database, persistence) => {
    insertChild(database);
    insertLegacyPattern(database);
    const rule = await upsertContactRuleFromPattern({
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
    }, persistence);

    const first = await syncContactRule(rule.id, {
      database: persistence,
      userEmail: "tester",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      now: timestamp
    });
    const second = await syncContactRule(rule.id, {
      database: persistence,
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

test("sync preserves manually changed generated entries", async () => {
  await withDatabase(async (database, persistence) => {
    insertChild(database);
    insertLegacyPattern(database);
    await upsertContactRuleFromPattern({
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
    }, persistence);
    await syncContactRule("pattern-a", {
      database: persistence,
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
    const summary = await syncContactRule("pattern-a", {
      database: persistence,
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

test("sync preserves cancelled generated entries as exceptions", async () => {
  await withDatabase(async (database, persistence) => {
    insertChild(database);
    insertLegacyPattern(database);
    await upsertContactRuleFromPattern({
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
    }, persistence);
    await syncContactRule("pattern-a", {
      database: persistence,
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
    const summary = await syncContactRule("pattern-a", {
      database: persistence,
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

test("sync updates child assignments for unchanged planned entries", async () => {
  await withDatabase(async (database, persistence) => {
    insertChild(database);
    insertChild(database, "child-b", "Zweites Testkind");
    insertLegacyPattern(database);
    await upsertContactRuleFromPattern({
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
    }, persistence);
    await syncContactRule("pattern-a", {
      database: persistence,
      userEmail: "tester",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      now: timestamp
    });

    await upsertContactRuleFromPattern({
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
    }, persistence);
    await syncContactRule("pattern-a", {
      database: persistence,
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

test("historical sync requires a current preview and suppresses automatic confirmations", async () => {
  await withDatabase(async (database, persistence) => {
    insertChild(database);
    insertLegacyPattern(database);
    await upsertContactRuleFromPattern({
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
    }, persistence);

    const preview = await previewContactRuleSync("pattern-a", {
      database: persistence,
      startDate: "2026-07-03",
      endDate: "2026-07-31",
      now: "2026-08-26T12:00:00.000Z"
    });
    assert.deepEqual(
      [preview.create, preview.alreadyPresent, preview.manualExceptions, preview.pastOccurrences],
      [3, 0, 0, 3]
    );

    const summary = await syncContactRule("pattern-a", {
      database: persistence,
      userEmail: "tester",
      startDate: preview.startDate,
      endDate: preview.endDate,
      previewFingerprint: preview.fingerprint,
      suppressPastConfirmations: true,
      now: "2026-08-26T12:00:00.000Z"
    });
    assert.equal(summary.created, 3);
    const suppressed = database.prepare(`
      SELECT COUNT(*) AS count
      FROM care_entries
      WHERE contact_rule_id = ? AND confirmation_suppressed = 1
    `).get("pattern-a") as { count: number };
    assert.equal(suppressed.count, 3);

    await assert.rejects(
      syncContactRule("pattern-a", {
        database: persistence,
        userEmail: "tester",
        startDate: preview.startDate,
        endDate: preview.endDate,
        previewFingerprint: preview.fingerprint,
        suppressPastConfirmations: true,
        now: "2026-08-26T12:00:00.000Z"
      }),
      isContactRuleSyncPreviewChangedError
    );

    const repeated = await previewContactRuleSync("pattern-a", {
      database: persistence,
      startDate: "2026-07-03",
      endDate: "2026-07-31",
      now: "2026-08-26T12:00:00.000Z"
    });
    assert.deepEqual([repeated.create, repeated.alreadyPresent], [0, 3]);
  });
});
