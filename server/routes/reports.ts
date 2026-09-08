import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isInclusiveDateRangeWithinDays, MAX_DOMAIN_RANGE_DAYS } from "../../shared/temporal.js";
import { config } from "../config.js";
import { DomainExportLimitError } from "../services/dataTransfer.js";
import { createReportSnapshot } from "../services/reportSnapshots.js";

const querySchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  includeAuditHistory: z.enum(["true", "false"]).default("false")
}).refine(
  (value) => isInclusiveDateRangeWithinDays(value.startDate, value.endDate, MAX_DOMAIN_RANGE_DAYS),
  { message: "invalid_date_range" }
);

const readLimit = {
  config: { permission: "reports:view" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/reports/snapshot", readLimit, async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error" });
    const includeAuditHistory = parsed.data.includeAuditHistory === "true";
    if (includeAuditHistory && !request.user?.workspacePermissions?.includes("audit:view")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    reply.header("Cache-Control", "no-store");
    try {
      return await createReportSnapshot({
        persistence: app.persistence,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        includeAuditHistory
      });
    } catch (error) {
      if (error instanceof DomainExportLimitError) {
        return reply.code(400).send({ error: "report_limit" });
      }
      throw error;
    }
  });
}
