import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db/connection.js";
import { recordAudit, recordFieldChanges } from "../services/audit.js";
import { assertActiveChildren, bool, makeId, nowIso, syncJunction } from "../services/common.js";
import { contactPatternInputSchema } from "../validation/schemas.js";

const readLimit = {
  config: { rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
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

function getChildIds(id: string): string[] {
  return (db.prepare(`
    SELECT child_id AS childId
    FROM contact_pattern_children
    WHERE contact_pattern_id = ? AND deleted_at IS NULL
    ORDER BY child_id
  `).all(id) as Array<{ childId: string }>).map((row) => row.childId);
}

function mapPattern(row: PatternRow) {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    frequency: row.frequency,
    fridayStartTime: row.friday_start_time,
    sundayEndTime: row.sunday_end_time,
    childIds: getChildIds(row.id),
    active: bool(row.active),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getPattern(id: string) {
  const row = db.prepare(`
    SELECT * FROM contact_patterns WHERE id = ? AND deleted_at IS NULL
  `).get(id) as PatternRow | undefined;
  return row ? mapPattern(row) : undefined;
}

export async function contactPatternRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/contact-patterns", readLimit, async () => {
    const rows = db.prepare(`
      SELECT * FROM contact_patterns
      WHERE deleted_at IS NULL
      ORDER BY start_date, name
    `).all() as PatternRow[];
    return rows.map(mapPattern);
  });

  app.post("/api/contact-patterns", writeLimit, async (request, reply) => {
    const parsed = contactPatternInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const id = makeId("pattern");
    const timestamp = nowIso();
    try {
      db.transaction(() => {
        assertActiveChildren(parsed.data.childIds);
        db.prepare(`
          INSERT INTO contact_patterns (
            id, name, start_date, frequency, friday_start_time, sunday_end_time,
            active, created_by, updated_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, parsed.data.name, parsed.data.startDate, parsed.data.frequency,
          parsed.data.fridayStartTime, parsed.data.sundayEndTime,
          Number(parsed.data.active), request.userEmail, request.userEmail,
          timestamp, timestamp
        );
        syncJunction("contact_pattern_children", "contact_pattern_id", id, parsed.data.childIds, timestamp);
        recordAudit({
          userEmail: request.userEmail,
          entityType: "contact_pattern",
          entityId: id,
          action: "created",
          newValue: getPattern(id)
        });
      })();
    } catch (error) {
      return reply.code(400).send({ error: "invalid_relation", message: error instanceof Error ? error.message : String(error) });
    }
    return reply.code(201).send(getPattern(id));
  });

  app.put<{ Params: { id: string } }>("/api/contact-patterns/:id", writeLimit, async (request, reply) => {
    const before = getPattern(request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const parsed = contactPatternInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const timestamp = nowIso();
    try {
      db.transaction(() => {
        assertActiveChildren(parsed.data.childIds);
        db.prepare(`
          UPDATE contact_patterns
          SET name = ?, start_date = ?, frequency = ?, friday_start_time = ?,
              sunday_end_time = ?, active = ?, updated_by = ?, updated_at = ?, deleted_at = NULL
          WHERE id = ?
        `).run(
          parsed.data.name, parsed.data.startDate, parsed.data.frequency,
          parsed.data.fridayStartTime, parsed.data.sundayEndTime,
          Number(parsed.data.active), request.userEmail, timestamp, request.params.id
        );
        syncJunction(
          "contact_pattern_children",
          "contact_pattern_id",
          request.params.id,
          parsed.data.childIds,
          timestamp
        );
        const after = getPattern(request.params.id);
        if (after) recordFieldChanges(request.userEmail, "contact_pattern", request.params.id, before, after, ["updatedAt", "updatedBy"]);
      })();
    } catch (error) {
      return reply.code(400).send({ error: "invalid_relation", message: error instanceof Error ? error.message : String(error) });
    }
    return getPattern(request.params.id);
  });

  app.delete<{ Params: { id: string } }>("/api/contact-patterns/:id", writeLimit, async (request, reply) => {
    const before = getPattern(request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const timestamp = nowIso();
    db.transaction(() => {
      db.prepare("UPDATE contact_patterns SET deleted_at = ?, updated_by = ?, updated_at = ? WHERE id = ?")
        .run(timestamp, request.userEmail, timestamp, request.params.id);
      db.prepare("UPDATE contact_pattern_children SET deleted_at = ?, updated_at = ? WHERE contact_pattern_id = ? AND deleted_at IS NULL")
        .run(timestamp, timestamp, request.params.id);
      recordAudit({
        userEmail: request.userEmail,
        entityType: "contact_pattern",
        entityId: request.params.id,
        action: "deleted",
        oldValue: before
      });
    })();
    return reply.code(204).send();
  });
}
