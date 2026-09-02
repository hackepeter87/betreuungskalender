import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import type { DatabaseExecutor } from "../db/runtime.js";
import {
  assertPersistedChildren,
  getPersistedDefaultResponsiblePartyId,
  recordDomainAudit,
  recordDomainFieldChanges,
  syncPersistedChildJunction
} from "../services/domainPersistence.js";
import { bool, makeId, nowIso } from "../services/common.js";
import {
  syncContactRule,
  upsertContactRuleFromPattern,
  type ContactRulePatternInput
} from "../services/contactRules.js";
import { contactPatternInputSchema } from "../validation/schemas.js";

const readLimit = {
  config: { permission: "planning:view" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { permission: "planning:manage" as const, rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};

interface PatternRow {
  id: string;
  name: string;
  start_date: string;
  frequency: "biweekly";
  friday_start_time: string;
  sunday_end_time: string;
  active: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

async function getChildIds(database: DatabaseExecutor, id: string): Promise<string[]> {
  const rows = await database.selectFrom("contact_pattern_children")
    .select("child_id")
    .where("contact_pattern_id", "=", id)
    .where("deleted_at", "is", null)
    .orderBy("child_id")
    .execute();
  return rows.map((row) => row.child_id);
}

async function mapPattern(database: DatabaseExecutor, row: PatternRow) {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    frequency: row.frequency,
    fridayStartTime: row.friday_start_time,
    sundayEndTime: row.sunday_end_time,
    childIds: await getChildIds(database, row.id),
    active: bool(row.active),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

type MappedPattern = Awaited<ReturnType<typeof mapPattern>>;

function patternInputFromRow(
  pattern: MappedPattern,
  responsiblePartyId: string | undefined
): ContactRulePatternInput {
  return {
    id: pattern.id,
    name: pattern.name,
    startDate: pattern.startDate,
    fridayStartTime: pattern.fridayStartTime,
    sundayEndTime: pattern.sundayEndTime,
    childIds: pattern.childIds,
    responsiblePartyId,
    active: pattern.active,
    createdBy: pattern.createdBy,
    updatedBy: pattern.updatedBy,
    createdAt: pattern.createdAt,
    updatedAt: pattern.updatedAt
  };
}

async function getPattern(database: DatabaseExecutor, id: string): Promise<MappedPattern | undefined> {
  const row = await database.selectFrom("contact_patterns")
    .selectAll()
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .executeTakeFirst() as PatternRow | undefined;
  return row ? mapPattern(database, row) : undefined;
}

export async function contactPatternRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/contact-patterns", readLimit, async () => {
    const rows = await app.persistence.query.selectFrom("contact_patterns")
      .selectAll()
      .where("deleted_at", "is", null)
      .orderBy("start_date")
      .orderBy("name")
      .execute() as PatternRow[];
    return Promise.all(rows.map((row) => mapPattern(app.persistence.query, row)));
  });

  app.post("/api/contact-patterns", writeLimit, async (request, reply) => {
    const parsed = contactPatternInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const id = makeId("pattern");
    const timestamp = nowIso();
    try {
      const result = await app.persistence.transaction(async (database) => {
        await assertPersistedChildren(database, parsed.data.childIds);
        await database.insertInto("contact_patterns").values({
          id,
          name: parsed.data.name,
          start_date: parsed.data.startDate,
          frequency: parsed.data.frequency,
          friday_start_time: parsed.data.fridayStartTime,
          sunday_end_time: parsed.data.sundayEndTime,
          active: Number(parsed.data.active),
          created_by: request.userEmail,
          updated_by: request.userEmail,
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null
        }).execute();
        await syncPersistedChildJunction(
          database,
          { table: "contact_pattern_children", owner: "contact_pattern_id" },
          id,
          parsed.data.childIds,
          timestamp
        );
        const saved = await getPattern(database, id);
        if (!saved) throw new Error("Umgangsregel konnte nicht geladen werden.");
        await recordDomainAudit(database, {
          userEmail: request.userEmail,
          entityType: "contact_pattern",
          entityId: id,
          action: "created",
          newValue: saved
        });
        await upsertContactRuleFromPattern(
          patternInputFromRow(saved, await getPersistedDefaultResponsiblePartyId(database)),
          database
        );
        const syncSummary = await syncContactRule(saved.id, {
          userEmail: request.userEmail,
          database,
          recordAudit: true
        });
        return { ...await getPattern(database, id), syncSummary };
      });
      return reply.code(201).send(result);
    } catch (error) {
      return reply.code(400).send({ error: "invalid_relation", message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put<{ Params: { id: string } }>("/api/contact-patterns/:id", writeLimit, async (request, reply) => {
    const before = await getPattern(app.persistence.query, request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const parsed = contactPatternInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const timestamp = nowIso();
    try {
      return await app.persistence.transaction(async (database) => {
        await assertPersistedChildren(database, parsed.data.childIds);
        await database.updateTable("contact_patterns").set({
          name: parsed.data.name,
          start_date: parsed.data.startDate,
          frequency: parsed.data.frequency,
          friday_start_time: parsed.data.fridayStartTime,
          sunday_end_time: parsed.data.sundayEndTime,
          active: Number(parsed.data.active),
          updated_by: request.userEmail,
          updated_at: timestamp,
          deleted_at: null
        }).where("id", "=", request.params.id).execute();
        await syncPersistedChildJunction(
          database,
          { table: "contact_pattern_children", owner: "contact_pattern_id" },
          request.params.id,
          parsed.data.childIds,
          timestamp
        );
        const after = await getPattern(database, request.params.id);
        if (!after) throw new Error("Umgangsregel konnte nicht geladen werden.");
        await recordDomainFieldChanges(
          database,
          request.userEmail,
          "contact_pattern",
          request.params.id,
          before,
          after,
          ["updatedAt", "updatedBy"]
        );
        await upsertContactRuleFromPattern(
          patternInputFromRow(after, await getPersistedDefaultResponsiblePartyId(database)),
          database
        );
        const syncSummary = await syncContactRule(after.id, {
          userEmail: request.userEmail,
          database,
          recordAudit: true
        });
        return { ...after, syncSummary };
      });
    } catch (error) {
      return reply.code(400).send({ error: "invalid_relation", message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/contact-patterns/:id", writeLimit, async (request, reply) => {
    const before = await getPattern(app.persistence.query, request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const timestamp = nowIso();
    await app.persistence.transaction(async (database) => {
      await database.updateTable("contact_patterns")
        .set({ deleted_at: timestamp, updated_by: request.userEmail, updated_at: timestamp })
        .where("id", "=", request.params.id)
        .execute();
      await database.updateTable("contact_pattern_children")
        .set({ deleted_at: timestamp, updated_at: timestamp })
        .where("contact_pattern_id", "=", request.params.id)
        .where("deleted_at", "is", null)
        .execute();
      await database.updateTable("contact_rules")
        .set({ deleted_at: timestamp, updated_by: request.userEmail, updated_at: timestamp })
        .where("source_contact_pattern_id", "=", request.params.id)
        .where("deleted_at", "is", null)
        .execute();
      await database.updateTable("contact_rule_children")
        .set({ deleted_at: timestamp, updated_at: timestamp })
        .where("contact_rule_id", "=", request.params.id)
        .where("deleted_at", "is", null)
        .execute();
      await recordDomainAudit(database, {
        userEmail: request.userEmail,
        entityType: "contact_pattern",
        entityId: request.params.id,
        action: "deleted",
        oldValue: before
      });
    });
    return reply.code(204).send();
  });
}
