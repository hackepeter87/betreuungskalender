import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { config } from "../config.js";
import {
  assignedPersistedCarePartyIds,
  getPersistedCareParty,
  markAllDomainClosedMonthsChanged,
  recordDomainAudit,
  recordDomainFieldChanges
} from "../services/domainPersistence.js";
import { makeId, nowIso } from "../services/common.js";
import { carePartyInputSchema } from "../validation/schemas.js";

const readLimit = {
  config: { permission: "planning:view" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { permission: "planning:manage" as const, rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};
const summaryLimit = {
  config: { permission: "appointments:view" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};

async function assignedUsageCount(app: FastifyInstance, id: string): Promise<number> {
  const database = app.persistence.query;
  const [entries, rules, unavailable] = await Promise.all([
    database.selectFrom("care_entries").select(({ fn }) => fn.count<number>("id").as("count"))
      .where("responsible_party_id", "=", id).where("deleted_at", "is", null).executeTakeFirst(),
    database.selectFrom("contact_rules").select(({ fn }) => fn.count<number>("id").as("count"))
      .where("responsible_party_id", "=", id).where("deleted_at", "is", null).executeTakeFirst(),
    database.selectFrom("unavailable_periods").select(({ fn }) => fn.count<number>("id").as("count"))
      .where("responsible_party_id", "=", id).where("deleted_at", "is", null).executeTakeFirst()
  ]);
  return Number(entries?.count ?? 0) + Number(rules?.count ?? 0) + Number(unavailable?.count ?? 0);
}

export async function carePartyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/care-parties/summary", summaryLimit, async (request) => {
    const assigned = request.user?.workspaceRole === "scheduler"
      ? await assignedPersistedCarePartyIds(app.persistence.query, request.user.id)
      : [];
    if (request.user?.workspaceRole === "scheduler" && assigned.length === 0) return [];
    let query = app.persistence.query.selectFrom("care_parties")
      .select(["id", "name"])
      .where("deleted_at", "is", null);
    if (request.user?.workspaceRole === "scheduler") {
      query = query.where("id", "in", assigned);
    }
    return query.orderBy(sql`name COLLATE NOCASE`).execute();
  });

  app.get("/api/care-parties", readLimit, async () => {
    const rows = await app.persistence.query.selectFrom("care_parties")
      .select(["id", "name", "kind", "created_by", "updated_by", "created_at", "updated_at"])
      .where("deleted_at", "is", null)
      .orderBy(sql`name COLLATE NOCASE`)
      .execute();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  });

  app.post("/api/care-parties", writeLimit, async (request, reply) => {
    const parsed = carePartyInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });

    const id = makeId("party");
    const timestamp = nowIso();
    const careParty = await app.persistence.transaction(async (database) => {
      await database.insertInto("care_parties").values({
        id,
        name: parsed.data.name,
        kind: parsed.data.kind,
        created_by: request.userEmail,
        updated_by: request.userEmail,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null
      }).execute();
      await recordDomainAudit(database, {
        userEmail: request.userEmail,
        entityType: "care_party",
        entityId: id,
        action: "created",
        newValue: parsed.data
      });
      return getPersistedCareParty(database, id);
    });

    return reply.code(201).send(careParty);
  });

  app.put<{ Params: { id: string } }>("/api/care-parties/:id", writeLimit, async (request, reply) => {
    const before = await getPersistedCareParty(app.persistence.query, request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const parsed = carePartyInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });

    const timestamp = nowIso();
    const careParty = await app.persistence.transaction(async (database) => {
      await database.updateTable("care_parties").set({
        name: parsed.data.name,
        kind: parsed.data.kind,
        updated_by: request.userEmail,
        updated_at: timestamp
      }).where("id", "=", request.params.id).where("deleted_at", "is", null).execute();
      await recordDomainFieldChanges(
        database,
        request.userEmail,
        "care_party",
        request.params.id,
        before,
        { ...before, ...parsed.data, updatedBy: request.userEmail, updatedAt: timestamp },
        ["updatedAt", "updatedBy"]
      );
      await markAllDomainClosedMonthsChanged(
        database,
        request.userEmail,
        "care_party",
        request.params.id,
        timestamp
      );
      return getPersistedCareParty(database, request.params.id);
    });

    return careParty;
  });

  app.delete<{ Params: { id: string } }>("/api/care-parties/:id", writeLimit, async (request, reply) => {
    const before = await getPersistedCareParty(app.persistence.query, request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const usageCount = await assignedUsageCount(app, request.params.id);
    if (usageCount > 0) {
      return reply.code(409).send({
        error: "care_party_in_use",
        message: "Diese betreuende Person ist noch Terminen oder Umgangsregeln zugeordnet."
      });
    }
    const timestamp = nowIso();

    await app.persistence.transaction(async (database) => {
      await database.updateTable("care_parties")
        .set({ deleted_at: timestamp, updated_by: request.userEmail, updated_at: timestamp })
        .where("id", "=", request.params.id)
        .execute();
      await recordDomainAudit(database, {
        userEmail: request.userEmail,
        entityType: "care_party",
        entityId: request.params.id,
        action: "deleted",
        oldValue: before
      });
      await markAllDomainClosedMonthsChanged(
        database,
        request.userEmail,
        "care_party",
        request.params.id,
        timestamp
      );
    });

    return reply.code(204).send();
  });
}
