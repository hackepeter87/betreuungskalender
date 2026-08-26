import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isValidDateKey } from "../../shared/temporal.js";
import { config } from "../config.js";
import { db } from "../db/connection.js";
import { recordAudit, recordFieldChanges } from "../services/audit.js";
import { assertCanUseCareParty } from "../services/carePartyAccess.js";
import { assertActiveCareParty } from "../services/careParties.js";
import { assertActiveChildren, makeId, nowIso } from "../services/common.js";
import {
  getContactRule,
  isContactRuleSyncPreviewChangedError,
  previewContactRuleSync,
  syncContactRule,
  upsertContactRule
} from "../services/contactRules.js";
import { getDefaultResponsiblePartyId } from "../services/settings.js";
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
    const rows = db.prepare(`
      SELECT id
      FROM contact_rules
      WHERE deleted_at IS NULL
      ORDER BY start_date, name
    `).all() as Array<{ id: string }>;
    return rows.map((row) => getContactRule(row.id)).filter(Boolean);
  });

  app.post("/api/contact-rules", writeLimit, async (request, reply) => {
    const parsed = contactRuleInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const id = makeId("rule");
    const timestamp = nowIso();
    let syncSummary;
    try {
      db.transaction(() => {
        const rule = {
          ...parsed.data,
          responsiblePartyId: parsed.data.responsiblePartyId ?? getDefaultResponsiblePartyId()
        };
        assertActiveChildren(parsed.data.childIds);
        assertActiveCareParty(rule.responsiblePartyId);
        assertCanUseCareParty(request.user, rule.responsiblePartyId);
        const saved = upsertContactRule({
          id,
          rule,
          createdBy: request.userEmail,
          updatedBy: request.userEmail,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        recordAudit({
          userEmail: request.userEmail,
          entityType: "contact_rule",
          entityId: id,
          action: "created",
          newValue: saved
        });
        syncSummary = syncContactRule(id, { userEmail: request.userEmail });
      })();
    } catch (error) {
      return reply.code(400).send({
        error: "invalid_relation",
        message: error instanceof Error ? error.message : String(error)
      });
    }
    return reply.code(201).send({ ...getContactRule(id), syncSummary });
  });

  app.put<{ Params: { id: string } }>("/api/contact-rules/:id", writeLimit, async (request, reply) => {
    const before = getContactRule(request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const parsed = contactRuleInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const timestamp = nowIso();
    let syncSummary;
    try {
      db.transaction(() => {
        assertCanUseCareParty(request.user, before.responsiblePartyId);
        const rule = {
          ...parsed.data,
          responsiblePartyId: parsed.data.responsiblePartyId ?? before.responsiblePartyId ?? getDefaultResponsiblePartyId()
        };
        assertActiveChildren(parsed.data.childIds);
        assertActiveCareParty(rule.responsiblePartyId);
        assertCanUseCareParty(request.user, rule.responsiblePartyId);
        const saved = upsertContactRule({
          id: request.params.id,
          rule: {
            ...rule,
            sourceContactPatternId: before.sourceContactPatternId
          },
          createdBy: before.createdBy,
          updatedBy: request.userEmail,
          createdAt: before.createdAt,
          updatedAt: timestamp
        });
        recordFieldChanges(
          request.userEmail,
          "contact_rule",
          request.params.id,
          before,
          saved,
          ["updatedAt", "updatedBy", "syncSummary"]
        );
        syncSummary = syncContactRule(request.params.id, { userEmail: request.userEmail });
      })();
    } catch (error) {
      return reply.code(400).send({
        error: "invalid_relation",
        message: error instanceof Error ? error.message : String(error)
      });
    }
    return { ...getContactRule(request.params.id), syncSummary };
  });

  app.post<{ Params: { id: string } }>("/api/contact-rules/:id/sync-preview", writeLimit, async (request, reply) => {
    const rule = getContactRule(request.params.id);
    if (!rule) return reply.code(404).send({ error: "not_found" });
    const parsed = syncRangeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    try {
      assertCanUseCareParty(request.user, rule.responsiblePartyId);
      return previewContactRuleSync(request.params.id, parsed.data);
    } catch (error) {
      return reply.code(400).send({
        error: "invalid_sync_range",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post<{ Params: { id: string } }>("/api/contact-rules/:id/sync", writeLimit, async (request, reply) => {
    const rule = getContactRule(request.params.id);
    if (!rule) return reply.code(404).send({ error: "not_found" });
    try {
      assertCanUseCareParty(request.user, rule.responsiblePartyId);
      const ranged = request.body && Object.keys(request.body as object).length
        ? syncInputSchema.safeParse(request.body)
        : undefined;
      if (ranged && !ranged.success) {
        return reply.code(400).send({ error: "validation_error", issues: ranged.error.issues });
      }
      const syncSummary = db.transaction(() =>
        syncContactRule(request.params.id, {
          userEmail: request.userEmail,
          ...(ranged?.success ? {
            startDate: ranged.data.startDate,
            endDate: ranged.data.endDate,
            previewFingerprint: ranged.data.previewFingerprint,
            suppressPastConfirmations: true
          } : {})
        })
      )();
      return { ...getContactRule(request.params.id), syncSummary };
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
    const before = getContactRule(request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
    try {
      assertCanUseCareParty(request.user, before.responsiblePartyId);
    } catch (error) {
      return reply.code(400).send({
        error: "invalid_relation",
        message: error instanceof Error ? error.message : String(error)
      });
    }
    const timestamp = nowIso();
    db.transaction(() => {
      db.prepare(`
        UPDATE contact_rules
        SET deleted_at = ?, updated_by = ?, updated_at = ?
        WHERE id = ?
      `).run(timestamp, request.userEmail, timestamp, request.params.id);
      db.prepare(`
        UPDATE contact_rule_children
        SET deleted_at = ?, updated_at = ?
        WHERE contact_rule_id = ? AND deleted_at IS NULL
      `).run(timestamp, timestamp, request.params.id);
      recordAudit({
        userEmail: request.userEmail,
        entityType: "contact_rule",
        entityId: request.params.id,
        action: "deleted",
        oldValue: before
      });
    })();
    return reply.code(204).send();
  });
}
