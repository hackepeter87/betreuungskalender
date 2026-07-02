import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "betreuungskalender-confirmations-"));
process.env.DATABASE_PATH = join(temporaryDirectory, "test.sqlite");
process.env.BACKUP_DIR = join(temporaryDirectory, "backups");
process.env.WEB_PUSH_PUBLIC_KEY = "";
process.env.WEB_PUSH_PRIVATE_KEY = "";

const { runMigrations } = await import("./db/migrate.js");
const { db } = await import("./db/connection.js");
const {
  answerCareConfirmation,
  createDueCareConfirmationRequests,
  getNotificationPreferences,
  listOpenCareConfirmations,
  updateNotificationPreferences
} = await import("./services/careConfirmations.js");

runMigrations();

function resetDatabase(): void {
  db.transaction(() => {
    db.prepare("DELETE FROM care_confirmation_requests").run();
    db.prepare("DELETE FROM notification_preferences").run();
    db.prepare("DELETE FROM push_subscriptions").run();
    db.prepare("DELETE FROM care_entry_children").run();
    db.prepare("DELETE FROM care_entries").run();
    db.prepare("DELETE FROM children").run();
    db.prepare("DELETE FROM audit_log").run();
    db.prepare("DELETE FROM monthly_closings").run();
    db.prepare("DELETE FROM app_users WHERE id <> 'local-dev'").run();
  })();
}

function insertPastPlannedEntry(id = "entry-confirmation-a"): void {
  const timestamp = "2026-07-01T10:00:00.000Z";
  db.prepare(`
    INSERT INTO children (
      id, name, birth_month, birth_year, color, created_by, updated_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "child-confirmation-a",
    "Testkind",
    4,
    2018,
    "#087f7b",
    "local-dev",
    "local-dev",
    timestamp,
    timestamp
  );
  db.prepare(`
    INSERT INTO care_entries (
      id, start_datetime, end_datetime, status, care_scope,
      overnight, school_handover, holiday, weekend, additional_care,
      duration_minutes, is_contact_time, created_by, updated_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    "2026-07-02T16:00:00.000Z",
    "2026-07-02T18:00:00.000Z",
    "planned",
    "hourly",
    0,
    0,
    0,
    0,
    0,
    120,
    0,
    "local-dev",
    "local-dev",
    timestamp,
    timestamp
  );
  db.prepare(`
    INSERT INTO care_entry_children (
      care_entry_id, child_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?)
  `).run(id, "child-confirmation-a", timestamp, timestamp);
}

beforeEach(resetDatabase);

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("creates one due confirmation request for an unconfirmed past planned entry", async () => {
  insertPastPlannedEntry();

  const created = createDueCareConfirmationRequests(new Date("2026-07-03T08:05:00.000Z"));
  const duplicate = createDueCareConfirmationRequests(new Date("2026-07-03T09:00:00.000Z"));
  const open = await listOpenCareConfirmations("local-dev");

  assert.equal(created, 1);
  assert.equal(duplicate, 0);
  assert.equal(open.length, 1);
  assert.equal(open[0]?.entry.id, "entry-confirmation-a");
  assert.equal(open[0]?.entry.confirmationState, "unconfirmed");
});

test("answers a confirmation request and stores partial status with audit metadata", () => {
  insertPastPlannedEntry();
  createDueCareConfirmationRequests(new Date("2026-07-03T08:05:00.000Z"));
  const request = db.prepare(`
    SELECT id FROM care_confirmation_requests
    WHERE care_entry_id = ? AND user_id = ?
  `).get("entry-confirmation-a", "local-dev") as { id: string };

  const answered = answerCareConfirmation(request.id, "local-dev", {
    status: "partial",
    note: "Fiktive Teilbestätigung"
  });
  const entry = db.prepare(`
    SELECT status, confirmation_note AS confirmationNote, confirmed_by AS confirmedBy,
      confirmed_at AS confirmedAt
    FROM care_entries
    WHERE id = ?
  `).get("entry-confirmation-a") as {
    status: string;
    confirmationNote: string;
    confirmedBy: string;
    confirmedAt: string;
  };
  const openCount = db.prepare(`
    SELECT COUNT(*) AS count FROM care_confirmation_requests
    WHERE status IN ('open', 'snoozed')
  `).get() as { count: number };

  assert.equal(answered?.status, "answered");
  assert.equal(entry.status, "partial");
  assert.equal(entry.confirmationNote, "Fiktive Teilbestätigung");
  assert.equal(entry.confirmedBy, "local-dev");
  assert.match(entry.confirmedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(openCount.count, 0);
});

test("notification preferences default to in-app and push while email stays opt-in", () => {
  const defaults = getNotificationPreferences("local-dev");
  assert.equal(defaults.pushAvailable, false);
  assert.equal(defaults.preferences.length, 2);
  assert.deepEqual(
    defaults.preferences.map((preference) => ({
      eventType: preference.eventType,
      inAppEnabled: preference.inAppEnabled,
      pushEnabled: preference.pushEnabled,
      emailEnabled: preference.emailEnabled
    })),
    [
      {
        eventType: "care_confirmation_due",
        inAppEnabled: true,
        pushEnabled: true,
        emailEnabled: false
      },
      {
        eventType: "care_confirmation_reminder",
        inAppEnabled: true,
        pushEnabled: true,
        emailEnabled: false
      }
    ]
  );

  const updated = updateNotificationPreferences("local-dev", [{
    eventType: "care_confirmation_due",
    inAppEnabled: true,
    pushEnabled: false,
    emailEnabled: true
  }]);
  const due = updated.preferences.find((preference) => preference.eventType === "care_confirmation_due");

  assert.equal(due?.pushEnabled, false);
  assert.equal(due?.emailEnabled, true);
});
