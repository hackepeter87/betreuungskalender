import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { buildInstanceReadiness } from "../services/instanceReadiness.js";

const readLimit = {
  config: { permission: "instance:inspect" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};

export async function instanceReadinessRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/instance-readiness", readLimit, async (request, reply) => {
    if (request.user?.role !== "admin") {
      return reply.code(403).send({
        error: "forbidden",
        message: "Für diese Aktion fehlt die erforderliche Berechtigung."
      });
    }
    return buildInstanceReadiness();
  });
}
