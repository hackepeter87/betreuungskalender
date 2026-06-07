import type { FastifyInstance } from "fastify";
import type { ApiCareEntry, ApiCost, ApiTrip } from "../../shared/api.js";
import { db } from "../db/connection.js";
import { recordAudit, recordFieldChanges } from "../services/audit.js";
import { assertActiveChildren, bool, makeId, nowIso, syncJunction } from "../services/common.js";
import { careEntryInputSchema } from "../validation/schemas.js";

interface EntryRow {
  id: string;
  start_datetime: string;
  end_datetime: string;
  status: ApiCareEntry["status"];
  care_scope: ApiCareEntry["careScope"];
  cancellation_reason: string | null;
  overnight: number;
  school_handover: number;
  holiday: number;
  weekend: number;
  additional_care: number;
  location: string | null;
  handover_from: string | null;
  handover_to: string | null;
  notes: string | null;
  evidence_reference: string | null;
  has_evidence: number;
  duration_minutes: number;
  is_contact_time: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

interface TripRow {
  id: string;
  purpose: string;
  km: number;
  own_car: number;
  reimbursed: number;
  reimbursement_amount: number | null;
  notes: string | null;
}

interface CostRow {
  id: string;
  category: string;
  amount: number;
  paid_by: string;
  notes: string | null;
}

function optional<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

function getChildIds(entryId: string): string[] {
  return (db.prepare(`
    SELECT child_id AS childId
    FROM care_entry_children
    WHERE care_entry_id = ? AND deleted_at IS NULL
    ORDER BY child_id
  `).all(entryId) as Array<{ childId: string }>).map((row) => row.childId);
}

function getTrips(entryId: string): ApiTrip[] {
  const rows = db.prepare(`
    SELECT id, purpose, km, own_car, reimbursed, reimbursement_amount, notes
    FROM trips
    WHERE care_entry_id = ? AND deleted_at IS NULL
    ORDER BY created_at, id
  `).all(entryId) as TripRow[];
  return rows.map((row) => ({
    id: row.id,
    purpose: row.purpose,
    km: row.km,
    ownCar: bool(row.own_car),
    reimbursed: bool(row.reimbursed),
    reimbursementAmount: optional(row.reimbursement_amount),
    notes: optional(row.notes)
  }));
}

function getCosts(entryId: string): ApiCost[] {
  const rows = db.prepare(`
    SELECT id, category, amount, paid_by, notes
    FROM costs
    WHERE care_entry_id = ? AND deleted_at IS NULL
    ORDER BY created_at, id
  `).all(entryId) as CostRow[];
  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    amount: row.amount,
    paidBy: row.paid_by,
    notes: optional(row.notes)
  }));
}

function mapEntry(row: EntryRow): ApiCareEntry {
  return {
    id: row.id,
    startDateTime: row.start_datetime,
    endDateTime: row.end_datetime,
    childIds: getChildIds(row.id),
    status: row.status,
    careScope: row.care_scope,
    cancellationReason: optional(row.cancellation_reason),
    overnight: bool(row.overnight),
    schoolHandover: bool(row.school_handover),
    holiday: bool(row.holiday),
    weekend: bool(row.weekend),
    additionalCare: bool(row.additional_care),
    location: optional(row.location),
    handoverFrom: optional(row.handover_from),
    handoverTo: optional(row.handover_to),
    notes: optional(row.notes),
    evidenceReference: optional(row.evidence_reference),
    hasEvidence: bool(row.has_evidence),
    durationMinutes: row.duration_minutes,
    isContactTime: bool(row.is_contact_time),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trips: getTrips(row.id),
    costs: getCosts(row.id)
  };
}

function getEntry(id: string): ApiCareEntry | undefined {
  const row = db.prepare(`
    SELECT *
    FROM care_entries
    WHERE id = ? AND deleted_at IS NULL
  `).get(id) as EntryRow | undefined;
  return row ? mapEntry(row) : undefined;
}

function syncTrips(
  entryId: string,
  trips: Array<{
    id?: string;
    purpose: string;
    km: number;
    ownCar: boolean;
    reimbursed: boolean;
    reimbursementAmount?: number;
    notes?: string;
  }>,
  userEmail: string,
  timestamp: string
): void {
  const existing = new Map(getTrips(entryId).map((trip) => [trip.id, trip]));
  const retained = new Set<string>();

  for (const trip of trips) {
    const id = trip.id && existing.has(trip.id) ? trip.id : makeId("trip");
    const before = existing.get(id);
    retained.add(id);
    if (before) {
      db.prepare(`
        UPDATE trips
        SET purpose = ?, km = ?, own_car = ?, reimbursed = ?,
            reimbursement_amount = ?, notes = ?, updated_at = ?, deleted_at = NULL
        WHERE id = ? AND care_entry_id = ?
      `).run(
        trip.purpose, trip.km, Number(trip.ownCar), Number(trip.reimbursed),
        trip.reimbursementAmount ?? null, trip.notes ?? null, timestamp, id, entryId
      );
      recordFieldChanges(userEmail, "trip", id, before, { ...trip, id });
    } else {
      db.prepare(`
        INSERT INTO trips (
          id, care_entry_id, purpose, km, own_car, reimbursed,
          reimbursement_amount, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, entryId, trip.purpose, trip.km, Number(trip.ownCar),
        Number(trip.reimbursed), trip.reimbursementAmount ?? null,
        trip.notes ?? null, timestamp, timestamp
      );
      recordAudit({
        userEmail,
        entityType: "trip",
        entityId: id,
        action: "created",
        newValue: { ...trip, id },
        metadata: { careEntryId: entryId }
      });
    }
  }

  for (const [id, trip] of existing) {
    if (retained.has(id)) continue;
    db.prepare("UPDATE trips SET deleted_at = ?, updated_at = ? WHERE id = ?")
      .run(timestamp, timestamp, id);
    recordAudit({
      userEmail,
      entityType: "trip",
      entityId: id,
      action: "deleted",
      oldValue: trip,
      metadata: { careEntryId: entryId }
    });
  }
}

function syncCosts(
  entryId: string,
  costs: Array<{
    id?: string;
    category: string;
    amount: number;
    paidBy: string;
    notes?: string;
  }>,
  userEmail: string,
  timestamp: string
): void {
  const existing = new Map(getCosts(entryId).map((cost) => [cost.id, cost]));
  const retained = new Set<string>();

  for (const cost of costs) {
    const id = cost.id && existing.has(cost.id) ? cost.id : makeId("cost");
    const before = existing.get(id);
    retained.add(id);
    if (before) {
      db.prepare(`
        UPDATE costs
        SET category = ?, amount = ?, paid_by = ?, notes = ?,
            updated_at = ?, deleted_at = NULL
        WHERE id = ? AND care_entry_id = ?
      `).run(cost.category, cost.amount, cost.paidBy, cost.notes ?? null, timestamp, id, entryId);
      recordFieldChanges(userEmail, "cost", id, before, { ...cost, id });
    } else {
      db.prepare(`
        INSERT INTO costs (
          id, care_entry_id, category, amount, paid_by, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, entryId, cost.category, cost.amount, cost.paidBy, cost.notes ?? null, timestamp, timestamp);
      recordAudit({
        userEmail,
        entityType: "cost",
        entityId: id,
        action: "created",
        newValue: { ...cost, id },
        metadata: { careEntryId: entryId }
      });
    }
  }

  for (const [id, cost] of existing) {
    if (retained.has(id)) continue;
    db.prepare("UPDATE costs SET deleted_at = ?, updated_at = ? WHERE id = ?")
      .run(timestamp, timestamp, id);
    recordAudit({
      userEmail,
      entityType: "cost",
      entityId: id,
      action: "deleted",
      oldValue: cost,
      metadata: { careEntryId: entryId }
    });
  }
}

function persistEntry(
  id: string,
  input: ReturnType<typeof careEntryInputSchema.parse>,
  userEmail: string,
  existing?: ApiCareEntry
): void {
  assertActiveChildren(input.childIds);
  const timestamp = nowIso();
  const durationMinutes = Math.round(
    (Date.parse(input.endDateTime) - Date.parse(input.startDateTime)) / 60000
  );
  const isContactTime = durationMinutes < 120;

  if (existing) {
    db.prepare(`
      UPDATE care_entries SET
        start_datetime = ?, end_datetime = ?, status = ?, care_scope = ?,
        cancellation_reason = ?, overnight = ?, school_handover = ?,
        holiday = ?, weekend = ?, additional_care = ?, location = ?,
        handover_from = ?, handover_to = ?, notes = ?, evidence_reference = ?,
        has_evidence = ?, duration_minutes = ?, is_contact_time = ?,
        updated_by = ?, updated_at = ?, deleted_at = NULL
      WHERE id = ?
    `).run(
      input.startDateTime, input.endDateTime, input.status, input.careScope,
      input.status === "cancelled" ? input.cancellationReason ?? null : null,
      Number(input.overnight), Number(input.schoolHandover), Number(input.holiday),
      Number(input.weekend), Number(input.additionalCare), input.location ?? null,
      input.handoverFrom ?? null, input.handoverTo ?? null, input.notes ?? null,
      input.evidenceReference ?? null, Number(input.hasEvidence), durationMinutes,
      Number(isContactTime), userEmail, timestamp, id
    );
  } else {
    db.prepare(`
      INSERT INTO care_entries (
        id, start_datetime, end_datetime, status, care_scope, cancellation_reason,
        overnight, school_handover, holiday, weekend, additional_care, location,
        handover_from, handover_to, notes, evidence_reference, has_evidence,
        duration_minutes, is_contact_time, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.startDateTime, input.endDateTime, input.status, input.careScope,
      input.status === "cancelled" ? input.cancellationReason ?? null : null,
      Number(input.overnight), Number(input.schoolHandover), Number(input.holiday),
      Number(input.weekend), Number(input.additionalCare), input.location ?? null,
      input.handoverFrom ?? null, input.handoverTo ?? null, input.notes ?? null,
      input.evidenceReference ?? null, Number(input.hasEvidence), durationMinutes,
      Number(isContactTime), userEmail, userEmail, timestamp, timestamp
    );
  }

  syncJunction("care_entry_children", "care_entry_id", id, input.childIds, timestamp);
  syncTrips(id, input.trips, userEmail, timestamp);
  syncCosts(id, input.costs, userEmail, timestamp);

  const after = getEntry(id);
  if (!after) throw new Error("Betreuungseintrag konnte nicht geladen werden.");
  if (existing) {
    recordFieldChanges(userEmail, "care_entry", id, existing, after, [
      "updatedAt", "updatedBy", "trips", "costs"
    ]);
  } else {
    recordAudit({
      userEmail,
      entityType: "care_entry",
      entityId: id,
      action: "created",
      newValue: after
    });
  }
}

export async function careEntryRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { startDate?: string; endDate?: string } }>(
    "/api/care-entries",
    async (request) => {
      const conditions = ["deleted_at IS NULL"];
      const values: string[] = [];
      if (request.query.startDate) {
        conditions.push("end_datetime >= ?");
        values.push(`${request.query.startDate}T00:00:00.000Z`);
      }
      if (request.query.endDate) {
        conditions.push("start_datetime <= ?");
        values.push(`${request.query.endDate}T23:59:59.999Z`);
      }
      const rows = db.prepare(`
        SELECT * FROM care_entries
        WHERE ${conditions.join(" AND ")}
        ORDER BY start_datetime, id
      `).all(...values) as EntryRow[];
      return rows.map(mapEntry);
    }
  );

  app.get<{ Params: { id: string } }>("/api/care-entries/:id", async (request, reply) => {
    const entry = getEntry(request.params.id);
    return entry ?? reply.code(404).send({ error: "not_found" });
  });

  app.post("/api/care-entries", async (request, reply) => {
    const parsed = careEntryInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const id = makeId("entry");
    try {
      db.transaction(() => persistEntry(id, parsed.data, request.userEmail))();
    } catch (error) {
      return reply.code(400).send({ error: "invalid_relation", message: error instanceof Error ? error.message : String(error) });
    }
    return reply.code(201).send(getEntry(id));
  });

  app.put<{ Params: { id: string } }>("/api/care-entries/:id", async (request, reply) => {
    const existing = getEntry(request.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    const parsed = careEntryInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    try {
      db.transaction(() => persistEntry(request.params.id, parsed.data, request.userEmail, existing))();
    } catch (error) {
      return reply.code(400).send({ error: "invalid_relation", message: error instanceof Error ? error.message : String(error) });
    }
    return getEntry(request.params.id);
  });

  app.delete<{ Params: { id: string } }>("/api/care-entries/:id", async (request, reply) => {
    const existing = getEntry(request.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    const timestamp = nowIso();
    db.transaction(() => {
      db.prepare("UPDATE care_entries SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ?")
        .run(timestamp, timestamp, request.userEmail, request.params.id);
      db.prepare("UPDATE care_entry_children SET deleted_at = ?, updated_at = ? WHERE care_entry_id = ? AND deleted_at IS NULL")
        .run(timestamp, timestamp, request.params.id);
      db.prepare("UPDATE trips SET deleted_at = ?, updated_at = ? WHERE care_entry_id = ? AND deleted_at IS NULL")
        .run(timestamp, timestamp, request.params.id);
      db.prepare("UPDATE costs SET deleted_at = ?, updated_at = ? WHERE care_entry_id = ? AND deleted_at IS NULL")
        .run(timestamp, timestamp, request.params.id);
      recordAudit({
        userEmail: request.userEmail,
        entityType: "care_entry",
        entityId: request.params.id,
        action: "deleted",
        oldValue: existing
      });
    })();
    return reply.code(204).send();
  });
}
