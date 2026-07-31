import webPush, { type PushSubscription } from "web-push";
import type {
  ApiCareConfirmationAnswer,
  ApiCareConfirmationRequest,
  ApiNotificationEventType,
  ApiNotificationPreference,
  ApiNotificationPreferencesResponse,
  ApiPushSubscriptionInput
} from "../../shared/api.js";
import type { RequestUser } from "../auth.js";
import { db } from "../db/connection.js";
import { config } from "../config.js";
import { markClosedMonthsChanged, recordAudit, recordFieldChanges } from "./audit.js";
import { assertCanUseCareParty, canUseCareParty } from "./carePartyAccess.js";
import { assertActiveCareParty } from "./careParties.js";
import { assertNoActualCareConflict } from "./careConflicts.js";
import { assertActiveChildren, bool, makeId, nowIso, syncJunction } from "./common.js";
import { userHasWorkspacePermission } from "./memberships.js";
import { findAuthenticatedUserBySubject } from "./users.js";

const notificationEvents: ApiNotificationEventType[] = [
  "care_confirmation_due",
  "care_confirmation_reminder"
];

const pushConfigured = Boolean(config.webPushPublicKey && config.webPushPrivateKey);
if (pushConfigured) {
  webPush.setVapidDetails(
    config.webPushSubject,
    config.webPushPublicKey!,
    config.webPushPrivateKey!
  );
}

function httpError(code: string, statusCode: number, message: string): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(message), { code, statusCode });
}

function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      config.webPushAllowedEndpointHosts.includes(hostname)
    );
  } catch {
    return false;
  }
}

interface EntryRow {
  id: string;
  generated_by_pattern_id: string | null;
  rule_occurrence_date: string | null;
  contact_rule_id: string | null;
  contact_rule_segment_id: string | null;
  contact_rule_occurrence_key: string | null;
  responsible_party_id: string | null;
  actual_responsible_party_id: string | null;
  contact_rule_sync_state: "generated" | "manual_override" | null;
  start_datetime: string;
  end_datetime: string;
  planned_start_datetime: string | null;
  planned_end_datetime: string | null;
  actual_start_datetime: string | null;
  actual_end_datetime: string | null;
  status: "planned" | "completed" | "cancelled" | "partial";
  deviation_type: "cancelled" | "partial" | "rescheduled" | "swapped" | "externally_blocked" | "other" | null;
  deviation_note: string | null;
  confirmation_note: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  care_scope: string;
  cancellation_reason: string | null;
  overnight: number;
  school_handover: number;
  holiday: number;
  weekend: number;
  additional_care: number;
  location: string | null;
  custom_location: string | null;
  handover_from: string | null;
  handover_to: string | null;
  notes: string | null;
  evidence_reference: string | null;
  has_evidence: number;
  duration_minutes: number;
  is_contact_time: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

interface RequestRow {
  id: string;
  care_entry_id: string;
  user_id: string;
  due_at: string;
  sent_at: string | null;
  answered_at: string | null;
  status: "open" | "answered" | "snoozed";
  reminder_count: number;
  next_reminder_at: string | null;
  created_at: string;
  updated_at: string;
}

function optional<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

function childIds(entryId: string): string[] {
  return (db.prepare(`
    SELECT child_id AS childId
    FROM care_entry_children
    WHERE care_entry_id = ? AND deleted_at IS NULL
    ORDER BY child_id
  `).all(entryId) as Array<{ childId: string }>).map((row) => row.childId);
}

function actualChildIds(entryId: string): string[] {
  return (db.prepare(`
    SELECT child_id AS childId
    FROM care_entry_actual_children
    WHERE care_entry_id = ? AND deleted_at IS NULL
    ORDER BY child_id
  `).all(entryId) as Array<{ childId: string }>).map((row) => row.childId);
}

function mapEntry(row: EntryRow): ApiCareConfirmationRequest["entry"] {
  const unconfirmed = row.status === "planned" && !row.confirmed_at && Date.parse(row.end_datetime) < Date.now();
  return {
    id: row.id,
    generatedByPatternId: optional(row.generated_by_pattern_id),
    ruleOccurrenceDate: optional(row.rule_occurrence_date),
    contactRuleId: optional(row.contact_rule_id),
    contactRuleSegmentId: optional(row.contact_rule_segment_id),
    contactRuleOccurrenceKey: optional(row.contact_rule_occurrence_key),
    responsiblePartyId: optional(row.responsible_party_id),
    actualResponsiblePartyId: optional(row.actual_responsible_party_id),
    contactRuleSyncState: optional(row.contact_rule_sync_state),
    startDateTime: row.start_datetime,
    endDateTime: row.end_datetime,
    plannedStartDateTime: optional(row.planned_start_datetime),
    plannedEndDateTime: optional(row.planned_end_datetime),
    actualStartDateTime: optional(row.actual_start_datetime),
    actualEndDateTime: optional(row.actual_end_datetime),
    childIds: childIds(row.id),
    actualChildIds: actualChildIds(row.id),
    status: row.status,
    deviationType: optional(row.deviation_type),
    deviationNote: optional(row.deviation_note),
    ...(unconfirmed ? { confirmationState: "unconfirmed" as const } : row.confirmed_at ? { confirmationState: "confirmed" as const } : {}),
    confirmedAt: optional(row.confirmed_at),
    confirmedBy: optional(row.confirmed_by),
    confirmationNote: optional(row.confirmation_note),
    careScope: row.care_scope as ApiCareConfirmationRequest["entry"]["careScope"],
    cancellationReason: optional(row.cancellation_reason),
    overnight: bool(row.overnight),
    schoolHandover: bool(row.school_handover),
    holiday: bool(row.holiday),
    weekend: bool(row.weekend),
    additionalCare: bool(row.additional_care),
    location: optional(row.location),
    customLocation: optional(row.custom_location),
    handoverFrom: optional(row.handover_from),
    handoverTo: optional(row.handover_to),
    notes: optional(row.notes),
    evidenceReference: optional(row.evidence_reference),
    hasEvidence: bool(row.has_evidence),
    durationMinutes: row.duration_minutes,
    isContactTime: bool(row.is_contact_time),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trips: [],
    costs: []
  };
}

function mapRequest(row: RequestRow, entry: EntryRow): ApiCareConfirmationRequest {
  return {
    id: row.id,
    careEntryId: row.care_entry_id,
    userId: row.user_id,
    dueAt: row.due_at,
    sentAt: optional(row.sent_at),
    answeredAt: optional(row.answered_at),
    status: row.status,
    reminderCount: row.reminder_count,
    nextReminderAt: optional(row.next_reminder_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    entry: mapEntry(entry)
  };
}

function dueAtForEntry(endDateTime: string): string {
  const due = new Date(endDateTime);
  due.setDate(due.getDate() + 1);
  due.setHours(8, 0, 0, 0);
  return due.toISOString();
}

function activeCarePartyAssignmentsExist(): boolean {
  const result = db.prepare(`
    SELECT 1 AS ok
    FROM app_user_care_party_assignments
    WHERE deleted_at IS NULL
    LIMIT 1
  `).get() as { ok: number } | undefined;
  return Boolean(result);
}

function usersForEntry(entry: EntryRow): string[] {
  if (entry.responsible_party_id && activeCarePartyAssignmentsExist()) {
    const rows = db.prepare(`
      SELECT user_id AS userId
      FROM app_user_care_party_assignments
      WHERE care_party_id = ? AND deleted_at IS NULL
      ORDER BY user_id
    `).all(entry.responsible_party_id) as Array<{ userId: string }>;
    if (rows.length) {
      return rows
        .map((row) => row.userId)
        .filter((userId) => userHasWorkspacePermission(userId, "appointments:confirm"));
    }
  }
  return (db.prepare(`
    SELECT id
    FROM app_users
    WHERE deleted_at IS NULL AND role IN ('admin', 'parent')
    ORDER BY id
  `).all() as Array<{ id: string }>).map((row) => row.id).filter(
    (userId) => userHasWorkspacePermission(userId, "appointments:confirm")
  );
}

function currentUserForId(userId: string): RequestUser | undefined {
  const row = db.prepare(`
    SELECT external_subject AS externalSubject
    FROM app_users
    WHERE id = ? AND deleted_at IS NULL
  `).get(userId) as { externalSubject: string } | undefined;
  return row ? findAuthenticatedUserBySubject(row.externalSubject) : undefined;
}

function canAccessConfirmation(user: RequestUser | undefined, entry: EntryRow): user is RequestUser {
  if (!user || !userHasWorkspacePermission(user.id, "appointments:confirm")) return false;
  return !entry.responsible_party_id || canUseCareParty(user, entry.responsible_party_id);
}

export function invalidateInaccessibleCareConfirmations(
  userId: string,
  timestamp = nowIso()
): number {
  const user = currentUserForId(userId);
  const rows = db.prepare(`
    SELECT requests.id, requests.care_entry_id AS careEntryId
    FROM care_confirmation_requests requests
    WHERE requests.user_id = ?
      AND requests.deleted_at IS NULL
      AND requests.answered_at IS NULL
  `).all(userId) as Array<{ id: string; careEntryId: string }>;
  const revoke = db.prepare(`
    UPDATE care_confirmation_requests
    SET deleted_at = ?, updated_at = ?
    WHERE id = ? AND deleted_at IS NULL
  `);
  let revoked = 0;
  for (const row of rows) {
    const entry = db.prepare("SELECT * FROM care_entries WHERE id = ? AND deleted_at IS NULL")
      .get(row.careEntryId) as EntryRow | undefined;
    if (!entry || !canAccessConfirmation(user, entry)) {
      revoked += revoke.run(timestamp, timestamp, row.id).changes;
    }
  }
  return revoked;
}

export function createDueCareConfirmationRequests(referenceTime = new Date()): number {
  const timestamp = nowIso();
  const entries = db.prepare(`
    SELECT *
    FROM care_entries
    WHERE deleted_at IS NULL
      AND status = 'planned'
      AND confirmed_at IS NULL
      AND end_datetime < ?
    ORDER BY end_datetime, id
  `).all(referenceTime.toISOString()) as EntryRow[];
  let created = 0;
  db.transaction(() => {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO care_confirmation_requests (
        id, care_entry_id, user_id, due_at, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'open', ?, ?)
    `);
    for (const entry of entries) {
      for (const userId of usersForEntry(entry)) {
        const result = insert.run(
          makeId("confirm"),
          entry.id,
          userId,
          dueAtForEntry(entry.end_datetime),
          timestamp,
          timestamp
        );
        created += result.changes;
      }
    }
  })();
  return created;
}

function defaultPreference(eventType: ApiNotificationEventType): ApiNotificationPreference {
  return {
    eventType,
    inAppEnabled: true,
    pushEnabled: true,
    emailEnabled: false
  };
}

export function getNotificationPreferences(userId: string): ApiNotificationPreferencesResponse {
  const rows = db.prepare(`
    SELECT event_type AS eventType, in_app_enabled AS inAppEnabled,
      push_enabled AS pushEnabled, email_enabled AS emailEnabled
    FROM notification_preferences
    WHERE user_id = ? AND deleted_at IS NULL
  `).all(userId) as Array<{
    eventType: ApiNotificationEventType;
    inAppEnabled: number;
    pushEnabled: number;
    emailEnabled: number;
  }>;
  const stored = new Map(rows.map((row) => [row.eventType, row]));
  const preferences = notificationEvents.map((eventType) => {
    const row = stored.get(eventType);
    return row
      ? {
          eventType,
          inAppEnabled: true,
          pushEnabled: bool(row.pushEnabled),
          emailEnabled: bool(row.emailEnabled)
        }
      : defaultPreference(eventType);
  });
  const subscriptionCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM push_subscriptions
    WHERE user_id = ? AND deleted_at IS NULL
  `).get(userId) as { count: number };
  return {
    preferences,
    pushAvailable: pushConfigured,
    pushConfigured,
    ...(config.webPushPublicKey ? { vapidPublicKey: config.webPushPublicKey } : {}),
    activePushSubscriptions: subscriptionCount.count
  };
}

export function updateNotificationPreferences(userId: string, preferences: ApiNotificationPreference[]): ApiNotificationPreferencesResponse {
  const timestamp = nowIso();
  db.transaction(() => {
    const upsert = db.prepare(`
      INSERT INTO notification_preferences (
        id, user_id, event_type, in_app_enabled, push_enabled, email_enabled,
        created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(user_id, event_type) WHERE deleted_at IS NULL DO UPDATE SET
        in_app_enabled = 1,
        push_enabled = excluded.push_enabled,
        email_enabled = excluded.email_enabled,
        updated_at = excluded.updated_at
    `);
    for (const preference of preferences) {
      upsert.run(
        makeId("pref"),
        userId,
        preference.eventType,
        Number(preference.pushEnabled),
        Number(preference.emailEnabled),
        timestamp,
        timestamp
      );
    }
  })();
  return getNotificationPreferences(userId);
}

function preferenceAllowsPush(userId: string, eventType: ApiNotificationEventType): boolean {
  const row = db.prepare(`
    SELECT push_enabled AS pushEnabled
    FROM notification_preferences
    WHERE user_id = ? AND event_type = ? AND deleted_at IS NULL
  `).get(userId, eventType) as { pushEnabled: number } | undefined;
  return row ? bool(row.pushEnabled) : true;
}

export function savePushSubscription(userId: string, input: ApiPushSubscriptionInput, userAgent?: string): void {
  if (!isAllowedPushEndpoint(input.endpoint)) {
    throw httpError(
      "invalid_push_endpoint",
      400,
      "Der Push-Endpunkt ist nicht zugelassen."
    );
  }
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO push_subscriptions (
      id, user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) WHERE deleted_at IS NULL DO UPDATE SET
      user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      updated_at = excluded.updated_at
  `).run(
    makeId("push"),
    userId,
    input.endpoint,
    input.keys.p256dh,
    input.keys.auth,
    userAgent ?? null,
    timestamp,
    timestamp
  );
}

export function deletePushSubscription(userId: string, id: string): boolean {
  const result = db.prepare(`
    UPDATE push_subscriptions
    SET deleted_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL
  `).run(nowIso(), nowIso(), id, userId);
  return result.changes > 0;
}

function pushSubscriptionsForUser(userId: string) {
  return db.prepare(`
    SELECT id, endpoint, p256dh, auth
    FROM push_subscriptions
    WHERE user_id = ? AND deleted_at IS NULL
  `).all(userId) as Array<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>;
}

async function sendPushForRequest(row: RequestRow, eventType: ApiNotificationEventType): Promise<boolean> {
  if (!pushConfigured || !preferenceAllowsPush(row.user_id, eventType)) return false;
  const payload = JSON.stringify({
    title: "Betreuung bestätigen",
    body: "Wurde eine geplante Betreuung durchgeführt?",
    url: `/?confirmation=${encodeURIComponent(row.id)}`
  });
  let delivered = false;
  for (const subscription of pushSubscriptionsForUser(row.user_id)) {
    if (!isAllowedPushEndpoint(subscription.endpoint)) {
      deletePushSubscription(row.user_id, subscription.id);
      continue;
    }
    const pushSubscription: PushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth
      }
    };
    try {
      await webPush.sendNotification(pushSubscription, payload);
      delivered = true;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        deletePushSubscription(row.user_id, subscription.id);
      }
    }
  }
  return delivered;
}

export async function sendDueCareConfirmationPushes(
  referenceTime = new Date(),
  deliverPush = sendPushForRequest
): Promise<number> {
  const now = referenceTime.toISOString();
  const rows = db.prepare(`
    SELECT *
    FROM care_confirmation_requests
    WHERE deleted_at IS NULL
      AND answered_at IS NULL
      AND (
        (status = 'open' AND due_at <= ? AND sent_at IS NULL)
        OR (status = 'snoozed' AND next_reminder_at IS NOT NULL AND next_reminder_at <= ?)
      )
    ORDER BY due_at, id
  `).all(now, now) as RequestRow[];
  const rowsByUser = new Map<string, RequestRow[]>();
  for (const row of rows) {
    const entry = db.prepare("SELECT * FROM care_entries WHERE id = ? AND deleted_at IS NULL")
      .get(row.care_entry_id) as EntryRow | undefined;
    if (!entry || !canAccessConfirmation(currentUserForId(row.user_id), entry)) continue;
    const userRows = rowsByUser.get(row.user_id) ?? [];
    userRows.push(row);
    rowsByUser.set(row.user_id, userRows);
  }

  let sent = 0;
  for (const userRows of rowsByUser.values()) {
    const representative = userRows.find((row) => row.status === "open") ?? userRows[0];
    if (!representative) continue;
    const eventType = representative.status === "snoozed"
      ? "care_confirmation_reminder"
      : "care_confirmation_due";
    const delivered = await deliverPush(representative, eventType);
    const timestamp = nowIso();
    const update = db.prepare(`
        UPDATE care_confirmation_requests
        SET sent_at = COALESCE(sent_at, ?),
          status = 'open',
          reminder_count = reminder_count + ?,
          next_reminder_at = NULL,
          updated_at = ?
        WHERE id = ?
      `);
    db.transaction(() => {
      for (const row of userRows) {
        update.run(timestamp, delivered ? 1 : 0, timestamp, row.id);
      }
    })();
    if (delivered) sent += 1;
  }
  return sent;
}

export async function runCareConfirmationSweep(referenceTime = new Date()): Promise<void> {
  createDueCareConfirmationRequests(referenceTime);
  await sendDueCareConfirmationPushes(referenceTime);
}

export async function listOpenCareConfirmations(userOrId: RequestUser | string): Promise<ApiCareConfirmationRequest[]> {
  await runCareConfirmationSweep();
  const user = typeof userOrId === "string" ? currentUserForId(userOrId) : userOrId;
  if (!user) return [];
  const rows = db.prepare(`
    SELECT *
    FROM care_confirmation_requests
    WHERE user_id = ?
      AND deleted_at IS NULL
      AND answered_at IS NULL
      AND status IN ('open', 'snoozed')
    ORDER BY due_at, id
  `).all(user.id) as RequestRow[];
  return rows.flatMap((row) => {
    const entry = db.prepare("SELECT * FROM care_entries WHERE id = ? AND deleted_at IS NULL")
      .get(row.care_entry_id) as EntryRow | undefined;
    return entry && canAccessConfirmation(user, entry) ? [mapRequest(row, entry)] : [];
  });
}

export function answerCareConfirmation(
  requestId: string,
  userOrId: RequestUser | string,
  answer: ApiCareConfirmationAnswer
): ApiCareConfirmationRequest | undefined {
  const userId = typeof userOrId === "string" ? userOrId : userOrId.id;
  const request = db.prepare(`
    SELECT *
    FROM care_confirmation_requests
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND answered_at IS NULL
  `).get(requestId, userId) as RequestRow | undefined;
  if (!request) return undefined;
  const before = db.prepare("SELECT * FROM care_entries WHERE id = ? AND deleted_at IS NULL")
    .get(request.care_entry_id) as EntryRow | undefined;
  if (!before) return undefined;
  if (typeof userOrId !== "string") {
    if (!canAccessConfirmation(userOrId, before)) return undefined;
    if (before.responsible_party_id) assertCanUseCareParty(userOrId, before.responsible_party_id);
  }
  const timestamp = nowIso();
  const note = answer.note?.trim() || answer.cancellationReason?.trim() || null;
  const actualStartDateTime = answer.status === "partial"
    ? answer.actualStartDateTime ?? before.start_datetime
    : null;
  const actualEndDateTime = answer.status === "partial"
    ? answer.actualEndDateTime ?? before.end_datetime
    : null;
  const actualResponsiblePartyId = answer.status === "partial"
    ? answer.actualResponsiblePartyId ?? before.responsible_party_id
    : null;
  const resolvedActualChildIds = answer.status === "partial"
    ? [...new Set(answer.actualChildIds ?? childIds(before.id))]
    : [];
  if (answer.status === "partial") {
    assertActiveChildren(resolvedActualChildIds);
    assertActiveCareParty(actualResponsiblePartyId ?? undefined);
    if (typeof userOrId !== "string" && actualResponsiblePartyId) {
      assertCanUseCareParty(userOrId, actualResponsiblePartyId);
    }
  }
  db.transaction(() => {
    assertNoActualCareConflict({
      id: before.id,
      status: answer.status,
      startDateTime: before.start_datetime,
      endDateTime: before.end_datetime,
      childIds: childIds(before.id),
      actualStartDateTime: actualStartDateTime ?? undefined,
      actualEndDateTime: actualEndDateTime ?? undefined,
      actualChildIds: resolvedActualChildIds
    }, db);
    db.prepare(`
      UPDATE care_entries
      SET status = ?, confirmation_note = ?, confirmed_at = ?, confirmed_by = ?,
        planned_start_datetime = ?, planned_end_datetime = ?, deviation_type = ?, deviation_note = ?,
        cancellation_reason = ?, actual_start_datetime = ?, actual_end_datetime = ?,
        actual_responsible_party_id = ?, updated_by = ?, updated_at = ?
      WHERE id = ?
    `).run(
      answer.status,
      note,
      timestamp,
      userId,
      answer.status === "completed" ? null : before.planned_start_datetime ?? before.start_datetime,
      answer.status === "completed" ? null : before.planned_end_datetime ?? before.end_datetime,
      answer.status === "completed" ? null : answer.status,
      answer.status === "completed" ? null : note,
      answer.status === "cancelled" ? answer.cancellationReason?.trim() || answer.note?.trim() || null : null,
      actualStartDateTime,
      actualEndDateTime,
      actualResponsiblePartyId,
      userId,
      timestamp,
      before.id
    );
    syncJunction("care_entry_actual_children", "care_entry_id", before.id, resolvedActualChildIds, timestamp);
    db.prepare(`
      UPDATE care_confirmation_requests
      SET status = 'answered', answered_at = ?, updated_at = ?
      WHERE care_entry_id = ? AND user_id = ? AND deleted_at IS NULL
    `).run(timestamp, timestamp, before.id, userId);
    const after = db.prepare("SELECT * FROM care_entries WHERE id = ?")
      .get(before.id) as EntryRow;
    recordFieldChanges(userId, "care_entry", before.id, mapEntry(before), mapEntry(after), []);
    recordAudit({
      userEmail: userId,
      entityType: "care_confirmation_request",
      entityId: request.id,
      action: "updated",
      oldValue: request,
      newValue: { ...request, status: "answered", answeredAt: timestamp }
    });
    markClosedMonthsChanged(userId, "care_entry", before.id, before.start_datetime.slice(0, 10), before.end_datetime.slice(0, 10), timestamp);
  })();
  const entry = db.prepare("SELECT * FROM care_entries WHERE id = ?")
    .get(request.care_entry_id) as EntryRow;
  const updated = db.prepare("SELECT * FROM care_confirmation_requests WHERE id = ?")
    .get(requestId) as RequestRow;
  return mapRequest(updated, entry);
}

export function remindCareConfirmationLater(
  requestId: string,
  userOrId: RequestUser | string,
  nextReminderAt?: string
): ApiCareConfirmationRequest | undefined {
  const userId = typeof userOrId === "string" ? userOrId : userOrId.id;
  const request = db.prepare(`
    SELECT *
    FROM care_confirmation_requests
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND answered_at IS NULL
  `).get(requestId, userId) as RequestRow | undefined;
  if (!request) return undefined;
  const entry = db.prepare("SELECT * FROM care_entries WHERE id = ? AND deleted_at IS NULL")
    .get(request.care_entry_id) as EntryRow | undefined;
  if (!entry) return undefined;
  if (typeof userOrId !== "string" && !canAccessConfirmation(userOrId, entry)) {
    return undefined;
  }
  const next = nextReminderAt ?? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  const timestamp = nowIso();
  db.prepare(`
    UPDATE care_confirmation_requests
    SET status = 'snoozed', next_reminder_at = ?, updated_at = ?
    WHERE id = ?
  `).run(next, timestamp, requestId);
  const updated = db.prepare("SELECT * FROM care_confirmation_requests WHERE id = ?")
    .get(requestId) as RequestRow;
  return mapRequest(updated, entry);
}
