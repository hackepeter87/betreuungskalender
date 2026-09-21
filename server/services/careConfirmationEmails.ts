import type { ApiNotificationEventType } from "../../shared/api.js";
import type { DatabaseExecutor, PersistenceRuntime } from "../db/runtime.js";
import { careConflictEntryIds } from "./careConflicts.js";
import {
  isCareConfirmationRequestActionable,
  NotificationProcessingLimitError
} from "./careConfirmations.js";
import { bool, makeId } from "./common.js";
import { usableNotificationEmailAddress } from "./notificationEmail.js";

const MAX_EMAIL_OCCURRENCES_PER_SWEEP = 10_000;
const MAX_DELIVERY_ATTEMPTS = 3;
const FIRST_RETRY_DELAY_MS = 15 * 60 * 1_000;
const SECOND_RETRY_DELAY_MS = 60 * 60 * 1_000;
const DELIVERY_ATTEMPT_TIMEOUT_MS = 30 * 1_000;
const DELIVERY_CLAIM_LEASE_MS = 2 * 60 * 1_000;

type DeliveryStatus = "pending" | "sent" | "failed";
type DeliveryErrorCode = "delivery_failed" | "not_actionable" | "recipient_unavailable";

interface RequestCandidate {
  id: string;
  user_id: string;
  due_at: string;
  status: "open" | "answered" | "snoozed";
  next_reminder_at: string | null;
}

interface DeliveryCandidate {
  id: string;
  care_confirmation_request_id: string;
  event_type: ApiNotificationEventType;
  occurrence_key: string;
  status: DeliveryStatus;
  attempt_count: number;
  next_attempt_at: string | null;
  user_id: string;
  email: string | null;
  request_status: "open" | "answered" | "snoozed";
  due_at: string;
  next_reminder_at: string | null;
  email_enabled: number | null;
}

export interface CareConfirmationEmailBatch {
  eventType: ApiNotificationEventType;
  recipientEmail: string;
  requestIds: readonly string[];
}

export interface CareConfirmationEmailProcessingResult {
  batchesAttempted: number;
  batchesSent: number;
  occurrencesSent: number;
}

export type DeliverCareConfirmationEmailBatch = (
  batch: CareConfirmationEmailBatch
) => Promise<boolean>;

function eventIdentity(request: RequestCandidate): {
  eventType: ApiNotificationEventType;
  occurrenceKey: string;
} | undefined {
  if (request.status === "open") {
    return {
      eventType: "care_confirmation_due",
      occurrenceKey: `due:${request.due_at}`
    };
  }
  if (request.status === "snoozed" && request.next_reminder_at) {
    return {
      eventType: "care_confirmation_reminder",
      occurrenceKey: `reminder:${request.next_reminder_at}`
    };
  }
  return undefined;
}

function currentIdentity(delivery: DeliveryCandidate): string | undefined {
  return eventIdentity({
    id: delivery.care_confirmation_request_id,
    user_id: delivery.user_id,
    due_at: delivery.due_at,
    status: delivery.request_status,
    next_reminder_at: delivery.next_reminder_at
  })?.occurrenceKey;
}

async function createPendingOccurrences(
  runtime: PersistenceRuntime,
  referenceTime: Date
): Promise<void> {
  const now = referenceTime.toISOString();
  const requests = await runtime.query.selectFrom("care_confirmation_requests as request")
    .innerJoin("notification_preferences as preference", (join) => join
      .onRef("preference.user_id", "=", "request.user_id")
      .on("preference.email_enabled", "=", 1)
      .on("preference.deleted_at", "is", null))
    .select([
      "request.id",
      "request.user_id",
      "request.due_at",
      "request.status",
      "request.next_reminder_at"
    ])
    .where("request.deleted_at", "is", null)
    .where("request.answered_at", "is", null)
    .where((expression) => expression.or([
      expression.and([
        expression("request.status", "=", "open"),
        expression("request.due_at", "<=", now),
        expression("preference.event_type", "=", "care_confirmation_due")
      ]),
      expression.and([
        expression("request.status", "=", "snoozed"),
        expression("request.next_reminder_at", "is not", null),
        expression("request.next_reminder_at", "<=", now),
        expression("preference.event_type", "=", "care_confirmation_reminder")
      ])
    ]))
    .orderBy("request.due_at")
    .orderBy("request.id")
    .limit(MAX_EMAIL_OCCURRENCES_PER_SWEEP + 1)
    .execute() as RequestCandidate[];
  if (requests.length > MAX_EMAIL_OCCURRENCES_PER_SWEEP) {
    throw new NotificationProcessingLimitError();
  }

  await runtime.transaction(async (database) => {
    for (const request of requests) {
      const identity = eventIdentity(request);
      if (!identity) continue;
      await database.insertInto("care_confirmation_email_deliveries").values({
        id: makeId("confirmation_email"),
        care_confirmation_request_id: request.id,
        event_type: identity.eventType,
        occurrence_key: identity.occurrenceKey,
        status: "pending",
        attempt_count: 0,
        next_attempt_at: now,
        sent_at: null,
        error_code: null,
        created_at: now,
        updated_at: now
      }).onConflict((conflict) => conflict
        .columns(["care_confirmation_request_id", "event_type", "occurrence_key"])
        .doNothing())
        .execute();
    }
  });
}

async function markTerminalFailure(
  database: DatabaseExecutor,
  deliveryId: string,
  code: Exclude<DeliveryErrorCode, "delivery_failed">,
  timestamp: string
): Promise<void> {
  await database.updateTable("care_confirmation_email_deliveries")
    .set({
      status: "failed",
      next_attempt_at: null,
      error_code: code,
      updated_at: timestamp
    })
    .where("id", "=", deliveryId)
    .where("status", "!=", "sent")
    .execute();
}

function retryAt(referenceTime: Date, attemptCount: number): string | null {
  const delay = attemptCount === 1
    ? FIRST_RETRY_DELAY_MS
    : attemptCount === 2
      ? SECOND_RETRY_DELAY_MS
      : undefined;
  return delay === undefined
    ? null
    : new Date(referenceTime.getTime() + delay).toISOString();
}

async function deliverWithinTimeout(
  deliver: DeliverCareConfirmationEmailBatch,
  batch: CareConfirmationEmailBatch
): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      deliver(batch).catch(() => false),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), DELIVERY_ATTEMPT_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function processCareConfirmationEmailDeliveries(
  runtime: PersistenceRuntime,
  referenceTime: Date,
  deliver: DeliverCareConfirmationEmailBatch
): Promise<CareConfirmationEmailProcessingResult> {
  await createPendingOccurrences(runtime, referenceTime);
  const now = referenceTime.toISOString();
  const conflictIds = await careConflictEntryIds(runtime.query);
  if (!conflictIds) {
    return { batchesAttempted: 0, batchesSent: 0, occurrencesSent: 0 };
  }
  const candidates = await runtime.query
    .selectFrom("care_confirmation_email_deliveries as delivery")
    .innerJoin(
      "care_confirmation_requests as request",
      "request.id",
      "delivery.care_confirmation_request_id"
    )
    .innerJoin("app_users as user", "user.id", "request.user_id")
    .leftJoin("notification_preferences as preference", (join) => join
      .onRef("preference.user_id", "=", "request.user_id")
      .onRef("preference.event_type", "=", "delivery.event_type")
      .on("preference.deleted_at", "is", null))
    .select([
      "delivery.id",
      "delivery.care_confirmation_request_id",
      "delivery.event_type",
      "delivery.occurrence_key",
      "delivery.status",
      "delivery.attempt_count",
      "delivery.next_attempt_at",
      "request.user_id",
      "request.status as request_status",
      "request.due_at",
      "request.next_reminder_at",
      "user.email",
      "preference.email_enabled"
    ])
    .where("delivery.status", "in", ["pending", "failed"])
    .where("delivery.attempt_count", "<", MAX_DELIVERY_ATTEMPTS)
    .where("delivery.next_attempt_at", "is not", null)
    .where("delivery.next_attempt_at", "<=", now)
    .orderBy("delivery.next_attempt_at")
    .orderBy("delivery.id")
    .limit(MAX_EMAIL_OCCURRENCES_PER_SWEEP + 1)
    .execute() as DeliveryCandidate[];
  if (candidates.length > MAX_EMAIL_OCCURRENCES_PER_SWEEP) {
    throw new NotificationProcessingLimitError();
  }

  const claimed = new Map<string, DeliveryCandidate[]>();
  for (const candidate of candidates) {
    const email = usableNotificationEmailAddress(candidate.email) ?? "";
    const currentOccurrence = currentIdentity(candidate);
    const actionable = currentOccurrence === candidate.occurrence_key &&
      await isCareConfirmationRequestActionable(
        runtime.query,
        candidate.care_confirmation_request_id,
        candidate.user_id,
        conflictIds
      );
    const preferenceEnabled = candidate.email_enabled !== null &&
      bool(candidate.email_enabled);
    if (!actionable || !preferenceEnabled) {
      await markTerminalFailure(runtime.query, candidate.id, "not_actionable", now);
      continue;
    }
    if (!email) {
      await markTerminalFailure(runtime.query, candidate.id, "recipient_unavailable", now);
      continue;
    }

    const nextAttemptCount = candidate.attempt_count + 1;
    const claimedResult = await runtime.query
      .updateTable("care_confirmation_email_deliveries")
      .set({
        status: "pending",
        attempt_count: nextAttemptCount,
        next_attempt_at: new Date(
          referenceTime.getTime() + DELIVERY_CLAIM_LEASE_MS
        ).toISOString(),
        error_code: null,
        updated_at: now
      })
      .where("id", "=", candidate.id)
      .where("status", "=", candidate.status)
      .where("attempt_count", "=", candidate.attempt_count)
      .where("next_attempt_at", "=", candidate.next_attempt_at)
      .executeTakeFirst();
    if (claimedResult.numUpdatedRows !== 1n) continue;
    const key = `${candidate.user_id}\u0000${candidate.event_type}\u0000${email}`;
    claimed.set(key, [...(claimed.get(key) ?? []), {
      ...candidate,
      email,
      attempt_count: nextAttemptCount
    }]);
  }

  let batchesAttempted = 0;
  let batchesSent = 0;
  let occurrencesSent = 0;
  for (const deliveries of claimed.values()) {
    const first = deliveries[0];
    if (!first?.email) continue;
    batchesAttempted += 1;
    const delivered = await deliverWithinTimeout(deliver, {
      eventType: first.event_type,
      recipientEmail: first.email,
      requestIds: deliveries.map((delivery) => delivery.care_confirmation_request_id)
    });
    await runtime.transaction(async (database) => {
      for (const delivery of deliveries) {
        await database.updateTable("care_confirmation_email_deliveries")
          .set({
            status: delivered ? "sent" : "failed",
            sent_at: delivered ? now : null,
            next_attempt_at: delivered ? null : retryAt(referenceTime, delivery.attempt_count),
            error_code: delivered ? null : "delivery_failed",
            updated_at: now
          })
          .where("id", "=", delivery.id)
          .where("attempt_count", "=", delivery.attempt_count)
          .where("status", "=", "pending")
          .execute();
      }
    });
    if (delivered) {
      batchesSent += 1;
      occurrencesSent += deliveries.length;
    }
  }
  return { batchesAttempted, batchesSent, occurrencesSent };
}
