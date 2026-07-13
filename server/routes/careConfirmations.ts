import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import {
  answerCareConfirmation,
  deletePushSubscription,
  getNotificationPreferences,
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
  config: { rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};

export async function careConfirmationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/care-confirmations/open", readLimit, async (request) =>
    listOpenCareConfirmations(request.userEmail)
  );

  app.post<{ Params: { id: string } }>("/api/care-confirmations/:id/answer", writeLimit, async (request, reply) => {
    const parsed = careConfirmationAnswerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    if (!request.user) return reply.code(401).send({ error: "authentication_required" });
    let result: ReturnType<typeof answerCareConfirmation>;
    try {
      result = answerCareConfirmation(request.params.id, request.user, parsed.data);
    } catch (error) {
      if (isCareEntryConflictError(error)) {
        return reply.code(409).send({ error: "care_entry_conflict" });
      }
      return reply.code(400).send({
        error: "invalid_relation",
        message: error instanceof Error ? error.message : String(error)
      });
    }
    return result ?? reply.code(404).send({ error: "not_found" });
  });

  app.post<{ Params: { id: string } }>("/api/care-confirmations/:id/remind-later", writeLimit, async (request, reply) => {
    const parsed = careConfirmationRemindLaterSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const result = remindCareConfirmationLater(request.params.id, request.userEmail, parsed.data.nextReminderAt);
    return result ?? reply.code(404).send({ error: "not_found" });
  });

  app.get("/api/notification-preferences", readLimit, async (request) =>
    getNotificationPreferences(request.userEmail)
  );

  app.put("/api/notification-preferences", writeLimit, async (request, reply) => {
    const parsed = notificationPreferencesSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    return updateNotificationPreferences(request.userEmail, parsed.data.preferences);
  });

  app.post("/api/push-subscriptions", writeLimit, async (request, reply) => {
    const parsed = pushSubscriptionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    savePushSubscription(request.userEmail, parsed.data, request.headers["user-agent"]);
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>("/api/push-subscriptions/:id", writeLimit, async (request, reply) => {
    if (!deletePushSubscription(request.userEmail, request.params.id)) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.code(204).send();
  });
}
