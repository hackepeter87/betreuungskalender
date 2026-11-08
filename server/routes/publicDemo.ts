import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { omitUndefinedValues } from "../../shared/objects.js";
import {
  PublicDemoProjectionError,
  publicDemoProjection
} from "../services/publicDemoProjection.js";

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});

const publicDemoQuery = z.object({
  startDate: calendarDate.optional(),
  endDate: calendarDate.optional()
}).strict().superRefine((value, context) => {
  if (!value.startDate || !value.endDate) return;
  const start = Date.parse(`${value.startDate}T00:00:00.000Z`);
  const end = Date.parse(`${value.endDate}T00:00:00.000Z`);
  if (end < start || (end - start) / 86_400_000 > 366) {
    context.addIssue({ code: "custom", message: "invalid_range" });
  }
});

export interface PublicDemoRoutesOptions {
  enabled: boolean;
}

export const publicDemoRoutes: FastifyPluginAsync<PublicDemoRoutesOptions> = async (
  app,
  options
) => {
  app.get<{ Querystring: { startDate?: string; endDate?: string } }>(
    "/api/demo/public",
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (!options.enabled) {
        return reply.code(404).send({ error: "not_found" });
      }
      const parsed = publicDemoQuery.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      try {
        return await app.persistence.transaction((database) =>
          publicDemoProjection(
            database,
            omitUndefinedValues(parsed.data)
          )
        );
      } catch (error) {
        if (error instanceof PublicDemoProjectionError) {
          return reply.code(503).send({ error: "demo_unavailable" });
        }
        throw error;
      }
    }
  );
};
