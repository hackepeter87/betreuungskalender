import type { FastifyInstance } from "fastify";
import { db } from "../db/connection.js";
import {
  markAllClosedMonthsChanged,
  recordAudit,
  recordFieldChanges
} from "../services/audit.js";
import { makeId, nowIso } from "../services/common.js";
import { childInputSchema } from "../validation/schemas.js";

interface ChildRow {
  id: string;
  name: string;
  birth_month: number;
  birth_year: number;
  color: string;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getChild(id: string) {
  const row = db.prepare(`
    SELECT id, name, birth_month, birth_year, color, created_at, updated_at
    FROM children
    WHERE id = ? AND deleted_at IS NULL
  `).get(id) as ChildRow | undefined;
  return row ? mapChild(row) : undefined;
}

export async function childrenRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/children", async () => {
    const rows = db.prepare(`
      SELECT id, name, birth_month, birth_year, color, created_at, updated_at
      FROM children
      WHERE deleted_at IS NULL
      ORDER BY name COLLATE NOCASE
    `).all() as ChildRow[];
    return rows.map(mapChild);
  });

  app.post("/api/children", async (request, reply) => {
    const parsed = childInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });

    const id = makeId("child");
    const timestamp = nowIso();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO children (
          id, name, birth_month, birth_year, color, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        parsed.data.name,
        parsed.data.birthMonth,
        parsed.data.birthYear,
        parsed.data.color,
        timestamp,
        timestamp
      );
      recordAudit({
        userEmail: request.userEmail,
        entityType: "child",
        entityId: id,
        action: "created",
        newValue: parsed.data
      });
    })();

    return reply.code(201).send(getChild(id));
  });

  app.put<{ Params: { id: string } }>("/api/children/:id", async (request, reply) => {
    const before = getChild(request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const parsed = childInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });

    const timestamp = nowIso();
    db.transaction(() => {
      db.prepare(`
        UPDATE children
        SET name = ?, birth_month = ?, birth_year = ?, color = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL
      `).run(
        parsed.data.name,
        parsed.data.birthMonth,
        parsed.data.birthYear,
        parsed.data.color,
        timestamp,
        request.params.id
      );
      recordFieldChanges(
        request.userEmail,
        "child",
        request.params.id,
        before,
        { ...before, ...parsed.data, updatedAt: timestamp },
        ["updatedAt"]
      );
      markAllClosedMonthsChanged(
        request.userEmail,
        "child",
        request.params.id,
        timestamp
      );
    })();

    return getChild(request.params.id);
  });

  app.delete<{ Params: { id: string } }>("/api/children/:id", async (request, reply) => {
    const before = getChild(request.params.id);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const timestamp = nowIso();

    db.transaction(() => {
      db.prepare("UPDATE children SET deleted_at = ?, updated_at = ? WHERE id = ?")
        .run(timestamp, timestamp, request.params.id);
      for (const table of [
        ["care_entry_children", "care_entry_id", "care_entries"],
        ["holiday_period_children", "holiday_period_id", "holiday_periods"],
        ["contact_pattern_children", "contact_pattern_id", "contact_patterns"]
      ] as const) {
        db.prepare(`
          UPDATE ${table[0]}
          SET deleted_at = ?, updated_at = ?
          WHERE child_id = ? AND deleted_at IS NULL
        `).run(timestamp, timestamp, request.params.id);
        db.prepare(`
          UPDATE ${table[2]}
          SET deleted_at = ?, updated_at = ?
          WHERE id IN (
            SELECT owner.${table[1]}
            FROM ${table[0]} owner
            GROUP BY owner.${table[1]}
            HAVING SUM(CASE WHEN owner.deleted_at IS NULL THEN 1 ELSE 0 END) = 0
          ) AND deleted_at IS NULL
        `).run(timestamp, timestamp);
      }
      recordAudit({
        userEmail: request.userEmail,
        entityType: "child",
        entityId: request.params.id,
        action: "deleted",
        oldValue: before
      });
      markAllClosedMonthsChanged(
        request.userEmail,
        "child",
        request.params.id,
        timestamp
      );
    })();

    return reply.code(204).send();
  });
}
