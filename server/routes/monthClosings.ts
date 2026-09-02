import type { FastifyInstance } from "fastify";
import type { ApiMonthlyClosing } from "../../shared/api.js";
import { config } from "../config.js";
import { makeId, nowIso } from "../services/common.js";
import { recordDomainAudit } from "../services/domainPersistence.js";
import { monthlyClosingInputSchema } from "../validation/schemas.js";

const readLimit = {
  config: { permission: "reports:view" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { permission: "reports:view" as const, rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};

interface ClosingRow {
  month_key: string;
  summary_json: string;
  closed_by: string;
  updated_by: string;
  changed_after_close_at: string | null;
  created_at: string;
}

function mapClosing(row: ClosingRow): ApiMonthlyClosing {
  const stored = JSON.parse(row.summary_json) as {
    dataUpdatedAt?: string;
    summary?: unknown;
  };
  return {
    monthKey: row.month_key,
    closedAt: row.created_at,
    closedBy: row.closed_by,
    dataUpdatedAt: stored.dataUpdatedAt ?? row.created_at,
    summary: stored.summary ?? stored,
    changedAfterCloseAt: row.changed_after_close_at ?? undefined,
    updatedBy: row.updated_by
  };
}

async function getClosing(
  app: FastifyInstance,
  monthKey: string
): Promise<ApiMonthlyClosing | undefined> {
  const row = await app.persistence.query.selectFrom("monthly_closings")
    .select(["month_key", "summary_json", "closed_by", "updated_by", "changed_after_close_at", "created_at"])
    .where("month_key", "=", monthKey)
    .where("deleted_at", "is", null)
    .executeTakeFirst() as ClosingRow | undefined;
  return row ? mapClosing(row) : undefined;
}

export async function monthClosingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/month-closings", readLimit, async () => {
    const rows = await app.persistence.query.selectFrom("monthly_closings")
      .select(["month_key", "summary_json", "closed_by", "updated_by", "changed_after_close_at", "created_at"])
      .where("deleted_at", "is", null)
      .orderBy("month_key")
      .execute() as ClosingRow[];
    return rows.map(mapClosing);
  });

  app.post("/api/month-closings", writeLimit, async (request, reply) => {
    const parsed = monthlyClosingInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        issues: parsed.error.issues
      });
    }
    const existing = await getClosing(app, parsed.data.monthKey);
    if (existing) return existing;

    const timestamp = nowIso();
    const id = makeId("closing");
    const created = await app.persistence.transaction(async (database) => {
      await database.insertInto("monthly_closings").values({
        id,
        month_key: parsed.data.monthKey,
        summary_json: JSON.stringify({
          dataUpdatedAt: parsed.data.dataUpdatedAt,
          summary: parsed.data.summary
        }),
        closed_by: request.userEmail,
        updated_by: request.userEmail,
        changed_after_close_at: null,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null
      }).execute();
      const closing = await database.selectFrom("monthly_closings")
        .select(["month_key", "summary_json", "closed_by", "updated_by", "changed_after_close_at", "created_at"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow() as ClosingRow;
      const mapped = mapClosing(closing);
      await recordDomainAudit(database, {
        userEmail: request.userEmail,
        entityType: "month_closure",
        entityId: id,
        action: "created",
        newValue: mapped
      });
      return mapped;
    });
    return reply.code(201).send(created);
  });
}
