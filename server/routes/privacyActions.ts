import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { preventSensitiveResponseCaching as noStore } from "../httpProtection.js";
import {
  executePrivacyAction,
  getPrivacyActionResult,
  parsePrivacyActionExecuteRequest,
  parsePrivacyActionPreviewRequest,
  previewPrivacyAction,
  PrivacyActionError
} from "../services/privacyActions.js";

const sensitive = {
  bodyLimit: 64 * 1024,
  config: {
    permission: "admin:destructive" as const,
    rateLimit: { max: config.rateLimitSensitiveMax, timeWindow: config.rateLimitWindowMs }
  }
};

export async function privacyActionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/privacy-actions/preview", sensitive, async (request, reply) => {
    try {
      const input = parsePrivacyActionPreviewRequest(request.body);
      const actorId = request.user?.id ?? request.userEmail;
      return noStore(reply).send(await previewPrivacyAction(input, actorId, app.persistence.query));
    } catch (error) {
      const statusCode = error instanceof PrivacyActionError ? error.statusCode : 500;
      const code = error instanceof PrivacyActionError ? error.code : "privacy_action_failed";
      if (!(error instanceof PrivacyActionError)) {
        request.log.error({ errorCode: code }, "Privacy action preview failed");
      }
      return noStore(reply).code(statusCode).send({
        error: code,
        message: "The privacy action preview could not be completed."
      });
    }
  });

  app.post("/api/privacy-actions/execute", sensitive, async (request, reply) => {
    try {
      const input = parsePrivacyActionExecuteRequest(request.body);
      const actorId = request.user?.id ?? request.userEmail;
      return noStore(reply).send(await executePrivacyAction(input, actorId, app.persistence));
    } catch (error) {
      const statusCode = error instanceof PrivacyActionError ? error.statusCode : 500;
      const code = error instanceof PrivacyActionError ? error.code : "privacy_action_failed";
      if (!(error instanceof PrivacyActionError)) {
        request.log.error({ errorCode: code }, "Privacy action execution failed");
      }
      return noStore(reply).code(statusCode).send({
        error: code,
        message: "The privacy action could not be completed."
      });
    }
  });

  app.get<{ Params: { id: string } }>("/api/privacy-actions/:id/result", sensitive, async (request, reply) => {
    try {
      return noStore(reply).send(await getPrivacyActionResult(request.params.id, app.persistence.query));
    } catch (error) {
      const statusCode = error instanceof PrivacyActionError ? error.statusCode : 500;
      const code = error instanceof PrivacyActionError ? error.code : "privacy_action_failed";
      if (!(error instanceof PrivacyActionError)) {
        request.log.error({ errorCode: code }, "Privacy action result lookup failed");
      }
      return noStore(reply).code(statusCode).send({
        error: code,
        message: "The privacy action result could not be loaded."
      });
    }
  });
}
