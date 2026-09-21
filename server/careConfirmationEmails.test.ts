import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "betreuungskalender-confirmation-email-"));
process.env.DATABASE_PATH = join(temporaryDirectory, "test.sqlite");
process.env.BACKUP_DIR = join(temporaryDirectory, "backups");
process.env.WEB_PUSH_PUBLIC_KEY = "";
process.env.WEB_PUSH_PRIVATE_KEY = "";

const { runMigrations } = await import("./db/migrate.js");
const { persistence } = await import("./db/connection.js");
const { requireSqlitePersistenceRuntime } = await import("./db/runtime.js");
const {
  createDueCareConfirmationRequests,
  remindCareConfirmationLater
} = await import("./services/careConfirmations.js");
const { processCareConfirmationEmailDeliveries } = await import(
  "./services/careConfirmationEmails.js"
);

const database = requireSqlitePersistenceRuntime(persistence).sqliteDatabase;
runMigrations();

function resetDatabase(): void {
  database.transaction(() => {
    database.prepare("DELETE FROM care_confirmation_email_deliveries").run();
    database.prepare("DELETE FROM care_confirmation_requests").run();
    database.prepare("DELETE FROM notification_preferences").run();
    database.prepare("DELETE FROM care_entry_children").run();
    database.prepare("DELETE FROM care_entries").run();
    database.prepare("DELETE FROM children").run();
    database.prepare("DELETE FROM care_parties").run();
    database.prepare("UPDATE app_users SET email = NULL WHERE id = 'local-dev'").run();
  })();
}

function insertPastPlannedEntry(id: string, start: string, end: string): void {
  const timestamp = "2026-07-01T10:00:00.000Z";
  database.prepare(`
    INSERT OR IGNORE INTO children (
      id, name, birth_month, birth_year, color, created_by, updated_by,
      created_at, updated_at
    ) VALUES ('child-email-test', 'Testkind', 4, 2018, '#087f7b',
      'local-dev', 'local-dev', ?, ?)
  `).run(timestamp, timestamp);
  database.prepare(`
    INSERT OR IGNORE INTO care_parties (
      id, name, kind, created_by, updated_by, created_at, updated_at
    ) VALUES ('party-email-test', 'Testbetreuung', 'other',
      'local-dev', 'local-dev', ?, ?)
  `).run(timestamp, timestamp);
  database.prepare(`
    INSERT INTO care_entries (
      id, start_datetime, end_datetime, status, care_scope,
      overnight, school_handover, holiday, weekend, additional_care,
      responsible_party_id, duration_minutes, is_contact_time,
      created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, 'planned', 'hourly', 0, 0, 0, 0, 0,
      'party-email-test', 120, 0, 'local-dev', 'local-dev', ?, ?)
  `).run(id, start, end, timestamp, timestamp);
  database.prepare(`
    INSERT INTO care_entry_children (
      care_entry_id, child_id, created_at, updated_at
    ) VALUES (?, 'child-email-test', ?, ?)
  `).run(id, timestamp, timestamp);
}

function enableEmailPreference(): void {
  const timestamp = "2026-07-03T08:00:00.000Z";
  database.prepare("UPDATE app_users SET email = ? WHERE id = 'local-dev'")
    .run("local-dev@example.invalid");
  database.prepare(`
    INSERT INTO notification_preferences (
      id, user_id, event_type, in_app_enabled, push_enabled, email_enabled,
      created_at, updated_at
    ) VALUES ('pref-email-due', 'local-dev', 'care_confirmation_due', 1, 1, 1, ?, ?)
  `).run(timestamp, timestamp);
}

function enableReminderEmailPreference(): void {
  const timestamp = "2026-07-03T08:00:00.000Z";
  database.prepare("UPDATE app_users SET email = ? WHERE id = 'local-dev'")
    .run("local-dev@example.invalid");
  database.prepare(`
    INSERT INTO notification_preferences (
      id, user_id, event_type, in_app_enabled, push_enabled, email_enabled,
      created_at, updated_at
    ) VALUES ('pref-email-reminder', 'local-dev', 'care_confirmation_reminder', 1, 1, 1, ?, ?)
  `).run(timestamp, timestamp);
}

async function createSingleDueRequest(): Promise<string> {
  insertPastPlannedEntry(
    "entry-email-a",
    "2026-07-02T14:00:00.000Z",
    "2026-07-02T16:00:00.000Z"
  );
  await createDueCareConfirmationRequests(
    persistence,
    new Date("2026-07-03T08:05:00.000Z")
  );
  const row = database.prepare(`
    SELECT id FROM care_confirmation_requests
    WHERE care_entry_id = 'entry-email-a' AND user_id = 'local-dev'
  `).get() as { id: string };
  return row.id;
}

beforeEach(resetDatabase);

after(async () => {
  await persistence.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("batches due confirmations once and stores privacy-safe delivery state", async () => {
  insertPastPlannedEntry(
    "entry-email-a",
    "2026-07-02T14:00:00.000Z",
    "2026-07-02T16:00:00.000Z"
  );
  insertPastPlannedEntry(
    "entry-email-b",
    "2026-07-02T16:00:00.000Z",
    "2026-07-02T18:00:00.000Z"
  );
  enableEmailPreference();
  await createDueCareConfirmationRequests(
    persistence,
    new Date("2026-07-03T08:05:00.000Z")
  );

  const batches: Array<{ recipient: string; requestIds: string[] }> = [];
  const first = await processCareConfirmationEmailDeliveries(
    persistence,
    new Date("2026-07-03T08:05:00.000Z"),
    async (batch) => {
      batches.push({
        recipient: batch.recipientEmail,
        requestIds: [...batch.requestIds]
      });
      return true;
    }
  );
  const second = await processCareConfirmationEmailDeliveries(
    persistence,
    new Date("2026-07-03T08:06:00.000Z"),
    async () => {
      throw new Error("A successful occurrence must not be delivered twice.");
    }
  );

  assert.deepEqual(first, { batchesAttempted: 1, batchesSent: 1, occurrencesSent: 2 });
  assert.deepEqual(second, { batchesAttempted: 0, batchesSent: 0, occurrencesSent: 0 });
  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.recipient, "local-dev@example.invalid");
  assert.equal(batches[0]?.requestIds.length, 2);

  const states = database.prepare(`
    SELECT status, attempt_count AS attemptCount, sent_at AS sentAt,
      error_code AS errorCode
    FROM care_confirmation_email_deliveries
    ORDER BY care_confirmation_request_id
  `).all() as Array<{
    status: string;
    attemptCount: number;
    sentAt: string | null;
    errorCode: string | null;
  }>;
  assert.equal(states.length, 2);
  assert.equal(states.every((state) =>
    state.status === "sent" && state.attemptCount === 1 &&
    Boolean(state.sentAt) && state.errorCode === null
  ), true);

  const columns = database.prepare("PRAGMA table_info(care_confirmation_email_deliveries)")
    .all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  for (const forbidden of ["email", "recipient", "message", "body", "url", "smtp"]) {
    assert.equal([...names].some((name) => name.includes(forbidden)), false, forbidden);
  }
});

test("retries failures after 15 minutes and one hour, then stops permanently", async () => {
  enableEmailPreference();
  await createSingleDueRequest();
  let attempts = 0;
  const fail = async () => {
    attempts += 1;
    return false;
  };

  assert.equal((await processCareConfirmationEmailDeliveries(
    persistence,
    new Date("2026-07-03T08:05:00.000Z"),
    fail
  )).batchesAttempted, 1);
  assert.equal((await processCareConfirmationEmailDeliveries(
    persistence,
    new Date("2026-07-03T08:19:59.999Z"),
    fail
  )).batchesAttempted, 0);
  assert.equal((await processCareConfirmationEmailDeliveries(
    persistence,
    new Date("2026-07-03T08:20:00.000Z"),
    fail
  )).batchesAttempted, 1);
  assert.equal((await processCareConfirmationEmailDeliveries(
    persistence,
    new Date("2026-07-03T09:19:59.999Z"),
    fail
  )).batchesAttempted, 0);
  assert.equal((await processCareConfirmationEmailDeliveries(
    persistence,
    new Date("2026-07-03T09:20:00.000Z"),
    fail
  )).batchesAttempted, 1);
  assert.equal((await processCareConfirmationEmailDeliveries(
    persistence,
    new Date("2026-07-04T09:20:00.000Z"),
    fail
  )).batchesAttempted, 0);

  const state = database.prepare(`
    SELECT status, attempt_count AS attemptCount,
      next_attempt_at AS nextAttemptAt, error_code AS errorCode
    FROM care_confirmation_email_deliveries
  `).get() as {
    status: string;
    attemptCount: number;
    nextAttemptAt: string | null;
    errorCode: string | null;
  };
  assert.equal(attempts, 3);
  assert.deepEqual(state, {
    status: "failed",
    attemptCount: 3,
    nextAttemptAt: null,
    errorCode: "delivery_failed"
  });
});

test("creates a distinct stable occurrence for every requested reminder", async () => {
  enableReminderEmailPreference();
  const requestId = await createSingleDueRequest();
  await remindCareConfirmationLater(
    persistence,
    requestId,
    "local-dev",
    "2026-07-03T12:00:00.000Z"
  );

  assert.equal((await processCareConfirmationEmailDeliveries(
    persistence,
    new Date("2026-07-03T12:00:00.000Z"),
    async () => true
  )).batchesSent, 1);
  await remindCareConfirmationLater(
    persistence,
    requestId,
    "local-dev",
    "2026-07-03T16:00:00.000Z"
  );
  assert.equal((await processCareConfirmationEmailDeliveries(
    persistence,
    new Date("2026-07-03T16:00:00.000Z"),
    async () => true
  )).batchesSent, 1);

  const occurrences = database.prepare(`
    SELECT event_type AS eventType, occurrence_key AS occurrenceKey, status
    FROM care_confirmation_email_deliveries
    ORDER BY occurrence_key
  `).all();
  assert.deepEqual(occurrences, [
    {
      eventType: "care_confirmation_reminder",
      occurrenceKey: "reminder:2026-07-03T12:00:00.000Z",
      status: "sent"
    },
    {
      eventType: "care_confirmation_reminder",
      occurrenceKey: "reminder:2026-07-03T16:00:00.000Z",
      status: "sent"
    }
  ]);
});

test("concurrent sweeps can claim a successful occurrence only once", async () => {
  enableEmailPreference();
  await createSingleDueRequest();
  let deliveries = 0;
  const deliver = async () => {
    deliveries += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return true;
  };

  const results = await Promise.all([
    processCareConfirmationEmailDeliveries(
      persistence,
      new Date("2026-07-03T08:05:00.000Z"),
      deliver
    ),
    processCareConfirmationEmailDeliveries(
      persistence,
      new Date("2026-07-03T08:05:00.000Z"),
      deliver
    )
  ]);

  assert.equal(deliveries, 1);
  assert.equal(results.reduce((sum, result) => sum + result.batchesSent, 0), 1);
});

test("drops a resolved occurrence before retry while preserving other batch members", async () => {
  enableEmailPreference();
  await createSingleDueRequest();
  insertPastPlannedEntry(
    "entry-email-b",
    "2026-07-02T16:00:00.000Z",
    "2026-07-02T18:00:00.000Z"
  );
  await createDueCareConfirmationRequests(
    persistence,
    new Date("2026-07-03T08:05:00.000Z")
  );
  assert.equal((await processCareConfirmationEmailDeliveries(
    persistence,
    new Date("2026-07-03T08:05:00.000Z"),
    async () => false
  )).batchesAttempted, 1);
  database.prepare(`
    UPDATE care_entries
    SET status = 'completed', confirmed_at = ?, confirmed_by = 'local-dev'
    WHERE id = 'entry-email-a'
  `).run("2026-07-03T08:10:00.000Z");

  const retriedRequestIds: string[][] = [];
  const retried = await processCareConfirmationEmailDeliveries(
    persistence,
    new Date("2026-07-03T08:20:00.000Z"),
    async (batch) => {
      retriedRequestIds.push([...batch.requestIds]);
      return true;
    }
  );

  assert.deepEqual(retried, { batchesAttempted: 1, batchesSent: 1, occurrencesSent: 1 });
  assert.equal(retriedRequestIds[0]?.length, 1);
  const states = database.prepare(`
    SELECT request.care_entry_id AS careEntryId, delivery.status,
      delivery.error_code AS errorCode
    FROM care_confirmation_email_deliveries AS delivery
    JOIN care_confirmation_requests AS request
      ON request.id = delivery.care_confirmation_request_id
    ORDER BY request.care_entry_id
  `).all();
  assert.deepEqual(states, [
    { careEntryId: "entry-email-a", status: "failed", errorCode: "not_actionable" },
    { careEntryId: "entry-email-b", status: "sent", errorCode: null }
  ]);
});

test("stores only an abstract code when delivery throws a sensitive error", async () => {
  enableEmailPreference();
  await createSingleDueRequest();

  await processCareConfirmationEmailDeliveries(
    persistence,
    new Date("2026-07-03T08:05:00.000Z"),
    async () => {
      throw new Error("smtp://secret-user:secret-password@example.invalid/private-child-data");
    }
  );

  const serialized = JSON.stringify(database.prepare(`
    SELECT * FROM care_confirmation_email_deliveries
  `).all());
  assert.match(serialized, /delivery_failed/);
  assert.doesNotMatch(serialized, /secret|example\.invalid|private-child-data/);
});

test("does not create delivery state without an explicit email opt-in", async () => {
  await createSingleDueRequest();
  let deliveries = 0;

  const result = await processCareConfirmationEmailDeliveries(
    persistence,
    new Date("2026-07-03T08:05:00.000Z"),
    async () => {
      deliveries += 1;
      return true;
    }
  );

  assert.deepEqual(result, { batchesAttempted: 0, batchesSent: 0, occurrencesSent: 0 });
  assert.equal(deliveries, 0);
  assert.equal((database.prepare(`
    SELECT COUNT(*) AS count FROM care_confirmation_email_deliveries
  `).get() as { count: number }).count, 0);
});

test("marks an unavailable current recipient without attempting delivery", async () => {
  enableEmailPreference();
  await createSingleDueRequest();
  database.prepare("UPDATE app_users SET email = NULL WHERE id = 'local-dev'").run();
  let deliveries = 0;

  const result = await processCareConfirmationEmailDeliveries(
    persistence,
    new Date("2026-07-03T08:05:00.000Z"),
    async () => {
      deliveries += 1;
      return true;
    }
  );
  const state = database.prepare(`
    SELECT status, attempt_count AS attemptCount,
      next_attempt_at AS nextAttemptAt, error_code AS errorCode
    FROM care_confirmation_email_deliveries
  `).get();

  assert.deepEqual(result, { batchesAttempted: 0, batchesSent: 0, occurrencesSent: 0 });
  assert.equal(deliveries, 0);
  assert.deepEqual(state, {
    status: "failed",
    attemptCount: 0,
    nextAttemptAt: null,
    errorCode: "recipient_unavailable"
  });
});

test("rejects a malformed current recipient before delivery", async () => {
  enableEmailPreference();
  await createSingleDueRequest();
  database.prepare("UPDATE app_users SET email = ? WHERE id = 'local-dev'")
    .run("not-an-email");
  let deliveries = 0;

  const result = await processCareConfirmationEmailDeliveries(
    persistence,
    new Date("2026-07-03T08:05:00.000Z"),
    async () => {
      deliveries += 1;
      return true;
    }
  );

  assert.deepEqual(result, { batchesAttempted: 0, batchesSent: 0, occurrencesSent: 0 });
  assert.equal(deliveries, 0);
  assert.deepEqual(database.prepare(`
    SELECT status, error_code AS errorCode
    FROM care_confirmation_email_deliveries
  `).get(), { status: "failed", errorCode: "recipient_unavailable" });
});

test("suppresses email delivery while the care entry has an open conflict", async () => {
  enableEmailPreference();
  await createSingleDueRequest();
  database.prepare(`
    INSERT INTO care_entries (
      id, start_datetime, end_datetime, status, care_scope,
      overnight, school_handover, holiday, weekend, additional_care,
      responsible_party_id, duration_minutes, is_contact_time,
      created_by, updated_by, created_at, updated_at
    )
    SELECT 'entry-email-conflict', start_datetime, end_datetime, status, care_scope,
      overnight, school_handover, holiday, weekend, additional_care,
      responsible_party_id, duration_minutes, is_contact_time,
      created_by, updated_by, created_at, updated_at
    FROM care_entries WHERE id = 'entry-email-a'
  `).run();
  database.prepare(`
    INSERT INTO care_entry_children (care_entry_id, child_id, created_at, updated_at)
    SELECT 'entry-email-conflict', child_id, created_at, updated_at
    FROM care_entry_children WHERE care_entry_id = 'entry-email-a'
  `).run();
  let deliveries = 0;

  const result = await processCareConfirmationEmailDeliveries(
    persistence,
    new Date("2026-07-03T08:05:00.000Z"),
    async () => {
      deliveries += 1;
      return true;
    }
  );

  assert.deepEqual(result, { batchesAttempted: 0, batchesSent: 0, occurrencesSent: 0 });
  assert.equal(deliveries, 0);
  assert.deepEqual(database.prepare(`
    SELECT status, error_code AS errorCode
    FROM care_confirmation_email_deliveries
  `).get(), { status: "failed", errorCode: "not_actionable" });
});
