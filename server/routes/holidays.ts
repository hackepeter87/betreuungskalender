import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db/connection.js";
import {
  markClosedMonthsChanged,
  recordAudit,
  recordFieldChanges
} from "../services/audit.js";
import { assertActiveChildren, makeId, nowIso, syncJunction } from "../services/common.js";
import { holidayInputSchema } from "../validation/schemas.js";

const readLimit = {
  config: { rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};

interface HolidayRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  assigned_to: "father" | "mother" | "shared";
  notes: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

function getChildIds(id: string): string[] {
  return (db.prepare(`
    SELECT child_id AS childId
    FROM holiday_period_children
    WHERE holiday_period_id = ? AND deleted_at IS NULL
    ORDER BY child_id
  `).all(id) as Array<{ childId: string }>).map((row) => row.childId);
}

function mapHoliday(row: HolidayRow) {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    childIds: getChildIds(row.id),
    assignedTo: row.assigned_to,
    notes: row.notes ?? undefined,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getHoliday(id: string) {
  const row = db.prepare(`
    SELECT * FROM holiday_periods WHERE id = ? AND deleted_at IS NULL
  `).get(id) as HolidayRow | undefined;
  return row ? mapHoliday(row) : undefined;
}

export async function holidayRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/holiday-periods", readLimit, async () => {
    const rows = db.prepare(`
      SELECT * FROM holiday_periods
      WHERE deleted_at IS NULL
      ORDER BY start_date, name
    `).all() as HolidayRow[];
    return rows.map(mapHoliday);
  });

  app.post("/api/holiday-periods", writeLimit, async (request, reply) => {
    const parsed = holidayInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const id = makeId("holiday");
    const timestamp = nowIso();
    try {
      db.transaction(() => {
        assertActiveChildren(parsed.data.childIds);
        db.prepare(`
          INSERT INTO holiday_periods (
            id, name, start_date, end_date, assigned_to, notes,
            created_by, updated_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, parsed.data.name, parsed.data.startDate, parsed.data.endDate,
          parsed.data.assignedTo, parsed.data.notes ?? null,
          request.userEmail, request.userEmail, timestamp, timestamp
        );
        syncJunction("holiday_period_children", "holiday_period_id", id, parsed.data.childIds, timestamp);
        recordAudit({
          userEmail: request.userEmail,
          entityType: "holiday_period",
          entityId: id,
          action: "created",
          newValue: getHoliday(id)
        });
        markClosedMonthsChanged(
          request.userEmail,
          "holiday_period",
          id,
          parsed.data.startDate,
          parsed.data.endDate,
          timestamp
        );
      })();
    } catch (error) {
      return reply.code(400).send({ error: "invalid_relation", message: error instanceof Error ? error.message : String(error) });
    }
    return reply.code(201).send(getHoliday(id));
  });

  app.put<{ Params: { id: string } }>("/api/holiday-periods/:id", writeLimit, async (request, reply) => {
    const before = getHoliday(request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const parsed = holidayInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const timestamp = nowIso();
    try {
      db.transaction(() => {
        assertActiveChildren(parsed.data.childIds);
        db.prepare(`
          UPDATE holiday_periods
          SET name = ?, start_date = ?, end_date = ?, assigned_to = ?,
              notes = ?, updated_by = ?, updated_at = ?, deleted_at = NULL
          WHERE id = ?
        `).run(
          parsed.data.name, parsed.data.startDate, parsed.data.endDate,
          parsed.data.assignedTo, parsed.data.notes ?? null,
          request.userEmail, timestamp, request.params.id
        );
        syncJunction(
          "holiday_period_children",
          "holiday_period_id",
          request.params.id,
          parsed.data.childIds,
          timestamp
        );
        const after = getHoliday(request.params.id);
        if (after) recordFieldChanges(request.userEmail, "holiday_period", request.params.id, before, after, ["updatedAt", "updatedBy"]);
        const dates = [
          before.startDate,
          before.endDate,
          parsed.data.startDate,
          parsed.data.endDate
        ].sort();
        markClosedMonthsChanged(
          request.userEmail,
          "holiday_period",
          request.params.id,
          dates[0] ?? parsed.data.startDate,
          dates.at(-1) ?? parsed.data.endDate,
          timestamp
        );
      })();
    } catch (error) {
      return reply.code(400).send({ error: "invalid_relation", message: error instanceof Error ? error.message : String(error) });
    }
    return getHoliday(request.params.id);
  });

  app.delete<{ Params: { id: string } }>("/api/holiday-periods/:id", writeLimit, async (request, reply) => {
    const before = getHoliday(request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const timestamp = nowIso();
    db.transaction(() => {
      db.prepare("UPDATE holiday_periods SET deleted_at = ?, updated_by = ?, updated_at = ? WHERE id = ?")
        .run(timestamp, request.userEmail, timestamp, request.params.id);
      db.prepare("UPDATE holiday_period_children SET deleted_at = ?, updated_at = ? WHERE holiday_period_id = ? AND deleted_at IS NULL")
        .run(timestamp, timestamp, request.params.id);
      recordAudit({
        userEmail: request.userEmail,
        entityType: "holiday_period",
        entityId: request.params.id,
        action: "deleted",
        oldValue: before
      });
      markClosedMonthsChanged(
        request.userEmail,
        "holiday_period",
        request.params.id,
        before.startDate,
        before.endDate,
        timestamp
      );
    })();
    return reply.code(204).send();
  });
}
