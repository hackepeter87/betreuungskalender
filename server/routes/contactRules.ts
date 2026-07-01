import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db/connection.js";
import { recordAudit, recordFieldChanges } from "../services/audit.js";
import { assertActiveChildren, makeId, nowIso } from "../services/common.js";
import {
  getContactRule,
  syncContactRule,
  upsertContactRule
} from "../services/contactRules.js";
import { contactRuleInputSchema } from "../validation/schemas.js";

const readLimit = {
  config: { rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};

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
        assertActiveChildren(parsed.data.childIds);
        const saved = upsertContactRule({
          id,
          rule: parsed.data,
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
        assertActiveChildren(parsed.data.childIds);
        const saved = upsertContactRule({
          id: request.params.id,
          rule: {
            ...parsed.data,
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

  app.delete<{ Params: { id: string } }>("/api/contact-rules/:id", writeLimit, async (request, reply) => {
    const before = getContactRule(request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
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
