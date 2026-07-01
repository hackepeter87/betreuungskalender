import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db/connection.js";
import {
  markAllClosedMonthsChanged,
  recordAudit,
  recordFieldChanges
} from "../services/audit.js";
import { getCareParty, mapCareParty, type CarePartyRow } from "../services/careParties.js";
import { makeId, nowIso } from "../services/common.js";
import { carePartyInputSchema } from "../validation/schemas.js";

const readLimit = {
  config: { rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};

function assignedUsageCount(id: string): number {
  const row = db.prepare(`
    SELECT
      (
        SELECT COUNT(*) FROM care_entries
        WHERE responsible_party_id = ? AND deleted_at IS NULL
      ) + (
        SELECT COUNT(*) FROM contact_rules
        WHERE responsible_party_id = ? AND deleted_at IS NULL
      ) AS count
  `).get(id, id) as { count: number };
  return row.count;
}

export async function carePartyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/care-parties", readLimit, async () => {
    const rows = db.prepare(`
      SELECT id, name, kind, created_by, updated_by, created_at, updated_at
      FROM care_parties
      WHERE deleted_at IS NULL
      ORDER BY name COLLATE NOCASE
    `).all() as CarePartyRow[];
    return rows.map(mapCareParty);
  });

  app.post("/api/care-parties", writeLimit, async (request, reply) => {
    const parsed = carePartyInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });

    const id = makeId("party");
    const timestamp = nowIso();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO care_parties (
          id, name, kind, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        parsed.data.name,
        parsed.data.kind,
        request.userEmail,
        request.userEmail,
        timestamp,
        timestamp
      );
      recordAudit({
        userEmail: request.userEmail,
        entityType: "care_party",
        entityId: id,
        action: "created",
        newValue: parsed.data
      });
    })();

    return reply.code(201).send(getCareParty(id));
  });

  app.put<{ Params: { id: string } }>("/api/care-parties/:id", writeLimit, async (request, reply) => {
    const before = getCareParty(request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const parsed = carePartyInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });

    const timestamp = nowIso();
    db.transaction(() => {
      db.prepare(`
        UPDATE care_parties
        SET name = ?, kind = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `).run(
        parsed.data.name,
        parsed.data.kind,
        request.userEmail,
        timestamp,
        request.params.id
      );
      recordFieldChanges(
        request.userEmail,
        "care_party",
        request.params.id,
        before,
        { ...before, ...parsed.data, updatedBy: request.userEmail, updatedAt: timestamp },
        ["updatedAt", "updatedBy"]
      );
      markAllClosedMonthsChanged(
        request.userEmail,
        "care_party",
        request.params.id,
        timestamp
      );
    })();

    return getCareParty(request.params.id);
  });

  app.delete<{ Params: { id: string } }>("/api/care-parties/:id", writeLimit, async (request, reply) => {
    const before = getCareParty(request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const usageCount = assignedUsageCount(request.params.id);
    if (usageCount > 0) {
      return reply.code(409).send({
        error: "care_party_in_use",
        message: "Diese betreuende Person ist noch Terminen oder Umgangsregeln zugeordnet."
      });
    }
    const timestamp = nowIso();

    db.transaction(() => {
      db.prepare("UPDATE care_parties SET deleted_at = ?, updated_by = ?, updated_at = ? WHERE id = ?")
        .run(timestamp, request.userEmail, timestamp, request.params.id);
      recordAudit({
        userEmail: request.userEmail,
        entityType: "care_party",
        entityId: request.params.id,
        action: "deleted",
        oldValue: before
      });
      markAllClosedMonthsChanged(
        request.userEmail,
        "care_party",
        request.params.id,
        timestamp
      );
    })();

    return reply.code(204).send();
  });
}
