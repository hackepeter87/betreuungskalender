import webPush, { type PushSubscription } from "web-push";
import { sql } from "kysely";
import type {
  ApiCareConfirmationAnswer,
  ApiCareConfirmationRequest,
  ApiNotificationEventType,
  ApiNotificationPreference,
  ApiNotificationPreferencesResponse,
  ApiPushSubscriptionInput
} from "../../shared/api.js";
import type { RequestUser } from "../auth.js";
import { config } from "../config.js";
import type { DatabaseExecutor, PersistenceRuntime } from "../db/runtime.js";
import {
  CareEntryConflictError,
  assertNoActualCareConflict,
  careConflictEntryIds
} from "./careConflicts.js";
import { bool, makeId, nowIso } from "./common.js";
import {
  assertCanUsePersistedCareParty,
  assertPersistedCareParty,
  assertPersistedChildren,
  markDomainClosedMonthsChanged,
  recordDomainAudit,
  recordDomainFieldChanges,
  syncPersistedChildJunction
} from "./domainPersistence.js";
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
    return url.protocol === "https:" && !url.username && !url.password &&
      config.webPushAllowedEndpointHosts.includes(hostname);
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

async function linkedChildIds(
  database: DatabaseExecutor,
  table: "care_entry_children" | "care_entry_actual_children",
  entryId: string
): Promise<string[]> {
  const rows = await database.selectFrom(table)
    .select("child_id")
    .where("care_entry_id", "=", entryId)
    .where("deleted_at", "is", null)
    .orderBy("child_id")
    .execute();
  return rows.map((row) => row.child_id);
}

async function mapEntry(
  database: DatabaseExecutor,
  row: EntryRow
): Promise<ApiCareConfirmationRequest["entry"]> {
  const [childIds, actualChildIds] = await Promise.all([
    linkedChildIds(database, "care_entry_children", row.id),
    linkedChildIds(database, "care_entry_actual_children", row.id)
  ]);
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
    childIds,
    actualChildIds,
    status: row.status,
    deviationType: optional(row.deviation_type),
    deviationNote: optional(row.deviation_note),
    ...(unconfirmed ? { confirmationState: "unconfirmed" as const } :
      row.confirmed_at ? { confirmationState: "confirmed" as const } : {}),
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

async function mapRequest(
  database: DatabaseExecutor,
  row: RequestRow,
  entry: EntryRow
): Promise<ApiCareConfirmationRequest> {
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
    entry: await mapEntry(database, entry)
  };
}

function dueAtForEntry(endDateTime: string): string {
  const due = new Date(endDateTime);
  due.setDate(due.getDate() + 1);
  due.setHours(8, 0, 0, 0);
  return due.toISOString();
}

async function activeCarePartyAssignmentsExist(database: DatabaseExecutor): Promise<boolean> {
  return Boolean(await database.selectFrom("app_user_care_party_assignments")
    .select("id")
    .where("deleted_at", "is", null)
    .executeTakeFirst());
}

async function usersForEntry(database: DatabaseExecutor, entry: EntryRow): Promise<string[]> {
  if (entry.responsible_party_id && await activeCarePartyAssignmentsExist(database)) {
    const rows = await database.selectFrom("app_user_care_party_assignments")
      .select("user_id")
      .where("care_party_id", "=", entry.responsible_party_id)
      .where("deleted_at", "is", null)
      .orderBy("user_id")
      .execute();
    if (rows.length) {
      const allowed = await Promise.all(rows.map(async (row) => ({
        userId: row.user_id,
        allowed: await userHasWorkspacePermission(row.user_id, "appointments:confirm", database)
      })));
      return allowed.filter((item) => item.allowed).map((item) => item.userId);
    }
  }
  const users = await database.selectFrom("app_users")
    .select("id")
    .where("deleted_at", "is", null)
    .where("role", "in", ["admin", "parent"])
    .orderBy("id")
    .execute();
  const allowed = await Promise.all(users.map(async ({ id }) => ({
    userId: id,
    allowed: await userHasWorkspacePermission(id, "appointments:confirm", database)
  })));
  return allowed.filter((item) => item.allowed).map((item) => item.userId);
}

async function currentUserForId(database: DatabaseExecutor, userId: string): Promise<RequestUser | undefined> {
  const row = await database.selectFrom("app_users")
    .select("external_subject")
    .where("id", "=", userId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  return row ? findAuthenticatedUserBySubject(row.external_subject, database) : undefined;
}

async function canAccessConfirmation(
  database: DatabaseExecutor,
  user: RequestUser | undefined,
  entry: EntryRow
): Promise<boolean> {
  if (!user || !(await userHasWorkspacePermission(user.id, "appointments:confirm", database))) return false;
  try {
    await assertCanUsePersistedCareParty(database, user, entry.responsible_party_id ?? undefined);
    return true;
  } catch {
    return false;
  }
}

async function getEntry(database: DatabaseExecutor, id: string): Promise<EntryRow | undefined> {
  return await database.selectFrom("care_entries")
    .selectAll()
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .executeTakeFirst() as EntryRow | undefined;
}

async function getRequest(database: DatabaseExecutor, id: string): Promise<RequestRow | undefined> {
  return await database.selectFrom("care_confirmation_requests")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst() as RequestRow | undefined;
}

export async function invalidateInaccessibleCareConfirmations(
  runtime: PersistenceRuntime,
  userId: string,
  timestamp = nowIso()
): Promise<number> {
  const user = await currentUserForId(runtime.query, userId);
  const rows = await runtime.query.selectFrom("care_confirmation_requests")
    .select(["id", "care_entry_id"])
    .where("user_id", "=", userId)
    .where("deleted_at", "is", null)
    .where("answered_at", "is", null)
    .execute();
  let revoked = 0n;
  await runtime.transaction(async (database) => {
    for (const row of rows) {
      const entry = await getEntry(database, row.care_entry_id);
      if (!entry || !(await canAccessConfirmation(database, user, entry))) {
        const result = await database.updateTable("care_confirmation_requests")
          .set({ deleted_at: timestamp, updated_at: timestamp })
          .where("id", "=", row.id)
          .where("deleted_at", "is", null)
          .executeTakeFirst();
        revoked += result.numUpdatedRows;
      }
    }
  });
  return Number(revoked);
}

export async function createDueCareConfirmationRequests(
  runtime: PersistenceRuntime,
  referenceTime = new Date()
): Promise<number> {
  const timestamp = nowIso();
  const conflictIds = await careConflictEntryIds(runtime.query);
  if (!conflictIds) return 0;
  const entries = await runtime.query.selectFrom("care_entries")
    .selectAll()
    .where("deleted_at", "is", null)
    .where("status", "=", "planned")
    .where("confirmed_at", "is", null)
    .where("confirmation_suppressed", "=", 0)
    .where("end_datetime", "<", referenceTime.toISOString())
    .orderBy("end_datetime")
    .orderBy("id")
    .execute() as EntryRow[];
  const entryUsers = new Map<string, string[]>(await Promise.all(
    entries.filter((entry) => !conflictIds.has(entry.id))
      .map(async (entry) => [entry.id, await usersForEntry(runtime.query, entry)] as const)
  ));
  return runtime.transaction(async (database) => {
    if (conflictIds.size) {
      await database.updateTable("care_confirmation_requests")
        .set({ deleted_at: timestamp, updated_at: timestamp })
        .where("answered_at", "is", null)
        .where("deleted_at", "is", null)
        .where("care_entry_id", "in", [...conflictIds])
        .execute();
    }
    let created = 0n;
    for (const entry of entries) {
      if (conflictIds.has(entry.id)) continue;
      for (const userId of entryUsers.get(entry.id) ?? []) {
        const result = await database.insertInto("care_confirmation_requests").values({
          id: makeId("confirm"),
          care_entry_id: entry.id,
          user_id: userId,
          due_at: dueAtForEntry(entry.end_datetime),
          sent_at: null,
          answered_at: null,
          status: "open",
          reminder_count: 0,
          next_reminder_at: null,
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null
        }).onConflict((conflict) => conflict.doNothing()).executeTakeFirst();
        created += result.numInsertedOrUpdatedRows ?? 0n;
      }
    }
    return Number(created);
  });
}

function defaultPreference(eventType: ApiNotificationEventType): ApiNotificationPreference {
  return { eventType, inAppEnabled: true, pushEnabled: true, emailEnabled: false };
}

export async function getNotificationPreferences(
  database: DatabaseExecutor,
  userId: string
): Promise<ApiNotificationPreferencesResponse> {
  const rows = await database.selectFrom("notification_preferences")
    .select(["event_type", "push_enabled", "email_enabled"])
    .where("user_id", "=", userId)
    .where("deleted_at", "is", null)
    .execute();
  const stored = new Map(rows.map((row) => [row.event_type, row]));
  const preferences = notificationEvents.map((eventType) => {
    const row = stored.get(eventType);
    return row ? {
      eventType,
      inAppEnabled: true,
      pushEnabled: bool(row.push_enabled),
      emailEnabled: bool(row.email_enabled)
    } : defaultPreference(eventType);
  });
  const subscriptionCount = await database.selectFrom("push_subscriptions")
    .select(({ fn }) => fn.count<number>("id").as("count"))
    .where("user_id", "=", userId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  return {
    preferences,
    pushAvailable: pushConfigured,
    pushConfigured,
    ...(config.webPushPublicKey ? { vapidPublicKey: config.webPushPublicKey } : {}),
    activePushSubscriptions: Number(subscriptionCount?.count ?? 0)
  };
}

export async function updateNotificationPreferences(
  runtime: PersistenceRuntime,
  userId: string,
  preferences: ApiNotificationPreference[]
): Promise<ApiNotificationPreferencesResponse> {
  const timestamp = nowIso();
  await runtime.transaction(async (database) => {
    for (const preference of preferences) {
      await database.insertInto("notification_preferences").values({
        id: makeId("pref"),
        user_id: userId,
        event_type: preference.eventType,
        in_app_enabled: 1,
        push_enabled: Number(preference.pushEnabled),
        email_enabled: Number(preference.emailEnabled),
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null
      }).onConflict((conflict) => conflict.columns(["user_id", "event_type"])
        .where("deleted_at", "is", null)
        .doUpdateSet({
          in_app_enabled: 1,
          push_enabled: Number(preference.pushEnabled),
          email_enabled: Number(preference.emailEnabled),
          updated_at: timestamp
        })).execute();
    }
  });
  return getNotificationPreferences(runtime.query, userId);
}

async function preferenceAllowsPush(
  database: DatabaseExecutor,
  userId: string,
  eventType: ApiNotificationEventType
): Promise<boolean> {
  const row = await database.selectFrom("notification_preferences")
    .select("push_enabled")
    .where("user_id", "=", userId)
    .where("event_type", "=", eventType)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  return row ? bool(row.push_enabled) : true;
}

export async function savePushSubscription(
  database: DatabaseExecutor,
  userId: string,
  input: ApiPushSubscriptionInput,
  userAgent?: string
): Promise<void> {
  if (!isAllowedPushEndpoint(input.endpoint)) {
    throw httpError("invalid_push_endpoint", 400, "Der Push-Endpunkt ist nicht zugelassen.");
  }
  const timestamp = nowIso();
  await database.insertInto("push_subscriptions").values({
    id: makeId("push"),
    user_id: userId,
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    user_agent: userAgent ?? null,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null
  }).onConflict((conflict) => conflict.column("endpoint")
    .where("deleted_at", "is", null)
    .doUpdateSet({
      user_id: userId,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      user_agent: userAgent ?? null,
      updated_at: timestamp
    })).execute();
}

export async function deletePushSubscription(
  database: DatabaseExecutor,
  userId: string,
  id: string
): Promise<boolean> {
  const timestamp = nowIso();
  const result = await database.updateTable("push_subscriptions")
    .set({ deleted_at: timestamp, updated_at: timestamp })
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

async function pushSubscriptionsForUser(database: DatabaseExecutor, userId: string) {
  return database.selectFrom("push_subscriptions")
    .select(["id", "endpoint", "p256dh", "auth"])
    .where("user_id", "=", userId)
    .where("deleted_at", "is", null)
    .execute();
}

async function sendPushForRequest(
  database: DatabaseExecutor,
  row: RequestRow,
  eventType: ApiNotificationEventType
): Promise<boolean> {
  if (!pushConfigured || !(await preferenceAllowsPush(database, row.user_id, eventType))) return false;
  const payload = JSON.stringify({
    title: "Betreuung bestätigen",
    body: "Wurde eine geplante Betreuung durchgeführt?",
    url: `/?confirmation=${encodeURIComponent(row.id)}`
  });
  let delivered = false;
  for (const subscription of await pushSubscriptionsForUser(database, row.user_id)) {
    if (!isAllowedPushEndpoint(subscription.endpoint)) {
      await deletePushSubscription(database, row.user_id, subscription.id);
      continue;
    }
    const pushSubscription: PushSubscription = {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth }
    };
    try {
      await webPush.sendNotification(pushSubscription, payload);
      delivered = true;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await deletePushSubscription(database, row.user_id, subscription.id);
      }
    }
  }
  return delivered;
}

export async function sendDueCareConfirmationPushes(
  runtime: PersistenceRuntime,
  referenceTime = new Date(),
  deliverPush: (
    database: DatabaseExecutor,
    row: RequestRow,
    eventType: ApiNotificationEventType
  ) => Promise<boolean> = sendPushForRequest
): Promise<number> {
  const now = referenceTime.toISOString();
  const conflictIds = await careConflictEntryIds(runtime.query);
  if (!conflictIds) return 0;
  const rows = await runtime.query.selectFrom("care_confirmation_requests")
    .selectAll()
    .where("deleted_at", "is", null)
    .where("answered_at", "is", null)
    .where((expression) => expression.or([
      expression.and([
        expression("status", "=", "open"),
        expression("due_at", "<=", now),
        expression("sent_at", "is", null)
      ]),
      expression.and([
        expression("status", "=", "snoozed"),
        expression("next_reminder_at", "is not", null),
        expression("next_reminder_at", "<=", now)
      ])
    ]))
    .orderBy("due_at")
    .orderBy("id")
    .execute() as RequestRow[];
  const rowsByUser = new Map<string, RequestRow[]>();
  for (const row of rows) {
    if (conflictIds.has(row.care_entry_id)) continue;
    const entry = await getEntry(runtime.query, row.care_entry_id);
    const user = await currentUserForId(runtime.query, row.user_id);
    if (!entry || !(await canAccessConfirmation(runtime.query, user, entry))) continue;
    rowsByUser.set(row.user_id, [...(rowsByUser.get(row.user_id) ?? []), row]);
  }

  let sent = 0;
  for (const userRows of rowsByUser.values()) {
    const representative = userRows.find((row) => row.status === "open") ?? userRows[0];
    if (!representative) continue;
    const eventType = representative.status === "snoozed"
      ? "care_confirmation_reminder"
      : "care_confirmation_due";
    const delivered = await deliverPush(runtime.query, representative, eventType);
    const timestamp = nowIso();
    await runtime.transaction(async (database) => {
      for (const row of userRows) {
        await database.updateTable("care_confirmation_requests").set({
          sent_at: sql`COALESCE(sent_at, ${timestamp})`,
          status: "open",
          reminder_count: sql`reminder_count + ${delivered ? 1 : 0}`,
          next_reminder_at: null,
          updated_at: timestamp
        }).where("id", "=", row.id).execute();
      }
    });
    if (delivered) sent += 1;
  }
  return sent;
}

export async function runCareConfirmationSweep(
  runtime: PersistenceRuntime,
  referenceTime = new Date()
): Promise<void> {
  await createDueCareConfirmationRequests(runtime, referenceTime);
  await sendDueCareConfirmationPushes(runtime, referenceTime);
}

export async function listOpenCareConfirmations(
  runtime: PersistenceRuntime,
  userOrId: RequestUser | string
): Promise<ApiCareConfirmationRequest[]> {
  await runCareConfirmationSweep(runtime);
  const conflictIds = await careConflictEntryIds(runtime.query);
  if (!conflictIds) return [];
  const user = typeof userOrId === "string" ? await currentUserForId(runtime.query, userOrId) : userOrId;
  if (!user) return [];
  const rows = await runtime.query.selectFrom("care_confirmation_requests")
    .selectAll()
    .where("user_id", "=", user.id)
    .where("deleted_at", "is", null)
    .where("answered_at", "is", null)
    .where("status", "in", ["open", "snoozed"])
    .orderBy("due_at")
    .orderBy("id")
    .execute() as RequestRow[];
  const visible: ApiCareConfirmationRequest[] = [];
  for (const row of rows) {
    if (conflictIds.has(row.care_entry_id)) continue;
    const entry = await getEntry(runtime.query, row.care_entry_id);
    if (entry && await canAccessConfirmation(runtime.query, user, entry)) {
      visible.push(await mapRequest(runtime.query, row, entry));
    }
  }
  return visible;
}

export async function answerCareConfirmation(
  runtime: PersistenceRuntime,
  requestId: string,
  userOrId: RequestUser | string,
  answer: ApiCareConfirmationAnswer
): Promise<ApiCareConfirmationRequest | undefined> {
  const userId = typeof userOrId === "string" ? userOrId : userOrId.id;
  const request = await runtime.query.selectFrom("care_confirmation_requests")
    .selectAll()
    .where("id", "=", requestId)
    .where("user_id", "=", userId)
    .where("deleted_at", "is", null)
    .where("answered_at", "is", null)
    .executeTakeFirst() as RequestRow | undefined;
  if (!request) return undefined;
  const before = await getEntry(runtime.query, request.care_entry_id);
  if (!before) return undefined;
  const conflictIds = await careConflictEntryIds(runtime.query);
  if (!conflictIds || conflictIds.has(before.id)) throw new CareEntryConflictError();
  if (typeof userOrId !== "string" && !(await canAccessConfirmation(runtime.query, userOrId, before))) {
    return undefined;
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
  const plannedChildIds = await linkedChildIds(runtime.query, "care_entry_children", before.id);
  const resolvedActualChildIds = answer.status === "partial"
    ? [...new Set(answer.actualChildIds ?? plannedChildIds)]
    : [];
  if (answer.status === "partial") {
    await assertPersistedChildren(runtime.query, resolvedActualChildIds);
    await assertPersistedCareParty(runtime.query, actualResponsiblePartyId ?? undefined);
    if (typeof userOrId !== "string") {
      await assertCanUsePersistedCareParty(runtime.query, userOrId, actualResponsiblePartyId ?? undefined);
    }
  }
  const result = await runtime.transaction(async (database) => {
    await assertNoActualCareConflict({
      id: before.id,
      status: answer.status,
      startDateTime: before.start_datetime,
      endDateTime: before.end_datetime,
      childIds: plannedChildIds,
      actualStartDateTime: actualStartDateTime ?? undefined,
      actualEndDateTime: actualEndDateTime ?? undefined,
      actualChildIds: resolvedActualChildIds
    }, database);
    await database.updateTable("care_entries").set({
      status: answer.status,
      confirmation_note: note,
      confirmed_at: timestamp,
      confirmed_by: userId,
      planned_start_datetime: answer.status === "completed" ? null : before.planned_start_datetime ?? before.start_datetime,
      planned_end_datetime: answer.status === "completed" ? null : before.planned_end_datetime ?? before.end_datetime,
      deviation_type: answer.status === "completed" ? null : answer.status,
      deviation_note: answer.status === "completed" ? null : note,
      cancellation_reason: answer.status === "cancelled"
        ? answer.cancellationReason?.trim() || answer.note?.trim() || null
        : null,
      actual_start_datetime: actualStartDateTime,
      actual_end_datetime: actualEndDateTime,
      actual_responsible_party_id: actualResponsiblePartyId,
      updated_by: userId,
      updated_at: timestamp
    }).where("id", "=", before.id).execute();
    await syncPersistedChildJunction(
      database,
      { table: "care_entry_actual_children", owner: "care_entry_id" },
      before.id,
      resolvedActualChildIds,
      timestamp
    );
    await database.updateTable("care_confirmation_requests").set({
      status: "answered",
      answered_at: timestamp,
      updated_at: timestamp
    }).where("care_entry_id", "=", before.id)
      .where("user_id", "=", userId)
      .where("deleted_at", "is", null)
      .execute();
    const after = await getEntry(database, before.id);
    if (!after) throw new Error("Betreuungseintrag wurde nicht gefunden.");
    await recordDomainFieldChanges(
      database,
      userId,
      "care_entry",
      before.id,
      await mapEntry(database, before),
      await mapEntry(database, after)
    );
    await recordDomainAudit(database, {
      userEmail: userId,
      entityType: "care_confirmation_request",
      entityId: request.id,
      action: "updated",
      oldValue: request,
      newValue: { ...request, status: "answered", answeredAt: timestamp }
    });
    await markDomainClosedMonthsChanged(
      database,
      userId,
      "care_entry",
      before.id,
      before.start_datetime.slice(0, 10),
      before.end_datetime.slice(0, 10),
      timestamp
    );
    const updated = await getRequest(database, requestId);
    if (!updated) throw new Error("Bestätigungsanfrage wurde nicht gefunden.");
    return mapRequest(database, updated, after);
  });
  return result;
}

export async function remindCareConfirmationLater(
  runtime: PersistenceRuntime,
  requestId: string,
  userOrId: RequestUser | string,
  nextReminderAt?: string
): Promise<ApiCareConfirmationRequest | undefined> {
  const userId = typeof userOrId === "string" ? userOrId : userOrId.id;
  const request = await runtime.query.selectFrom("care_confirmation_requests")
    .selectAll()
    .where("id", "=", requestId)
    .where("user_id", "=", userId)
    .where("deleted_at", "is", null)
    .where("answered_at", "is", null)
    .executeTakeFirst() as RequestRow | undefined;
  if (!request) return undefined;
  const entry = await getEntry(runtime.query, request.care_entry_id);
  if (!entry) return undefined;
  if (typeof userOrId !== "string" && !(await canAccessConfirmation(runtime.query, userOrId, entry))) {
    return undefined;
  }
  const next = nextReminderAt ?? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  const timestamp = nowIso();
  await runtime.query.updateTable("care_confirmation_requests")
    .set({ status: "snoozed", next_reminder_at: next, updated_at: timestamp })
    .where("id", "=", requestId)
    .execute();
  const updated = await getRequest(runtime.query, requestId);
  return updated ? mapRequest(runtime.query, updated, entry) : undefined;
}
