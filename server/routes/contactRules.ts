import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isValidDateKey } from "../../shared/temporal.js";
import { config } from "../config.js";
import {
  assertCanUsePersistedCareParty,
  assertPersistedCareParty,
  assertPersistedChildren,
  getPersistedDefaultResponsiblePartyId,
  recordDomainAudit,
  recordDomainFieldChanges
} from "../services/domainPersistence.js";
import { makeId, nowIso } from "../services/common.js";
import {
  getContactRule,
  isContactRuleSyncPreviewChangedError,
  previewContactRuleSync,
  syncContactRule,
  upsertContactRule
} from "../services/contactRules.js";
import { contactRuleInputSchema } from "../validation/schemas.js";

const readLimit = {
  config: { permission: "planning:view" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { permission: "planning:manage" as const, rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};

const syncRangeFields = {
  startDate: z.string().refine(isValidDateKey),
  endDate: z.string().refine(isValidDateKey)
};
const syncRangeSchema = z.object(syncRangeFields)
  .refine((range) => range.endDate >= range.startDate, { path: ["endDate"] });

const syncInputSchema = z.object({
  ...syncRangeFields,
  previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/)
}).refine((range) => range.endDate >= range.startDate, { path: ["endDate"] });

export async function contactRuleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/contact-rules", readLimit, async () => {
    const rows = await app.persistence.query.selectFrom("contact_rules")
      .select("id")
      .where("deleted_at", "is", null)
      .orderBy("start_date")
      .orderBy("name")
      .execute();
    const rules = await Promise.all(rows.map((row) => getContactRule(row.id, app.persistence.query)));
    return rules.filter((rule) => rule !== undefined);
  });

  app.post("/api/contact-rules", writeLimit, async (request, reply) => {
    const parsed = contactRuleInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const id = makeId("rule");
    const timestamp = nowIso();
    try {
      const result = await app.persistence.transaction(async (database) => {
        const rule = {
          ...parsed.data,
          responsiblePartyId: parsed.data.responsiblePartyId ?? await getPersistedDefaultResponsiblePartyId(database)
        };
        await assertPersistedChildren(database, rule.childIds);
        await assertPersistedCareParty(database, rule.responsiblePartyId);
        await assertCanUsePersistedCareParty(database, request.user, rule.responsiblePartyId);
        const saved = await upsertContactRule({
          id,
          rule,
          createdBy: request.userEmail,
          updatedBy: request.userEmail,
          createdAt: timestamp,
          updatedAt: timestamp,
          database
        });
        await recordDomainAudit(database, {
          userEmail: request.userEmail,
          entityType: "contact_rule",
          entityId: id,
          action: "created",
          newValue: saved
        });
        const syncSummary = await syncContactRule(id, {
          userEmail: request.userEmail,
          database,
          recordAudit: true
        });
        return { ...await getContactRule(id, database), syncSummary };
      });
      return reply.code(201).send(result);
    } catch (error) {
      return reply.code(400).send({
        error: "invalid_relation",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.put<{ Params: { id: string } }>("/api/contact-rules/:id", writeLimit, async (request, reply) => {
    const before = await getContactRule(request.params.id, app.persistence.query);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const parsed = contactRuleInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const timestamp = nowIso();
    try {
      return await app.persistence.transaction(async (database) => {
        await assertCanUsePersistedCareParty(database, request.user, before.responsiblePartyId);
        const rule = {
          ...parsed.data,
          responsiblePartyId: parsed.data.responsiblePartyId ?? before.responsiblePartyId ??
            await getPersistedDefaultResponsiblePartyId(database)
        };
        await assertPersistedChildren(database, rule.childIds);
        await assertPersistedCareParty(database, rule.responsiblePartyId);
        await assertCanUsePersistedCareParty(database, request.user, rule.responsiblePartyId);
        const saved = await upsertContactRule({
          id: request.params.id,
          rule: { ...rule, sourceContactPatternId: before.sourceContactPatternId },
          createdBy: before.createdBy,
          updatedBy: request.userEmail,
          createdAt: before.createdAt,
          updatedAt: timestamp,
          database
        });
        await recordDomainFieldChanges(
          database,
          request.userEmail,
          "contact_rule",
          request.params.id,
          before,
          saved,
          ["updatedAt", "updatedBy", "syncSummary"]
        );
        const syncSummary = await syncContactRule(request.params.id, {
          userEmail: request.userEmail,
          database,
          recordAudit: true
        });
        return { ...await getContactRule(request.params.id, database), syncSummary };
      });
    } catch (error) {
      return reply.code(400).send({
        error: "invalid_relation",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post<{ Params: { id: string } }>("/api/contact-rules/:id/sync-preview", writeLimit, async (request, reply) => {
    const rule = await getContactRule(request.params.id, app.persistence.query);
    if (!rule) return reply.code(404).send({ error: "not_found" });
    const parsed = syncRangeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    try {
      await assertCanUsePersistedCareParty(app.persistence.query, request.user, rule.responsiblePartyId);
      return await previewContactRuleSync(request.params.id, {
        ...parsed.data,
        database: app.persistence.query
      });
    } catch (error) {
      return reply.code(400).send({
        error: "invalid_sync_range",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post<{ Params: { id: string } }>("/api/contact-rules/:id/sync", writeLimit, async (request, reply) => {
    const rule = await getContactRule(request.params.id, app.persistence.query);
    if (!rule) return reply.code(404).send({ error: "not_found" });
    try {
      await assertCanUsePersistedCareParty(app.persistence.query, request.user, rule.responsiblePartyId);
      const ranged = request.body && Object.keys(request.body as object).length
        ? syncInputSchema.safeParse(request.body)
        : undefined;
      if (ranged && !ranged.success) {
        return reply.code(400).send({ error: "validation_error", issues: ranged.error.issues });
      }
      return await app.persistence.transaction(async (database) => {
        const syncSummary = await syncContactRule(request.params.id, {
          database,
          userEmail: request.userEmail,
          recordAudit: true,
          ...(ranged?.success ? {
            startDate: ranged.data.startDate,
            endDate: ranged.data.endDate,
            previewFingerprint: ranged.data.previewFingerprint,
            suppressPastConfirmations: true
          } : {})
        });
        return { ...await getContactRule(request.params.id, database), syncSummary };
      });
    } catch (error) {
      if (isContactRuleSyncPreviewChangedError(error)) {
        return reply.code(409).send({ error: "contact_rule_sync_preview_changed" });
      }
      return reply.code(400).send({
        error: "invalid_relation",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/contact-rules/:id", writeLimit, async (request, reply) => {
    const before = await getContactRule(request.params.id, app.persistence.query);
    if (!before) return reply.code(404).send({ error: "not_found" });
    try {
      await assertCanUsePersistedCareParty(app.persistence.query, request.user, before.responsiblePartyId);
    } catch (error) {
      return reply.code(400).send({
        error: "invalid_relation",
        message: error instanceof Error ? error.message : String(error)
      });
    }
    const timestamp = nowIso();
    await app.persistence.transaction(async (database) => {
      await database.updateTable("contact_rules")
        .set({ deleted_at: timestamp, updated_by: request.userEmail, updated_at: timestamp })
        .where("id", "=", request.params.id)
        .execute();
      await database.updateTable("contact_rule_children")
        .set({ deleted_at: timestamp, updated_at: timestamp })
        .where("contact_rule_id", "=", request.params.id)
        .where("deleted_at", "is", null)
        .execute();
      await recordDomainAudit(database, {
        userEmail: request.userEmail,
        entityType: "contact_rule",
        entityId: request.params.id,
        action: "deleted",
        oldValue: before
      });
    });
    return reply.code(204).send();
  });
}
