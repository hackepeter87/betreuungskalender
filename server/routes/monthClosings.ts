import type { FastifyInstance } from "fastify";
import type { ApiMonthlyClosing } from "../../shared/api.js";
import { config } from "../config.js";
import { db } from "../db/connection.js";
import { recordAudit } from "../services/audit.js";
import { makeId, nowIso } from "../services/common.js";
import { monthlyClosingInputSchema } from "../validation/schemas.js";

const readLimit = {
  config: { rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
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

function getClosing(monthKey: string): ApiMonthlyClosing | undefined {
  const row = db.prepare(`
    SELECT month_key, summary_json, closed_by, updated_by, changed_after_close_at, created_at
    FROM monthly_closings
    WHERE month_key = ? AND deleted_at IS NULL
  `).get(monthKey) as ClosingRow | undefined;
  return row ? mapClosing(row) : undefined;
}

export async function monthClosingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/month-closings", readLimit, async () => {
    const rows = db.prepare(`
      SELECT month_key, summary_json, closed_by, updated_by, changed_after_close_at, created_at
      FROM monthly_closings
      WHERE deleted_at IS NULL
      ORDER BY month_key
    `).all() as ClosingRow[];
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
    const existing = getClosing(parsed.data.monthKey);
    if (existing) return existing;

    const timestamp = nowIso();
    const id = makeId("closing");
    db.transaction(() => {
      db.prepare(`
        INSERT INTO monthly_closings (
          id, month_key, summary_json, closed_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        parsed.data.monthKey,
        JSON.stringify({
          dataUpdatedAt: parsed.data.dataUpdatedAt,
          summary: parsed.data.summary
        }),
        request.userEmail,
        request.userEmail,
        timestamp,
        timestamp
      );
      recordAudit({
        userEmail: request.userEmail,
        entityType: "month_closure",
        entityId: id,
        action: "created",
        newValue: getClosing(parsed.data.monthKey)
      });
    })();
    return reply.code(201).send(getClosing(parsed.data.monthKey));
  });
}
