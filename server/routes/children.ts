import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { config } from "../config.js";
import {
  markAllDomainClosedMonthsChanged,
  recordDomainAudit,
  recordDomainFieldChanges,
  softDeletePersistedChildRelations
} from "../services/domainPersistence.js";
import type { DatabaseExecutor } from "../db/runtime.js";
import { makeId, nowIso } from "../services/common.js";
import { childInputSchema } from "../validation/schemas.js";

const readLimit = {
  config: { permission: "children:view-sensitive" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { permission: "children:manage" as const, rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};
const summaryLimit = {
  config: { permission: "children:view-basic" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};

interface ChildRow {
  id: string;
  name: string;
  birth_month: number;
  birth_year: number;
  color: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

function mapChild(row: ChildRow) {
  return {
    id: row.id,
    name: row.name,
    birthMonth: row.birth_month,
    birthYear: row.birth_year,
    color: row.color,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getChild(database: DatabaseExecutor, id: string) {
  const row = await database.selectFrom("children")
    .select(["id", "name", "birth_month", "birth_year", "color", "created_by", "updated_by", "created_at", "updated_at"])
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .executeTakeFirst() as ChildRow | undefined;
  return row ? mapChild(row) : undefined;
}

export async function childrenRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/children/summary", summaryLimit, async () =>
    app.persistence.query.selectFrom("children")
      .select(["id", "name", "color"])
      .where("deleted_at", "is", null)
      .orderBy(sql`name COLLATE NOCASE`)
      .execute()
  );

  app.get("/api/children", readLimit, async () => {
    const rows = await app.persistence.query.selectFrom("children")
      .select(["id", "name", "birth_month", "birth_year", "color", "created_by", "updated_by", "created_at", "updated_at"])
      .where("deleted_at", "is", null)
      .orderBy(sql`name COLLATE NOCASE`)
      .execute() as ChildRow[];
    return rows.map(mapChild);
  });

  app.post("/api/children", writeLimit, async (request, reply) => {
    const parsed = childInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });

    const id = makeId("child");
    const timestamp = nowIso();
    const child = await app.persistence.transaction(async (database) => {
      await database.insertInto("children").values({
        id,
        name: parsed.data.name,
        birth_month: parsed.data.birthMonth,
        birth_year: parsed.data.birthYear,
        color: parsed.data.color,
        created_by: request.userEmail,
        updated_by: request.userEmail,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null
      }).execute();
      await recordDomainAudit(database, {
        userEmail: request.userEmail,
        entityType: "child",
        entityId: id,
        action: "created",
        newValue: parsed.data
      });
      return getChild(database, id);
    });

    return reply.code(201).send(child);
  });

  app.put<{ Params: { id: string } }>("/api/children/:id", writeLimit, async (request, reply) => {
    const before = await getChild(app.persistence.query, request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const parsed = childInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });

    const timestamp = nowIso();
    const child = await app.persistence.transaction(async (database) => {
      await database.updateTable("children").set({
        name: parsed.data.name,
        birth_month: parsed.data.birthMonth,
        birth_year: parsed.data.birthYear,
        color: parsed.data.color,
        updated_by: request.userEmail,
        updated_at: timestamp
      }).where("id", "=", request.params.id).where("deleted_at", "is", null).execute();
      await recordDomainFieldChanges(
        database,
        request.userEmail,
        "child",
        request.params.id,
        before,
        { ...before, ...parsed.data, updatedBy: request.userEmail, updatedAt: timestamp },
        ["updatedAt", "updatedBy"]
      );
      await markAllDomainClosedMonthsChanged(
        database,
        request.userEmail,
        "child",
        request.params.id,
        timestamp
      );
      return getChild(database, request.params.id);
    });

    return child;
  });

  app.delete<{ Params: { id: string } }>("/api/children/:id", writeLimit, async (request, reply) => {
    const before = await getChild(app.persistence.query, request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const timestamp = nowIso();

    await app.persistence.transaction(async (database) => {
      await database.updateTable("children")
        .set({ deleted_at: timestamp, updated_by: request.userEmail, updated_at: timestamp })
        .where("id", "=", request.params.id)
        .execute();
      await softDeletePersistedChildRelations(database, request.params.id, timestamp);
      await recordDomainAudit(database, {
        userEmail: request.userEmail,
        entityType: "child",
        entityId: request.params.id,
        action: "deleted",
        oldValue: before
      });
      await markAllDomainClosedMonthsChanged(
        database,
        request.userEmail,
        "child",
        request.params.id,
        timestamp
      );
    });

    return reply.code(204).send();
  });
}
