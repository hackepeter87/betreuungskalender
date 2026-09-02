import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isValidDateKey } from "../../shared/temporal.js";
import { config } from "../config.js";
import { createReportSnapshot } from "../services/reportSnapshots.js";

const querySchema = z.object({
  startDate: z.string().refine(isValidDateKey),
  endDate: z.string().refine(isValidDateKey),
  includeAuditHistory: z.enum(["true", "false"]).default("false")
}).refine((value) => value.endDate >= value.startDate, { message: "invalid_date_range" });

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
    return createReportSnapshot({
      persistence: app.persistence,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      includeAuditHistory
    });
  });
}
