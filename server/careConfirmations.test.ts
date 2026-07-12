import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import type { RequestUser } from "./auth.js";

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
  savePushSubscription,
  sendDueCareConfirmationPushes,
  updateNotificationPreferences
} = await import("./services/careConfirmations.js");

runMigrations();

function resetDatabase(): void {
  db.transaction(() => {
    db.prepare("DELETE FROM care_confirmation_requests").run();
    db.prepare("DELETE FROM notification_preferences").run();
    db.prepare("DELETE FROM push_subscriptions").run();
    db.prepare("DELETE FROM care_entry_actual_children").run();
    db.prepare("DELETE FROM care_entry_children").run();
    db.prepare("DELETE FROM care_entries").run();
    db.prepare("DELETE FROM children").run();
    db.prepare("DELETE FROM app_user_care_party_assignments").run();
    db.prepare("DELETE FROM care_parties").run();
    db.prepare("DELETE FROM audit_log").run();
    db.prepare("DELETE FROM monthly_closings").run();
    db.prepare("DELETE FROM app_users WHERE id <> 'local-dev'").run();
  })();
}

function insertPastPlannedEntry(id = "entry-confirmation-a"): void {
  const timestamp = "2026-07-01T10:00:00.000Z";
  const childInsert = db.prepare(`
    INSERT INTO children (
      id, name, birth_month, birth_year, color, created_by, updated_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  childInsert.run(
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
  childInsert.run(
    "child-confirmation-b",
    "Testkind 2",
    8,
    2020,
    "#6967d9",
    "local-dev",
    "local-dev",
    timestamp,
    timestamp
  );
  db.prepare(`
    INSERT INTO care_parties (
      id, name, kind, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "party-confirmation-a",
    "Hauptbetreuung",
    "other",
    "local-dev",
    "local-dev",
    timestamp,
    timestamp
  );
  db.prepare(`
    INSERT INTO care_entries (
      id, start_datetime, end_datetime, status, care_scope,
      overnight, school_handover, holiday, weekend, additional_care,
      responsible_party_id, duration_minutes, is_contact_time, created_by, updated_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    "party-confirmation-a",
    120,
    0,
    "local-dev",
    "local-dev",
    timestamp,
    timestamp
  );
  const childLinkInsert = db.prepare(`
    INSERT INTO care_entry_children (
      care_entry_id, child_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?)
  `);
  childLinkInsert.run(id, "child-confirmation-a", timestamp, timestamp);
  childLinkInsert.run(id, "child-confirmation-b", timestamp, timestamp);
}

function insertAppUser(user: RequestUser): void {
  db.prepare(`
    INSERT INTO app_users (
      id, external_subject, email, display_name, role, groups_json,
      created_at, updated_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id,
    user.externalSubject,
    user.email ?? null,
    user.displayName,
    user.role,
    JSON.stringify(user.groups),
    "2026-07-01T10:00:00.000Z",
    "2026-07-01T10:00:00.000Z",
    "2026-07-01T10:00:00.000Z"
  );
}

function parentUser(id = "user-parent-confirmation"): RequestUser {
  return {
    id,
    externalSubject: `subject-${id}`,
    email: `${id}@example.invalid`,
    displayName: "Parent Confirmation",
    groups: ["/betreuungskalender/parents"],
    role: "parent",
    permissions: ["read", "write"]
  };
}

function insertCareParty(id: string, name: string): void {
  db.prepare(`
    INSERT INTO care_parties (
      id, name, kind, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    "other",
    "local-dev",
    "local-dev",
    "2026-07-01T10:00:00.000Z",
    "2026-07-01T10:00:00.000Z"
  );
}

function assignCareParty(userId: string, carePartyId: string): void {
  db.prepare(`
    INSERT INTO app_user_care_party_assignments (
      id, user_id, care_party_id, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    `assignment-${userId}-${carePartyId}`,
    userId,
    carePartyId,
    "local-dev",
    "local-dev",
    "2026-07-01T10:00:00.000Z",
    "2026-07-01T10:00:00.000Z"
  );
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

test("batches multiple due confirmations into one push per user", async () => {
  insertPastPlannedEntry();
  db.prepare(`
    INSERT INTO care_entries (
      id, start_datetime, end_datetime, status, care_scope,
      overnight, school_handover, holiday, weekend, additional_care,
      responsible_party_id, duration_minutes, is_contact_time, created_by, updated_by,
      created_at, updated_at
    )
    SELECT ?, start_datetime, end_datetime, status, care_scope,
      overnight, school_handover, holiday, weekend, additional_care,
      responsible_party_id, duration_minutes, is_contact_time, created_by, updated_by,
      created_at, updated_at
    FROM care_entries WHERE id = ?
  `).run("entry-confirmation-b", "entry-confirmation-a");
  db.prepare(`
    INSERT INTO care_entry_children (
      care_entry_id, child_id, created_at, updated_at
    )
    SELECT ?, child_id, created_at, updated_at
    FROM care_entry_children WHERE care_entry_id = ?
  `).run("entry-confirmation-b", "entry-confirmation-a");
  createDueCareConfirmationRequests(new Date("2026-07-03T08:05:00.000Z"));

  let deliveries = 0;
  const sent = await sendDueCareConfirmationPushes(
    new Date("2026-07-03T08:05:00.000Z"),
    async () => {
      deliveries += 1;
      return true;
    }
  );
  const rows = db.prepare(`
    SELECT sent_at AS sentAt, reminder_count AS reminderCount
    FROM care_confirmation_requests
    WHERE user_id = 'local-dev'
    ORDER BY care_entry_id
  `).all() as Array<{ sentAt: string | null; reminderCount: number }>;

  assert.equal(sent, 1);
  assert.equal(deliveries, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows.every((row) => Boolean(row.sentAt) && row.reminderCount === 1), true);
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
    note: "Fiktive Teilbestätigung",
    actualChildIds: ["child-confirmation-a"],
    actualStartDateTime: "2026-07-02T17:00:00.000Z",
    actualEndDateTime: "2026-07-02T18:00:00.000Z",
    actualResponsiblePartyId: "party-confirmation-a"
  });
  const entry = db.prepare(`
    SELECT status, confirmation_note AS confirmationNote, confirmed_by AS confirmedBy,
      confirmed_at AS confirmedAt, actual_start_datetime AS actualStartDateTime,
      actual_end_datetime AS actualEndDateTime,
      actual_responsible_party_id AS actualResponsiblePartyId,
      planned_start_datetime AS plannedStartDateTime,
      planned_end_datetime AS plannedEndDateTime,
      deviation_type AS deviationType,
      deviation_note AS deviationNote
    FROM care_entries
    WHERE id = ?
  `).get("entry-confirmation-a") as {
    status: string;
    confirmationNote: string;
    confirmedBy: string;
    confirmedAt: string;
    actualStartDateTime: string;
    actualEndDateTime: string;
    actualResponsiblePartyId: string;
    plannedStartDateTime: string;
    plannedEndDateTime: string;
    deviationType: string;
    deviationNote: string;
  };
  const actualChildren = db.prepare(`
    SELECT child_id AS childId
    FROM care_entry_actual_children
    WHERE care_entry_id = ? AND deleted_at IS NULL
    ORDER BY child_id
  `).all("entry-confirmation-a") as Array<{ childId: string }>;
  const openCount = db.prepare(`
    SELECT COUNT(*) AS count FROM care_confirmation_requests
    WHERE status IN ('open', 'snoozed')
  `).get() as { count: number };

  assert.equal(answered?.status, "answered");
  assert.equal(entry.status, "partial");
  assert.equal(entry.confirmationNote, "Fiktive Teilbestätigung");
  assert.equal(entry.confirmedBy, "local-dev");
  assert.match(entry.confirmedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(entry.actualStartDateTime, "2026-07-02T17:00:00.000Z");
  assert.equal(entry.actualEndDateTime, "2026-07-02T18:00:00.000Z");
  assert.equal(entry.actualResponsiblePartyId, "party-confirmation-a");
  assert.equal(entry.plannedStartDateTime, "2026-07-02T16:00:00.000Z");
  assert.equal(entry.plannedEndDateTime, "2026-07-02T18:00:00.000Z");
  assert.equal(entry.deviationType, "partial");
  assert.equal(entry.deviationNote, "Fiktive Teilbestätigung");
  assert.deepEqual(actualChildren, [{ childId: "child-confirmation-a" }]);
  assert.deepEqual(answered?.entry.actualChildIds, ["child-confirmation-a"]);
  assert.equal(answered?.entry.actualStartDateTime, "2026-07-02T17:00:00.000Z");
  assert.equal(openCount.count, 0);
});

test("partial confirmation rejects actual care parties outside the assigned shared context", () => {
  insertPastPlannedEntry();
  insertCareParty("party-confirmation-b", "Nicht zugeordnet");
  const user = parentUser();
  insertAppUser(user);
  assignCareParty(user.id, "party-confirmation-a");
  createDueCareConfirmationRequests(new Date("2026-07-03T08:05:00.000Z"));
  const request = db.prepare(`
    SELECT id FROM care_confirmation_requests
    WHERE care_entry_id = ? AND user_id = ?
  `).get("entry-confirmation-a", user.id) as { id: string };

  assert.throws(
    () => answerCareConfirmation(request.id, user, {
      status: "partial",
      note: "Fiktiver Fremdversuch",
      actualChildIds: ["child-confirmation-a"],
      actualStartDateTime: "2026-07-02T17:00:00.000Z",
      actualEndDateTime: "2026-07-02T18:00:00.000Z",
      actualResponsiblePartyId: "party-confirmation-b"
    }),
    /nicht freigegeben/
  );
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

test("push subscriptions only allow configured public push service endpoints", () => {
  assert.throws(
    () => savePushSubscription("local-dev", {
      endpoint: "https://127.0.0.1/internal",
      keys: { p256dh: "fictional-public-key", auth: "fictional-auth-secret" }
    }),
    /Push-Endpunkt/
  );

  savePushSubscription("local-dev", {
    endpoint: "https://fcm.googleapis.com/fcm/send/fictional-subscription",
    keys: { p256dh: "fictional-public-key", auth: "fictional-auth-secret" }
  });
  const stored = db.prepare(`
    SELECT COUNT(*) AS count FROM push_subscriptions
    WHERE user_id = ? AND deleted_at IS NULL
  `).get("local-dev") as { count: number };

  assert.equal(stored.count, 1);
});
