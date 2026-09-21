import type { FastifyInstance } from "fastify";
import { omitUndefinedValues } from "../../shared/objects.js";
import { config } from "../config.js";
import {
  answerCareConfirmation,
  deletePushSubscription,
  getNotificationPreferences,
  isEmailNotificationsUnavailableError,
  isCareConfirmationNoLongerActionableError,
  isInvalidCareConfirmationRangeError,
  isNotificationProcessingLimitError,
  listOpenCareConfirmations,
  remindCareConfirmationLater,
  savePushSubscription,
  updateNotificationPreferences
} from "../services/careConfirmations.js";
import { isCareEntryConflictError } from "../services/careConflicts.js";
import {
  careConfirmationAnswerSchema,
  careConfirmationRemindLaterSchema,
  notificationPreferencesSchema,
  pushSubscriptionSchema
} from "../validation/schemas.js";

const readLimit = {
  config: { permission: "notifications:manage-own" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { permission: "notifications:manage-own" as const, rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};
const confirmationLimit = {
  config: { permission: "appointments:confirm" as const, rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};

export async function careConfirmationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/care-confirmations/open", readLimit, async (request, reply) => {
    try {
      return request.user ? await listOpenCareConfirmations(app.persistence, request.user) : [];
    } catch (error) {
      if (isNotificationProcessingLimitError(error)) {
        return reply.header("cache-control", "no-store").code(503).send({
          error: "notification_processing_limit"
        });
      }
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/api/care-confirmations/:id/answer", confirmationLimit, async (request, reply) => {
    const parsed = careConfirmationAnswerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    if (!request.user) return reply.code(401).send({ error: "authentication_required" });
    let result: Awaited<ReturnType<typeof answerCareConfirmation>>;
    try {
      result = await answerCareConfirmation(
        app.persistence,
        request.params.id,
        request.user,
        omitUndefinedValues(parsed.data)
      );
    } catch (error) {
      if (isCareConfirmationNoLongerActionableError(error)) {
        return reply.code(409).send({ error: "confirmation_no_longer_actionable" });
      }
      if (isCareEntryConflictError(error)) {
        return reply.code(409).send({ error: "care_entry_conflict" });
      }
      if (isInvalidCareConfirmationRangeError(error)) {
        return reply.code(400).send({ error: "invalid_actual_range" });
      }
      return reply.code(400).send({
        error: "invalid_relation",
        message: error instanceof Error ? error.message : String(error)
      });
    }
    return result ?? reply.code(404).send({ error: "not_found" });
  });

  app.post<{ Params: { id: string } }>("/api/care-confirmations/:id/remind-later", confirmationLimit, async (request, reply) => {
    const parsed = careConfirmationRemindLaterSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    if (!request.user) return reply.code(401).send({ error: "authentication_required" });
    let result: Awaited<ReturnType<typeof remindCareConfirmationLater>>;
    try {
      result = await remindCareConfirmationLater(
        app.persistence,
        request.params.id,
        request.user,
        parsed.data.nextReminderAt
      );
    } catch (error) {
      if (isCareConfirmationNoLongerActionableError(error)) {
        return reply.code(409).send({ error: "confirmation_no_longer_actionable" });
      }
      throw error;
    }
    return result ?? reply.code(404).send({ error: "not_found" });
  });

  app.get("/api/notification-preferences", readLimit, async (request, reply) => {
    reply.header("cache-control", "no-store");
    return getNotificationPreferences(app.persistence.query, request.userEmail);
  });

  app.put("/api/notification-preferences", writeLimit, async (request, reply) => {
    const parsed = notificationPreferencesSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    try {
      const preferences = await updateNotificationPreferences(
        app.persistence,
        request.userEmail,
        parsed.data.preferences
      );
      return reply.header("cache-control", "no-store").send(preferences);
    } catch (error) {
      if (isEmailNotificationsUnavailableError(error)) {
        return reply.header("cache-control", "no-store").code(400).send({
          error: "email_notifications_unavailable"
        });
      }
      throw error;
    }
  });

  app.post("/api/push-subscriptions", writeLimit, async (request, reply) => {
    const parsed = pushSubscriptionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    try {
      await savePushSubscription(app.persistence.query, request.userEmail, parsed.data, request.headers["user-agent"]);
    } catch (error) {
      if (isNotificationProcessingLimitError(error)) {
        return reply.header("cache-control", "no-store").code(503).send({
          error: "notification_processing_limit"
        });
      }
      throw error;
    }
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>("/api/push-subscriptions/:id", writeLimit, async (request, reply) => {
    if (!await deletePushSubscription(app.persistence.query, request.userEmail, request.params.id)) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.code(204).send();
  });
}
