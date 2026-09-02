import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import {
  assertPersistedChildren,
  markDomainClosedMonthsChanged,
  recordDomainAudit,
  recordDomainFieldChanges,
  syncPersistedChildJunction
} from "../services/domainPersistence.js";
import type { DatabaseExecutor } from "../db/runtime.js";
import { makeId, nowIso } from "../services/common.js";
import { holidayInputSchema } from "../validation/schemas.js";

const readLimit = {
  config: { permission: "planning:view" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { permission: "planning:manage" as const, rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};

interface HolidayRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  assigned_to: "father" | "mother" | "shared";
  notes: string | null;
  source_external_calendar_source_id: string | null;
  source_external_calendar_event_id: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

async function getChildIds(database: DatabaseExecutor, id: string): Promise<string[]> {
  const rows = await database.selectFrom("holiday_period_children")
    .select("child_id")
    .where("holiday_period_id", "=", id)
    .where("deleted_at", "is", null)
    .orderBy("child_id")
    .execute();
  return rows.map((row) => row.child_id);
}

async function mapHoliday(database: DatabaseExecutor, row: HolidayRow) {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    childIds: await getChildIds(database, row.id),
    assignedTo: row.assigned_to,
    notes: row.notes ?? undefined,
    sourceExternalCalendarSourceId: row.source_external_calendar_source_id ?? undefined,
    sourceExternalCalendarEventId: row.source_external_calendar_event_id ?? undefined,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getHoliday(database: DatabaseExecutor, id: string) {
  const row = await database.selectFrom("holiday_periods")
    .selectAll()
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .executeTakeFirst() as HolidayRow | undefined;
  return row ? mapHoliday(database, row) : undefined;
}

export async function holidayRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/holiday-periods", readLimit, async () => {
    const rows = await app.persistence.query.selectFrom("holiday_periods")
      .selectAll()
      .where("deleted_at", "is", null)
      .orderBy("start_date")
      .orderBy("name")
      .execute() as HolidayRow[];
    return Promise.all(rows.map((row) => mapHoliday(app.persistence.query, row)));
  });

  app.post("/api/holiday-periods", writeLimit, async (request, reply) => {
    const parsed = holidayInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const id = makeId("holiday");
    const timestamp = nowIso();
    try {
      const holiday = await app.persistence.transaction(async (database) => {
        await assertPersistedChildren(database, parsed.data.childIds);
        await database.insertInto("holiday_periods").values({
          id,
          name: parsed.data.name,
          start_date: parsed.data.startDate,
          end_date: parsed.data.endDate,
          assigned_to: parsed.data.assignedTo,
          notes: parsed.data.notes ?? null,
          created_by: request.userEmail,
          updated_by: request.userEmail,
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null,
          source_external_calendar_source_id: null,
          source_external_calendar_event_id: null
        }).execute();
        await syncPersistedChildJunction(database, { table: "holiday_period_children", owner: "holiday_period_id" }, id, parsed.data.childIds, timestamp);
        const created = await getHoliday(database, id);
        await recordDomainAudit(database, {
          userEmail: request.userEmail,
          entityType: "holiday_period",
          entityId: id,
          action: "created",
          newValue: created
        });
        await markDomainClosedMonthsChanged(
          database,
          request.userEmail,
          "holiday_period",
          id,
          parsed.data.startDate,
          parsed.data.endDate,
          timestamp
        );
        return created;
      });
      return reply.code(201).send(holiday);
    } catch (error) {
      return reply.code(400).send({ error: "invalid_relation", message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put<{ Params: { id: string } }>("/api/holiday-periods/:id", writeLimit, async (request, reply) => {
    const before = await getHoliday(app.persistence.query, request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const parsed = holidayInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const timestamp = nowIso();
    try {
      return await app.persistence.transaction(async (database) => {
        await assertPersistedChildren(database, parsed.data.childIds);
        await database.updateTable("holiday_periods").set({
          name: parsed.data.name,
          start_date: parsed.data.startDate,
          end_date: parsed.data.endDate,
          assigned_to: parsed.data.assignedTo,
          notes: parsed.data.notes ?? null,
          updated_by: request.userEmail,
          updated_at: timestamp,
          deleted_at: null
        }).where("id", "=", request.params.id).execute();
        await syncPersistedChildJunction(
          database,
          { table: "holiday_period_children", owner: "holiday_period_id" },
          request.params.id,
          parsed.data.childIds,
          timestamp
        );
        const after = await getHoliday(database, request.params.id);
        if (after) await recordDomainFieldChanges(database, request.userEmail, "holiday_period", request.params.id, before, after, ["updatedAt", "updatedBy"]);
        const dates = [
          before.startDate,
          before.endDate,
          parsed.data.startDate,
          parsed.data.endDate
        ].sort();
        await markDomainClosedMonthsChanged(
          database,
          request.userEmail,
          "holiday_period",
          request.params.id,
          dates[0] ?? parsed.data.startDate,
          dates.at(-1) ?? parsed.data.endDate,
          timestamp
        );
        return after;
      });
    } catch (error) {
      return reply.code(400).send({ error: "invalid_relation", message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/holiday-periods/:id", writeLimit, async (request, reply) => {
    const before = await getHoliday(app.persistence.query, request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const timestamp = nowIso();
    await app.persistence.transaction(async (database) => {
      await database.updateTable("holiday_periods")
        .set({ deleted_at: timestamp, updated_by: request.userEmail, updated_at: timestamp })
        .where("id", "=", request.params.id).execute();
      await database.updateTable("holiday_period_children")
        .set({ deleted_at: timestamp, updated_at: timestamp })
        .where("holiday_period_id", "=", request.params.id)
        .where("deleted_at", "is", null).execute();
      await recordDomainAudit(database, {
        userEmail: request.userEmail,
        entityType: "holiday_period",
        entityId: request.params.id,
        action: "deleted",
        oldValue: before
      });
      await markDomainClosedMonthsChanged(
        database,
        request.userEmail,
        "holiday_period",
        request.params.id,
        before.startDate,
        before.endDate,
        timestamp
      );
    });
    return reply.code(204).send();
  });
}
