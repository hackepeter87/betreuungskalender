import type { FastifyInstance } from "fastify";
import type { ApiUnavailablePeriod } from "../../shared/api.js";
import { config } from "../config.js";
import {
  assertCanUsePersistedCareParty,
  assertPersistedCareParty,
  assertPersistedChildren,
  markDomainClosedMonthsChanged,
  recordDomainAudit,
  recordDomainFieldChanges,
  syncPersistedChildJunction
} from "../services/domainPersistence.js";
import type { DatabaseExecutor } from "../db/runtime.js";
import { bool, makeId, nowIso } from "../services/common.js";
import {
  unavailablePeriodInputSchema,
  unavailablePeriodWarnings
} from "../validation/schemas.js";

const readLimit = {
  config: { permission: "planning:view" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { permission: "planning:manage" as const, rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};

interface UnavailableRow {
  id: string;
  start_datetime: string;
  end_datetime: string;
  scope: ApiUnavailablePeriod["scope"];
  responsible_party_id: string | null;
  category: ApiUnavailablePeriod["category"];
  duty_related: number;
  affects_contact: number;
  affects_holidays: number;
  location: string | null;
  notes: string | null;
  has_evidence: number;
  evidence_reference: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

async function childIdsForPeriod(database: DatabaseExecutor, id: string): Promise<string[]> {
  const rows = await database.selectFrom("unavailable_period_children")
    .select("child_id")
    .where("unavailable_period_id", "=", id)
    .where("deleted_at", "is", null)
    .orderBy("child_id")
    .execute();
  return rows.map((row) => row.child_id);
}

async function mapPeriod(database: DatabaseExecutor, row: UnavailableRow): Promise<ApiUnavailablePeriod> {
  const period = {
    id: row.id,
    startDateTime: row.start_datetime,
    endDateTime: row.end_datetime,
    scope: row.scope,
    responsiblePartyId: row.responsible_party_id ?? undefined,
    childIds: await childIdsForPeriod(database, row.id),
    category: row.category,
    dutyRelated: bool(row.duty_related),
    affectsContact: bool(row.affects_contact),
    affectsHolidays: bool(row.affects_holidays),
    location: row.location ?? undefined,
    notes: row.notes ?? undefined,
    hasEvidence: bool(row.has_evidence),
    evidenceReference: row.evidence_reference ?? undefined,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  return {
    ...period,
    warnings: unavailablePeriodWarnings(period)
  };
}

async function validateRelations(database: DatabaseExecutor, input: {
  childIds: string[];
  responsiblePartyId?: string;
}): Promise<void> {
  if (input.childIds.length) await assertPersistedChildren(database, input.childIds);
  await assertPersistedCareParty(database, input.responsiblePartyId);
}

async function assertOptionalCarePartyAccess(
  database: DatabaseExecutor,
  user: Parameters<typeof assertCanUsePersistedCareParty>[1],
  responsiblePartyId?: string
): Promise<void> {
  if (responsiblePartyId) await assertCanUsePersistedCareParty(database, user, responsiblePartyId);
}

async function getPeriod(database: DatabaseExecutor, id: string): Promise<ApiUnavailablePeriod | undefined> {
  const row = await database.selectFrom("unavailable_periods")
    .selectAll()
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .executeTakeFirst() as UnavailableRow | undefined;
  return row ? mapPeriod(database, row) : undefined;
}

export async function unavailablePeriodRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { startDate?: string; endDate?: string } }>(
    "/api/unavailable-periods",
    readLimit,
    async (request) => {
      let query = app.persistence.query.selectFrom("unavailable_periods")
        .selectAll()
        .where("deleted_at", "is", null);
      if (request.query.startDate) {
        query = query.where("end_datetime", ">=", `${request.query.startDate}T00:00:00`);
      }
      if (request.query.endDate) {
        query = query.where("start_datetime", "<=", `${request.query.endDate}T23:59:59`);
      }
      const rows = await query.orderBy("start_datetime").orderBy("id").execute() as UnavailableRow[];
      return Promise.all(rows.map((row) => mapPeriod(app.persistence.query, row)));
    }
  );

  app.post("/api/unavailable-periods", writeLimit, async (request, reply) => {
    const parsed = unavailablePeriodInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        issues: parsed.error.issues
      });
    }
    const id = makeId("unavailable");
    const timestamp = nowIso();
    try {
      const period = await app.persistence.transaction(async (database) => {
        await validateRelations(database, parsed.data);
        await assertOptionalCarePartyAccess(database, request.user, parsed.data.responsiblePartyId);
        await database.insertInto("unavailable_periods").values({
          id,
          start_datetime: parsed.data.startDateTime,
          end_datetime: parsed.data.endDateTime,
          scope: parsed.data.scope,
          responsible_party_id: parsed.data.responsiblePartyId ?? null,
          category: parsed.data.category,
          duty_related: Number(parsed.data.dutyRelated),
          affects_contact: Number(parsed.data.affectsContact),
          affects_holidays: Number(parsed.data.affectsHolidays),
          location: parsed.data.location ?? null,
          notes: parsed.data.notes ?? null,
          has_evidence: Number(parsed.data.hasEvidence),
          evidence_reference: parsed.data.evidenceReference ?? null,
          created_by: request.userEmail,
          updated_by: request.userEmail,
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null
        }).execute();
        await syncPersistedChildJunction(database, { table: "unavailable_period_children", owner: "unavailable_period_id" }, id, parsed.data.childIds, timestamp);
        const created = await getPeriod(database, id);
        await recordDomainAudit(database, {
          userEmail: request.userEmail,
          entityType: "unavailable_period",
          entityId: id,
          action: "created",
          newValue: created
        });
        await markDomainClosedMonthsChanged(database, request.userEmail, "unavailable_period", id, parsed.data.startDateTime.slice(0, 10), parsed.data.endDateTime.slice(0, 10), timestamp);
        return created;
      });
      return reply.code(201).send(period);
    } catch (error) {
      return reply.code(400).send({
        error: "validation_error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.put<{ Params: { id: string } }>(
    "/api/unavailable-periods/:id",
    writeLimit,
    async (request, reply) => {
      const before = await getPeriod(app.persistence.query, request.params.id);
      if (!before) return reply.code(404).send({ error: "not_found" });
      const parsed = unavailablePeriodInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "validation_error",
          issues: parsed.error.issues
        });
      }
      try {
        const timestamp = nowIso();
        return await app.persistence.transaction(async (database) => {
        await validateRelations(database, parsed.data);
        await assertOptionalCarePartyAccess(database, request.user, before.responsiblePartyId);
        await assertOptionalCarePartyAccess(database, request.user, parsed.data.responsiblePartyId);
        await database.updateTable("unavailable_periods").set({
          start_datetime: parsed.data.startDateTime,
          end_datetime: parsed.data.endDateTime,
          scope: parsed.data.scope,
          responsible_party_id: parsed.data.responsiblePartyId ?? null,
          category: parsed.data.category,
          duty_related: Number(parsed.data.dutyRelated),
          affects_contact: Number(parsed.data.affectsContact),
          affects_holidays: Number(parsed.data.affectsHolidays),
          location: parsed.data.location ?? null,
          notes: parsed.data.notes ?? null,
          has_evidence: Number(parsed.data.hasEvidence),
          evidence_reference: parsed.data.evidenceReference ?? null,
          updated_by: request.userEmail,
          updated_at: timestamp,
          deleted_at: null
        }).where("id", "=", request.params.id).execute();
        await syncPersistedChildJunction(database, { table: "unavailable_period_children", owner: "unavailable_period_id" }, request.params.id, parsed.data.childIds, timestamp);
        const after = await getPeriod(database, request.params.id);
        if (after) {
          await recordDomainFieldChanges(
            database,
            request.userEmail,
            "unavailable_period",
            request.params.id,
            before,
            after,
            ["updatedAt", "updatedBy", "warnings"]
          );
        }
        const dates = [
          before.startDateTime.slice(0, 10),
          before.endDateTime.slice(0, 10),
          parsed.data.startDateTime.slice(0, 10),
          parsed.data.endDateTime.slice(0, 10)
        ].sort();
        await markDomainClosedMonthsChanged(
          database,
          request.userEmail,
          "unavailable_period",
          request.params.id,
          dates[0] ?? parsed.data.startDateTime.slice(0, 10),
          dates.at(-1) ?? parsed.data.endDateTime.slice(0, 10),
          timestamp
        );
        return after;
      });
      } catch (error) {
        return reply.code(400).send({
          error: "validation_error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/unavailable-periods/:id",
    writeLimit,
    async (request, reply) => {
      const before = await getPeriod(app.persistence.query, request.params.id);
      if (!before) return reply.code(404).send({ error: "not_found" });
      try {
        await assertOptionalCarePartyAccess(app.persistence.query, request.user, before.responsiblePartyId);
      } catch (error) {
        return reply.code(400).send({
          error: "validation_error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
      const timestamp = nowIso();
      await app.persistence.transaction(async (database) => {
        await database.updateTable("unavailable_periods")
          .set({ deleted_at: timestamp, updated_at: timestamp, updated_by: request.userEmail })
          .where("id", "=", request.params.id).execute();
        await database.updateTable("unavailable_period_children")
          .set({ deleted_at: timestamp, updated_at: timestamp })
          .where("unavailable_period_id", "=", request.params.id)
          .where("deleted_at", "is", null).execute();
        await recordDomainAudit(database, {
          userEmail: request.userEmail,
          entityType: "unavailable_period",
          entityId: request.params.id,
          action: "deleted",
          oldValue: before
        });
        await markDomainClosedMonthsChanged(
          database,
          request.userEmail,
          "unavailable_period",
          request.params.id,
          before.startDateTime.slice(0, 10),
          before.endDateTime.slice(0, 10),
          timestamp
        );
      });
      return reply.code(204).send();
    }
  );
}
