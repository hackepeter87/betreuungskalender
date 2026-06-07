import type { FastifyInstance } from "fastify";
import type { ApiUnavailablePeriod } from "../../shared/api.js";
import { db } from "../db/connection.js";
import { recordAudit, recordFieldChanges } from "../services/audit.js";
import { bool, makeId, nowIso } from "../services/common.js";
import {
  unavailablePeriodInputSchema,
  unavailablePeriodWarnings
} from "../validation/schemas.js";

interface UnavailableRow {
  id: string;
  start_datetime: string;
  end_datetime: string;
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

function mapPeriod(row: UnavailableRow): ApiUnavailablePeriod {
  const period = {
    id: row.id,
    startDateTime: row.start_datetime,
    endDateTime: row.end_datetime,
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

function getPeriod(id: string): ApiUnavailablePeriod | undefined {
  const row = db.prepare(`
    SELECT * FROM unavailable_periods
    WHERE id = ? AND deleted_at IS NULL
  `).get(id) as UnavailableRow | undefined;
  return row ? mapPeriod(row) : undefined;
}

export async function unavailablePeriodRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { startDate?: string; endDate?: string } }>(
    "/api/unavailable-periods",
    async (request) => {
      const conditions = ["deleted_at IS NULL"];
      const values: string[] = [];
      if (request.query.startDate) {
        conditions.push("end_datetime >= ?");
        values.push(`${request.query.startDate}T00:00:00`);
      }
      if (request.query.endDate) {
        conditions.push("start_datetime <= ?");
        values.push(`${request.query.endDate}T23:59:59`);
      }
      const rows = db.prepare(`
        SELECT * FROM unavailable_periods
        WHERE ${conditions.join(" AND ")}
        ORDER BY start_datetime, id
      `).all(...values) as UnavailableRow[];
      return rows.map(mapPeriod);
    }
  );

  app.post("/api/unavailable-periods", async (request, reply) => {
    const parsed = unavailablePeriodInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        issues: parsed.error.issues
      });
    }
    const id = makeId("unavailable");
    const timestamp = nowIso();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO unavailable_periods (
          id, start_datetime, end_datetime, category, duty_related,
          affects_contact, affects_holidays, location, notes, has_evidence,
          evidence_reference, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        parsed.data.startDateTime,
        parsed.data.endDateTime,
        parsed.data.category,
        Number(parsed.data.dutyRelated),
        Number(parsed.data.affectsContact),
        Number(parsed.data.affectsHolidays),
        parsed.data.location ?? null,
        parsed.data.notes ?? null,
        Number(parsed.data.hasEvidence),
        parsed.data.evidenceReference ?? null,
        request.userEmail,
        request.userEmail,
        timestamp,
        timestamp
      );
      recordAudit({
        userEmail: request.userEmail,
        entityType: "unavailable_period",
        entityId: id,
        action: "created",
        newValue: getPeriod(id)
      });
    })();
    return reply.code(201).send(getPeriod(id));
  });

  app.put<{ Params: { id: string } }>(
    "/api/unavailable-periods/:id",
    async (request, reply) => {
      const before = getPeriod(request.params.id);
      if (!before) return reply.code(404).send({ error: "not_found" });
      const parsed = unavailablePeriodInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "validation_error",
          issues: parsed.error.issues
        });
      }
      const timestamp = nowIso();
      db.transaction(() => {
        db.prepare(`
          UPDATE unavailable_periods SET
            start_datetime = ?, end_datetime = ?, category = ?,
            duty_related = ?, affects_contact = ?, affects_holidays = ?,
            location = ?, notes = ?, has_evidence = ?, evidence_reference = ?,
            updated_by = ?, updated_at = ?, deleted_at = NULL
          WHERE id = ?
        `).run(
          parsed.data.startDateTime,
          parsed.data.endDateTime,
          parsed.data.category,
          Number(parsed.data.dutyRelated),
          Number(parsed.data.affectsContact),
          Number(parsed.data.affectsHolidays),
          parsed.data.location ?? null,
          parsed.data.notes ?? null,
          Number(parsed.data.hasEvidence),
          parsed.data.evidenceReference ?? null,
          request.userEmail,
          timestamp,
          request.params.id
        );
        const after = getPeriod(request.params.id);
        if (after) {
          recordFieldChanges(
            request.userEmail,
            "unavailable_period",
            request.params.id,
            before,
            after,
            ["updatedAt", "updatedBy", "warnings"]
          );
        }
      })();
      return getPeriod(request.params.id);
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/unavailable-periods/:id",
    async (request, reply) => {
      const before = getPeriod(request.params.id);
      if (!before) return reply.code(404).send({ error: "not_found" });
      const timestamp = nowIso();
      db.transaction(() => {
        db.prepare(`
          UPDATE unavailable_periods
          SET deleted_at = ?, updated_at = ?, updated_by = ?
          WHERE id = ?
        `).run(timestamp, timestamp, request.userEmail, request.params.id);
        recordAudit({
          userEmail: request.userEmail,
          entityType: "unavailable_period",
          entityId: request.params.id,
          action: "deleted",
          oldValue: before
        });
      })();
      return reply.code(204).send();
    }
  );
}
