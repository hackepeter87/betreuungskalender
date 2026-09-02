import type { FastifyInstance } from "fastify";
import type {
  ApiCareConflictList,
  ApiCareConflictPreview,
  ApiCareConflictResolutionInput,
  ApiCareEntry,
  ApiCost,
  ApiScheduleEntry,
  ApiTrip
} from "../../shared/api.js";
import type { RequestUser } from "../auth.js";
import { config } from "../config.js";
import { sql } from "kysely";
import type { DatabaseExecutor } from "../db/runtime.js";
import {
  assertCanUsePersistedCareParty,
  assertPersistedCareParty,
  assertPersistedChildren,
  assignedPersistedCarePartyIds,
  getPersistedDefaultResponsiblePartyId,
  markDomainClosedMonthsChanged,
  recordDomainAudit,
  recordDomainFieldChanges,
  syncPersistedChildJunction
} from "../services/domainPersistence.js";
import {
  assertNoActualCareConflict,
  assertPlannedCareConflictAcknowledged,
  isCareConflictWorkLimitError,
  isCareEntryConflictError,
  isPlannedCareConflictPreviewRequiredError,
  previewPlannedCareConflicts,
  listCareConflicts
} from "../services/careConflicts.js";
import { bool, makeId, nowIso } from "../services/common.js";
import { careEntryInputSchema, schedulerCareEntryInputSchema } from "../validation/schemas.js";

const readLimit = {
  config: { permission: "notes:view" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const createLimit = {
  config: { permission: "appointments:create" as const, rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};
const editLimit = {
  config: { permission: "appointments:edit" as const, rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};
const deleteLimit = {
  config: { permission: "appointments:delete" as const, rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};
const scheduleLimit = {
  config: { permission: "appointments:view" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};

const scheduleLocations = new Set([
  "commuterApartment",
  "mainResidence",
  "mother",
  "school",
  "ogs"
]);

function scheduleLocation(value: string | null): string | undefined {
  return value && scheduleLocations.has(value) ? value : undefined;
}

async function scheduleConflictEntryIds(database: DatabaseExecutor): Promise<Set<string>> {
  try {
    return new Set((await listCareConflicts(database)).flatMap((conflict) => conflict.entryIds));
  } catch (error) {
    if (isCareConflictWorkLimitError(error)) return new Set();
    throw error;
  }
}

interface EntryRow {
  id: string;
  generated_by_pattern_id: string | null;
  rule_occurrence_date: string | null;
  contact_rule_id: string | null;
  contact_rule_segment_id: string | null;
  contact_rule_occurrence_key: string | null;
  responsible_party_id: string | null;
  actual_responsible_party_id: string | null;
  contact_rule_sync_state: "generated" | "manual_override" | null;
  start_datetime: string;
  end_datetime: string;
  planned_start_datetime: string | null;
  planned_end_datetime: string | null;
  actual_start_datetime: string | null;
  actual_end_datetime: string | null;
  status: ApiCareEntry["status"];
  deviation_type: ApiCareEntry["deviationType"] | null;
  deviation_note: string | null;
  confirmation_note: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  care_scope: ApiCareEntry["careScope"];
  cancellation_reason: string | null;
  overnight: number;
  school_handover: number;
  holiday: number;
  weekend: number;
  additional_care: number;
  location: string | null;
  custom_location: string | null;
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
  created_by: string;
  updated_by: string;
}

interface CostRow {
  id: string;
  category: string;
  amount: number;
  paid_by: string;
  notes: string | null;
  created_by: string;
  updated_by: string;
}

function optional<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

async function childIds(database: DatabaseExecutor, table: "care_entry_children" | "care_entry_actual_children", entryId: string): Promise<string[]> {
  const rows = await database.selectFrom(table)
    .select("child_id")
    .where("care_entry_id", "=", entryId)
    .where("deleted_at", "is", null)
    .orderBy("child_id")
    .execute();
  return rows.map((row) => row.child_id);
}

async function getTrips(database: DatabaseExecutor, entryId: string): Promise<ApiTrip[]> {
  const rows = await database.selectFrom("trips")
    .select(["id", "purpose", "km", "own_car", "reimbursed", "reimbursement_amount", "notes", "created_by", "updated_by"])
    .where("care_entry_id", "=", entryId)
    .where("deleted_at", "is", null)
    .orderBy("created_at")
    .orderBy("id")
    .execute() as TripRow[];
  return rows.map((row) => ({
    id: row.id,
    purpose: row.purpose,
    km: row.km,
    ownCar: bool(row.own_car),
    reimbursed: bool(row.reimbursed),
    reimbursementAmount: optional(row.reimbursement_amount),
    notes: optional(row.notes),
    createdBy: row.created_by,
    updatedBy: row.updated_by
  }));
}

async function getCosts(database: DatabaseExecutor, entryId: string): Promise<ApiCost[]> {
  const rows = await database.selectFrom("costs")
    .select(["id", "category", "amount", "paid_by", "notes", "created_by", "updated_by"])
    .where("care_entry_id", "=", entryId)
    .where("deleted_at", "is", null)
    .orderBy("created_at")
    .orderBy("id")
    .execute() as CostRow[];
  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    amount: row.amount,
    paidBy: row.paid_by,
    notes: optional(row.notes),
    createdBy: row.created_by,
    updatedBy: row.updated_by
  }));
}

async function mapEntry(database: DatabaseExecutor, row: EntryRow): Promise<ApiCareEntry> {
  const [plannedChildren, actualChildren, trips, costs] = await Promise.all([
    childIds(database, "care_entry_children", row.id),
    childIds(database, "care_entry_actual_children", row.id),
    getTrips(database, row.id),
    getCosts(database, row.id)
  ]);
  return {
    id: row.id,
    generatedByPatternId: optional(row.generated_by_pattern_id),
    ruleOccurrenceDate: optional(row.rule_occurrence_date),
    contactRuleId: optional(row.contact_rule_id),
    contactRuleSegmentId: optional(row.contact_rule_segment_id),
    contactRuleOccurrenceKey: optional(row.contact_rule_occurrence_key),
    responsiblePartyId: optional(row.responsible_party_id),
    actualResponsiblePartyId: optional(row.actual_responsible_party_id),
    contactRuleSyncState: optional(row.contact_rule_sync_state),
    startDateTime: row.start_datetime,
    endDateTime: row.end_datetime,
    plannedStartDateTime: optional(row.planned_start_datetime),
    plannedEndDateTime: optional(row.planned_end_datetime),
    actualStartDateTime: optional(row.actual_start_datetime),
    actualEndDateTime: optional(row.actual_end_datetime),
    childIds: plannedChildren,
    actualChildIds: actualChildren,
    status: row.status,
    deviationType: optional(row.deviation_type),
    deviationNote: optional(row.deviation_note),
    confirmationState: row.status === "planned" && !row.confirmed_at && Date.parse(row.end_datetime) < Date.now()
      ? "unconfirmed"
      : row.confirmed_at
        ? "confirmed"
        : undefined,
    confirmedAt: optional(row.confirmed_at),
    confirmedBy: optional(row.confirmed_by),
    confirmationNote: optional(row.confirmation_note),
    careScope: row.care_scope,
    cancellationReason: optional(row.cancellation_reason),
    overnight: bool(row.overnight),
    schoolHandover: bool(row.school_handover),
    holiday: bool(row.holiday),
    weekend: bool(row.weekend),
    additionalCare: bool(row.additional_care),
    location: optional(row.location),
    customLocation: optional(row.custom_location),
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
    trips,
    costs
  };
}

async function getEntry(database: DatabaseExecutor, id: string): Promise<ApiCareEntry | undefined> {
  const row = await database.selectFrom("care_entries")
    .selectAll()
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .executeTakeFirst() as EntryRow | undefined;
  return row ? mapEntry(database, row) : undefined;
}

async function getScheduleEntry(database: DatabaseExecutor, id: string): Promise<ApiScheduleEntry | undefined> {
  const row = await database.selectFrom("care_entries as entries")
    .leftJoin("care_parties as parties", (join) => join
      .onRef("parties.id", "=", "entries.responsible_party_id")
      .on("parties.deleted_at", "is", null))
    .select([
      "entries.id as id",
      "entries.start_datetime as startDateTime",
      "entries.end_datetime as endDateTime",
      "entries.status as status",
      "entries.location as location",
      "entries.responsible_party_id as responsiblePartyId",
      "parties.name as responsiblePartyName"
    ])
    .where("entries.id", "=", id)
    .where("entries.deleted_at", "is", null)
    .executeTakeFirst() as {
    id: string;
    startDateTime: string;
    endDateTime: string;
    status: ApiCareEntry["status"];
    location: string | null;
    responsiblePartyId: string | null;
    responsiblePartyName: string | null;
  } | undefined;
  if (!row) return undefined;
  const children = await database.selectFrom("care_entry_children as links")
    .innerJoin("children", (join) => join
      .onRef("children.id", "=", "links.child_id")
      .on("children.deleted_at", "is", null))
    .select(["children.id", "children.name", "children.color"])
    .where("links.care_entry_id", "=", id)
    .where("links.deleted_at", "is", null)
    .orderBy(sql`lower(children.name)`)
    .execute() as ApiScheduleEntry["children"];
  const hasConflict = (await scheduleConflictEntryIds(database)).has(id);
  const location = scheduleLocation(row.location);
  return {
    id: row.id,
    children,
    startDateTime: row.startDateTime,
    endDateTime: row.endDateTime,
    status: row.status,
    ...(row.responsiblePartyId && row.responsiblePartyName
      ? { responsibleParty: { id: row.responsiblePartyId, name: row.responsiblePartyName } }
      : {}),
    ...(location ? { location } : {}),
    hasConflict
  };
}

async function schedulerWriteAllowed(
  database: DatabaseExecutor,
  user: RequestUser | undefined,
  responsiblePartyId: string,
  submittedStartDateTime: string,
  existing?: ApiCareEntry
): Promise<boolean> {
  if (user?.workspaceRole !== "scheduler") return true;
  const assigned = new Set(await assignedPersistedCarePartyIds(database, user.id));
  if (!assigned.has(responsiblePartyId)) return false;
  if (existing?.responsiblePartyId && !assigned.has(existing.responsiblePartyId)) return false;
  if (Date.parse(submittedStartDateTime) <= Date.now()) return false;
  if (existing && (existing.status !== "planned" || Date.parse(existing.startDateTime) <= Date.now())) return false;
  return true;
}

function schedulingInput(
  input: ReturnType<typeof schedulerCareEntryInputSchema.parse>,
  existing?: ApiCareEntry
): ReturnType<typeof careEntryInputSchema.parse> {
  const durationMinutes = (Date.parse(input.endDateTime) - Date.parse(input.startDateTime)) / 60_000;
  return careEntryInputSchema.parse({
    startDateTime: input.startDateTime,
    endDateTime: input.endDateTime,
    childIds: input.childIds,
    responsiblePartyId: input.responsiblePartyId,
    status: "planned",
    careScope: existing?.careScope ?? (durationMinutes >= 12 * 60 ? "full_day" : durationMinutes >= 5 * 60 ? "half_day" : "hourly"),
    generatedByPatternId: existing?.generatedByPatternId,
    ruleOccurrenceDate: existing?.ruleOccurrenceDate,
    contactRuleId: existing?.contactRuleId,
    contactRuleSegmentId: existing?.contactRuleSegmentId,
    contactRuleOccurrenceKey: existing?.contactRuleOccurrenceKey,
    contactRuleSyncState: existing?.contactRuleSyncState,
    plannedStartDateTime: existing?.plannedStartDateTime,
    plannedEndDateTime: existing?.plannedEndDateTime,
    deviationType: existing?.deviationType,
    deviationNote: existing?.deviationNote,
    overnight: existing?.overnight ?? false,
    schoolHandover: existing?.schoolHandover ?? false,
    holiday: existing?.holiday ?? false,
    weekend: existing?.weekend ?? [input.startDateTime, input.endDateTime].some((value) => {
      const day = new Date(value).getDay();
      return day === 0 || day === 6;
    }),
    additionalCare: existing?.additionalCare ?? false,
    location: input.location ?? existing?.location,
    customLocation: input.location ? undefined : existing?.customLocation,
    handoverFrom: existing?.handoverFrom,
    handoverTo: existing?.handoverTo,
    notes: existing?.notes,
    evidenceReference: existing?.evidenceReference,
    hasEvidence: existing?.hasEvidence ?? false,
    trips: existing?.trips ?? [],
    costs: existing?.costs ?? []
  });
}

function schedulerForbidden(reply: { code(status: number): { send(payload: unknown): unknown } }) {
  return reply.code(403).send({
    error: "forbidden",
    message: "Für diese Aktion fehlt die erforderliche Berechtigung."
  });
}

async function syncTrips(
  database: DatabaseExecutor,
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
): Promise<void> {
  const existing = new Map((await getTrips(database, entryId)).map((trip) => [trip.id, trip]));
  const retained = new Set<string>();

  for (const trip of trips) {
    const id = trip.id && existing.has(trip.id) ? trip.id : makeId("trip");
    const before = existing.get(id);
    retained.add(id);
    if (before) {
      await database.updateTable("trips").set({
        purpose: trip.purpose,
        km: trip.km,
        own_car: Number(trip.ownCar),
        reimbursed: Number(trip.reimbursed),
        reimbursement_amount: trip.reimbursementAmount ?? null,
        notes: trip.notes ?? null,
        updated_by: userEmail,
        updated_at: timestamp,
        deleted_at: null
      }).where("id", "=", id).where("care_entry_id", "=", entryId).execute();
      await recordDomainFieldChanges(
        database,
        userEmail,
        "trip",
        id,
        before,
        { ...trip, id, createdBy: before.createdBy, updatedBy: userEmail },
        ["createdBy", "updatedBy"]
      );
    } else {
      await database.insertInto("trips").values({
        id,
        care_entry_id: entryId,
        purpose: trip.purpose,
        km: trip.km,
        own_car: Number(trip.ownCar),
        reimbursed: Number(trip.reimbursed),
        reimbursement_amount: trip.reimbursementAmount ?? null,
        notes: trip.notes ?? null,
        created_by: userEmail,
        updated_by: userEmail,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null
      }).execute();
      await recordDomainAudit(database, {
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
    await database.updateTable("trips")
      .set({ deleted_at: timestamp, updated_by: userEmail, updated_at: timestamp })
      .where("id", "=", id).execute();
    await recordDomainAudit(database, {
      userEmail,
      entityType: "trip",
      entityId: id,
      action: "deleted",
      oldValue: trip,
      metadata: { careEntryId: entryId }
    });
  }
}

async function syncCosts(
  database: DatabaseExecutor,
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
): Promise<void> {
  const existing = new Map((await getCosts(database, entryId)).map((cost) => [cost.id, cost]));
  const retained = new Set<string>();

  for (const cost of costs) {
    const id = cost.id && existing.has(cost.id) ? cost.id : makeId("cost");
    const before = existing.get(id);
    retained.add(id);
    if (before) {
      await database.updateTable("costs").set({
        category: cost.category,
        amount: cost.amount,
        paid_by: cost.paidBy,
        notes: cost.notes ?? null,
        updated_by: userEmail,
        updated_at: timestamp,
        deleted_at: null
      }).where("id", "=", id).where("care_entry_id", "=", entryId).execute();
      await recordDomainFieldChanges(
        database,
        userEmail,
        "cost",
        id,
        before,
        { ...cost, id, createdBy: before.createdBy, updatedBy: userEmail },
        ["createdBy", "updatedBy"]
      );
    } else {
      await database.insertInto("costs").values({
        id,
        care_entry_id: entryId,
        category: cost.category,
        amount: cost.amount,
        paid_by: cost.paidBy,
        notes: cost.notes ?? null,
        created_by: userEmail,
        updated_by: userEmail,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null
      }).execute();
      await recordDomainAudit(database, {
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
    await database.updateTable("costs")
      .set({ deleted_at: timestamp, updated_by: userEmail, updated_at: timestamp })
      .where("id", "=", id).execute();
    await recordDomainAudit(database, {
      userEmail,
      entityType: "cost",
      entityId: id,
      action: "deleted",
      oldValue: cost,
      metadata: { careEntryId: entryId }
    });
  }
}

async function persistEntry(
  database: DatabaseExecutor,
  id: string,
  input: ReturnType<typeof careEntryInputSchema.parse>,
  userEmail: string,
  existing?: ApiCareEntry,
  user?: RequestUser
): Promise<ApiCareEntry> {
  if (existing) {
    await assertCanUsePersistedCareParty(database, user, existing.responsiblePartyId);
    if (existing.actualResponsiblePartyId) await assertCanUsePersistedCareParty(database, user, existing.actualResponsiblePartyId);
  }
  const effectiveResponsiblePartyId =
    input.responsiblePartyId ?? existing?.responsiblePartyId ?? await getPersistedDefaultResponsiblePartyId(database);
  await assertPersistedChildren(database, input.childIds);
  await assertPersistedCareParty(database, effectiveResponsiblePartyId);
  await assertCanUsePersistedCareParty(database, user, effectiveResponsiblePartyId);
  const timestamp = nowIso();
  const durationMinutes = Math.round(
    (Date.parse(input.endDateTime) - Date.parse(input.startDateTime)) / 60000
  );
  const isContactTime = durationMinutes < 120;
  const actualChildIds = input.status === "partial"
    ? [...new Set(input.actualChildIds ?? existing?.actualChildIds ?? input.childIds)]
    : [];
  const actualResponsiblePartyId = input.status === "partial"
    ? input.actualResponsiblePartyId ?? existing?.actualResponsiblePartyId ?? effectiveResponsiblePartyId
    : undefined;
  if (input.status === "partial") {
    await assertPersistedChildren(database, actualChildIds);
    await assertPersistedCareParty(database, actualResponsiblePartyId);
    await assertCanUsePersistedCareParty(database, user, actualResponsiblePartyId);
  }
  await assertPlannedCareConflictAcknowledged({
    candidate: {
      status: input.status,
      startDateTime: input.startDateTime,
      endDateTime: input.endDateTime,
      childIds: input.childIds,
      actualStartDateTime: input.actualStartDateTime,
      actualEndDateTime: input.actualEndDateTime,
      actualChildIds
    },
    confirmPlannedConflict: input.confirmPlannedConflict,
    conflictFingerprint: input.conflictFingerprint,
    database,
    excludeId: existing?.id
  });
  await assertNoActualCareConflict({
    id,
    status: input.status,
    startDateTime: input.startDateTime,
    endDateTime: input.endDateTime,
    childIds: input.childIds,
    actualStartDateTime: input.status === "partial"
      ? input.actualStartDateTime ?? existing?.actualStartDateTime ?? input.startDateTime
      : undefined,
    actualEndDateTime: input.status === "partial"
      ? input.actualEndDateTime ?? existing?.actualEndDateTime ?? input.endDateTime
      : undefined,
    actualChildIds
  }, database);

  if (existing) {
    const generatedByPatternId = input.generatedByPatternId ?? existing.generatedByPatternId ?? null;
    const ruleOccurrenceDate = input.ruleOccurrenceDate ?? existing.ruleOccurrenceDate ?? null;
    const contactRuleId = input.contactRuleId ?? existing.contactRuleId ?? null;
    const contactRuleSegmentId = input.contactRuleSegmentId ?? existing.contactRuleSegmentId ?? null;
    const contactRuleOccurrenceKey = input.contactRuleOccurrenceKey ?? existing.contactRuleOccurrenceKey ?? null;
    const responsiblePartyId = effectiveResponsiblePartyId ?? null;
    const contactRuleSyncState = contactRuleId ? "manual_override" : input.contactRuleSyncState ?? null;
    const deviationType = input.deviationType ?? (input.status === "cancelled" ? "cancelled" : input.status === "partial" ? "partial" : null);
    const plannedStartDateTime = deviationType
      ? input.plannedStartDateTime ?? existing.plannedStartDateTime ?? existing.startDateTime
      : null;
    const plannedEndDateTime = deviationType
      ? input.plannedEndDateTime ?? existing.plannedEndDateTime ?? existing.endDateTime
      : null;
    await database.updateTable("care_entries").set({
      generated_by_pattern_id: generatedByPatternId,
      rule_occurrence_date: ruleOccurrenceDate,
      contact_rule_id: contactRuleId,
      contact_rule_segment_id: contactRuleSegmentId,
      contact_rule_occurrence_key: contactRuleOccurrenceKey,
      responsible_party_id: responsiblePartyId,
      contact_rule_sync_state: contactRuleSyncState,
      start_datetime: input.startDateTime,
      end_datetime: input.endDateTime,
      planned_start_datetime: plannedStartDateTime,
      planned_end_datetime: plannedEndDateTime,
      status: input.status,
      deviation_type: deviationType,
      deviation_note: input.deviationNote?.trim() || null,
      care_scope: input.careScope,
      cancellation_reason: input.status === "cancelled" ? input.cancellationReason ?? null : null,
      confirmation_note: input.status === "planned" ? null : existing.confirmationNote ?? null,
      confirmed_at: input.status === "planned" ? null : existing.confirmedAt ?? null,
      confirmed_by: input.status === "planned" ? null : existing.confirmedBy ?? null,
      actual_start_datetime: input.status === "partial" ? input.actualStartDateTime ?? existing.actualStartDateTime ?? input.startDateTime : null,
      actual_end_datetime: input.status === "partial" ? input.actualEndDateTime ?? existing.actualEndDateTime ?? input.endDateTime : null,
      actual_responsible_party_id: actualResponsiblePartyId ?? null,
      overnight: Number(input.overnight),
      school_handover: Number(input.schoolHandover),
      holiday: Number(input.holiday),
      weekend: Number(input.weekend),
      additional_care: Number(input.additionalCare),
      location: input.location ?? null,
      custom_location: input.customLocation ?? null,
      handover_from: input.handoverFrom ?? null,
      handover_to: input.handoverTo ?? null,
      notes: input.notes ?? null,
      evidence_reference: input.evidenceReference ?? null,
      has_evidence: Number(input.hasEvidence),
      duration_minutes: durationMinutes,
      is_contact_time: Number(isContactTime),
      updated_by: userEmail,
      updated_at: timestamp,
      deleted_at: null
    }).where("id", "=", id).execute();
  } else {
    await database.insertInto("care_entries").values({
      id,
      generated_by_pattern_id: input.generatedByPatternId ?? null,
      rule_occurrence_date: input.ruleOccurrenceDate ?? null,
      contact_rule_id: input.contactRuleId ?? null,
      contact_rule_segment_id: input.contactRuleSegmentId ?? null,
      contact_rule_occurrence_key: input.contactRuleOccurrenceKey ?? null,
      responsible_party_id: effectiveResponsiblePartyId ?? null,
      contact_rule_sync_state: input.contactRuleSyncState ?? null,
      start_datetime: input.startDateTime,
      end_datetime: input.endDateTime,
      planned_start_datetime: input.deviationType ? input.plannedStartDateTime ?? input.startDateTime : null,
      planned_end_datetime: input.deviationType ? input.plannedEndDateTime ?? input.endDateTime : null,
      status: input.status,
      deviation_type: input.deviationType ?? (input.status === "cancelled" ? "cancelled" : input.status === "partial" ? "partial" : null),
      deviation_note: input.deviationNote?.trim() || null,
      care_scope: input.careScope,
      cancellation_reason: input.status === "cancelled" ? input.cancellationReason ?? null : null,
      confirmation_note: null,
      confirmed_at: null,
      confirmed_by: null,
      actual_start_datetime: input.status === "partial" ? input.actualStartDateTime ?? input.startDateTime : null,
      actual_end_datetime: input.status === "partial" ? input.actualEndDateTime ?? input.endDateTime : null,
      actual_responsible_party_id: actualResponsiblePartyId ?? null,
      overnight: Number(input.overnight),
      school_handover: Number(input.schoolHandover),
      holiday: Number(input.holiday),
      weekend: Number(input.weekend),
      additional_care: Number(input.additionalCare),
      location: input.location ?? null,
      custom_location: input.customLocation ?? null,
      handover_from: input.handoverFrom ?? null,
      handover_to: input.handoverTo ?? null,
      notes: input.notes ?? null,
      evidence_reference: input.evidenceReference ?? null,
      has_evidence: Number(input.hasEvidence),
      duration_minutes: durationMinutes,
      is_contact_time: Number(isContactTime),
      created_by: userEmail,
      updated_by: userEmail,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null
    }).execute();
  }

  await syncPersistedChildJunction(database, { table: "care_entry_children", owner: "care_entry_id" }, id, input.childIds, timestamp);
  await syncPersistedChildJunction(database, { table: "care_entry_actual_children", owner: "care_entry_id" }, id, input.status === "partial" ? actualChildIds : [], timestamp);
  await syncTrips(database, id, input.trips, userEmail, timestamp);
  await syncCosts(database, id, input.costs, userEmail, timestamp);

  const after = await getEntry(database, id);
  if (!after) throw new Error("Betreuungseintrag konnte nicht geladen werden.");
  if (existing) {
    await recordDomainFieldChanges(database, userEmail, "care_entry", id, existing, after, [
      "updatedAt", "updatedBy", "trips", "costs"
    ]);
  } else {
    await recordDomainAudit(database, {
      userEmail,
      entityType: "care_entry",
      entityId: id,
      action: "created",
      newValue: after
    });
  }
  const dates = [
    input.startDateTime.slice(0, 10),
    input.endDateTime.slice(0, 10),
    existing?.startDateTime.slice(0, 10),
    existing?.endDateTime.slice(0, 10)
  ].filter((value): value is string => Boolean(value)).sort();
  await markDomainClosedMonthsChanged(
    database,
    userEmail,
    "care_entry",
    id,
    dates[0] ?? input.startDateTime.slice(0, 10),
    dates.at(-1) ?? input.endDateTime.slice(0, 10),
    timestamp
  );
  return after;
}

export async function careEntryRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Querystring: { entryId?: string } }>(
    "/api/care-conflicts/preview",
    createLimit,
    async (request, reply): Promise<ApiCareConflictPreview | unknown> => {
      const parsed = careEntryInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
      const input = parsed.data;
      const preview = await previewPlannedCareConflicts({
        status: input.status,
        startDateTime: input.startDateTime,
        endDateTime: input.endDateTime,
        childIds: input.childIds
      }, app.persistence.query, request.query.entryId);
      const items = (await Promise.all(preview.conflicts.map(async (conflict) => {
        const conflictingId = conflict.entryIds.find((id) => id !== "__care_conflict_candidate__");
        const entry = conflictingId ? await getEntry(app.persistence.query, conflictingId) : undefined;
        return entry ? [{ conflict, entry }] : [];
      }))).flat();
      return { fingerprint: preview.fingerprint, items };
    }
  );

  app.post(
    "/api/care-conflicts/resolve",
    editLimit,
    async (request, reply) => {
      const input = request.body as Partial<ApiCareConflictResolutionInput> | null;
      if (
        !input || input.action !== "replace_rule_occurrence" ||
        typeof input.conflictId !== "string" || typeof input.entryId !== "string"
      ) {
        return reply.code(400).send({ error: "validation_error" });
      }
      try {
        return await app.persistence.transaction(async (database) => {
          const conflict = (await listCareConflicts(database)).find((item) =>
            item.id === input.conflictId && item.entryIds.includes(input.entryId!)
          );
          const existing = await getEntry(database, input.entryId!);
          if (!conflict || !existing || !existing.contactRuleId || existing.status !== "planned") {
            return reply.code(409).send({ error: "care_conflict_changed" });
          }
          await assertCanUsePersistedCareParty(database, request.user, existing.responsiblePartyId);
          const timestamp = nowIso();
          await database.updateTable("care_entries").set((expression) => ({
            status: "cancelled",
            deviation_type: "cancelled",
            cancellation_reason: "Regeltermin wegen Überschneidung ersetzt.",
            planned_start_datetime: expression.fn.coalesce("planned_start_datetime", "start_datetime"),
            planned_end_datetime: expression.fn.coalesce("planned_end_datetime", "end_datetime"),
            contact_rule_sync_state: "manual_override",
            updated_by: request.userEmail,
            updated_at: timestamp
          })).where("id", "=", input.entryId!).where("deleted_at", "is", null).execute();
          const updated = await getEntry(database, input.entryId!);
          if (!updated) throw new Error("Resolved care entry could not be loaded.");
          await recordDomainFieldChanges(database, request.userEmail, "care_entry", input.entryId!, existing, updated, [
            "updatedAt", "updatedBy", "trips", "costs"
          ]);
          await markDomainClosedMonthsChanged(
            database,
            request.userEmail,
            "care_entry",
            input.entryId!,
            existing.startDateTime.slice(0, 10),
            existing.endDateTime.slice(0, 10),
            timestamp
          );
          return updated;
        });
      } catch (error) {
        if (isCareConflictWorkLimitError(error)) {
          return reply.code(409).send({ error: "care_conflict_changed" });
        }
        throw error;
      }
    }
  );

  app.get<{ Querystring: { startDate?: string; endDate?: string } }>(
    "/api/care-entries/schedule",
    scheduleLimit,
    async (request): Promise<ApiScheduleEntry[]> => {
      let query = app.persistence.query.selectFrom("care_entries as entries")
        .leftJoin("care_parties as parties", (join) => join
          .onRef("parties.id", "=", "entries.responsible_party_id")
          .on("parties.deleted_at", "is", null))
        .select([
          "entries.id as id",
          "entries.start_datetime as startDateTime",
          "entries.end_datetime as endDateTime",
          "entries.status as status",
          "entries.location as location",
          "entries.responsible_party_id as responsiblePartyId",
          "parties.name as responsiblePartyName"
        ])
        .where("entries.deleted_at", "is", null);
      if (request.query.startDate) {
        query = query.where("entries.end_datetime", ">=", `${request.query.startDate}T00:00:00.000Z`);
      }
      if (request.query.endDate) {
        query = query.where("entries.start_datetime", "<=", `${request.query.endDate}T23:59:59.999Z`);
      }
      const [conflicts, rows] = await Promise.all([
        scheduleConflictEntryIds(app.persistence.query),
        query.orderBy("entries.start_datetime").orderBy("entries.id").execute()
      ]) as [Set<string>, Array<{
        id: string;
        startDateTime: string;
        endDateTime: string;
        status: ApiCareEntry["status"];
        location: string | null;
        responsiblePartyId: string | null;
        responsiblePartyName: string | null;
      }>];
      return Promise.all(rows.map(async (row) => {
        const location = scheduleLocation(row.location);
        const children = await app.persistence.query.selectFrom("care_entry_children as links")
          .innerJoin("children", (join) => join
            .onRef("children.id", "=", "links.child_id")
            .on("children.deleted_at", "is", null))
          .select(["children.id", "children.name", "children.color"])
          .where("links.care_entry_id", "=", row.id)
          .where("links.deleted_at", "is", null)
          .orderBy(sql`lower(children.name)`)
          .execute() as ApiScheduleEntry["children"];
        return ({
        id: row.id,
        children,
        startDateTime: row.startDateTime,
        endDateTime: row.endDateTime,
        status: row.status,
        ...(row.responsiblePartyId && row.responsiblePartyName
          ? { responsibleParty: { id: row.responsiblePartyId, name: row.responsiblePartyName } }
          : {}),
        ...(location ? { location } : {}),
        hasConflict: conflicts.has(row.id)
        });
      }));
    }
  );

  app.get("/api/care-conflicts", readLimit, async (): Promise<ApiCareConflictList> => {
    try {
      return { items: await listCareConflicts(app.persistence.query), complete: true };
    } catch (error) {
      if (isCareConflictWorkLimitError(error)) {
        return { items: [], complete: false };
      }
      throw error;
    }
  });

  app.get<{ Querystring: { startDate?: string; endDate?: string } }>(
    "/api/care-entries",
    readLimit,
    async (request) => {
      let query = app.persistence.query.selectFrom("care_entries")
        .selectAll()
        .where("deleted_at", "is", null);
      if (request.query.startDate) {
        query = query.where("end_datetime", ">=", `${request.query.startDate}T00:00:00.000Z`);
      }
      if (request.query.endDate) {
        query = query.where("start_datetime", "<=", `${request.query.endDate}T23:59:59.999Z`);
      }
      const rows = await query.orderBy("start_datetime").orderBy("id").execute() as EntryRow[];
      return Promise.all(rows.map((row) => mapEntry(app.persistence.query, row)));
    }
  );

  app.get<{ Params: { id: string } }>("/api/care-entries/:id", readLimit, async (request, reply) => {
    const entry = await getEntry(app.persistence.query, request.params.id);
    return entry ?? reply.code(404).send({ error: "not_found" });
  });

  app.post("/api/care-entries", createLimit, async (request, reply) => {
    const scheduler = request.user?.workspaceRole === "scheduler";
    const parsed = scheduler
      ? schedulerCareEntryInputSchema.safeParse(request.body)
      : careEntryInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const input = scheduler
      ? schedulingInput(parsed.data as ReturnType<typeof schedulerCareEntryInputSchema.parse>)
      : parsed.data as ReturnType<typeof careEntryInputSchema.parse>;
    if (!(await schedulerWriteAllowed(app.persistence.query, request.user, input.responsiblePartyId ?? "", input.startDateTime))) return schedulerForbidden(reply);
    const id = makeId("entry");
    try {
      const created = await app.persistence.transaction((database) =>
        persistEntry(database, id, input, request.userEmail, undefined, request.user)
      );
      return reply.code(201).send(scheduler
        ? await getScheduleEntry(app.persistence.query, id)
        : created);
    } catch (error) {
      if (isPlannedCareConflictPreviewRequiredError(error)) {
        return reply.code(409).send({
          error: "planned_care_conflict_confirmation_required",
          fingerprint: error.fingerprint
        });
      }
      if (isCareEntryConflictError(error)) {
        return reply.code(409).send({ error: "care_entry_conflict" });
      }
      return reply.code(400).send({ error: "invalid_relation", message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put<{ Params: { id: string } }>("/api/care-entries/:id", editLimit, async (request, reply) => {
    const existing = await getEntry(app.persistence.query, request.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    const scheduler = request.user?.workspaceRole === "scheduler";
    const parsed = scheduler
      ? schedulerCareEntryInputSchema.safeParse(request.body)
      : careEntryInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const input = scheduler
      ? schedulingInput(parsed.data as ReturnType<typeof schedulerCareEntryInputSchema.parse>, existing)
      : parsed.data as ReturnType<typeof careEntryInputSchema.parse>;
    if (!(await schedulerWriteAllowed(app.persistence.query, request.user, input.responsiblePartyId ?? "", input.startDateTime, existing))) return schedulerForbidden(reply);
    try {
      const updated = await app.persistence.transaction((database) =>
        persistEntry(database, request.params.id, input, request.userEmail, existing, request.user)
      );
      return scheduler
        ? await getScheduleEntry(app.persistence.query, request.params.id)
        : updated;
    } catch (error) {
      if (isPlannedCareConflictPreviewRequiredError(error)) {
        return reply.code(409).send({
          error: "planned_care_conflict_confirmation_required",
          fingerprint: error.fingerprint
        });
      }
      if (isCareEntryConflictError(error)) {
        return reply.code(409).send({ error: "care_entry_conflict" });
      }
      return reply.code(400).send({ error: "invalid_relation", message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/care-entries/:id", deleteLimit, async (request, reply) => {
    const existing = await getEntry(app.persistence.query, request.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    try {
      await assertCanUsePersistedCareParty(app.persistence.query, request.user, existing.responsiblePartyId);
      if (existing.actualResponsiblePartyId) await assertCanUsePersistedCareParty(app.persistence.query, request.user, existing.actualResponsiblePartyId);
    } catch (error) {
      return reply.code(400).send({ error: "invalid_relation", message: error instanceof Error ? error.message : String(error) });
    }
    const timestamp = nowIso();
    await app.persistence.transaction(async (database) => {
      await database.updateTable("care_entries")
        .set({ deleted_at: timestamp, updated_at: timestamp, updated_by: request.userEmail })
        .where("id", "=", request.params.id).execute();
      await database.updateTable("care_entry_children")
        .set({ deleted_at: timestamp, updated_at: timestamp })
        .where("care_entry_id", "=", request.params.id).where("deleted_at", "is", null).execute();
      await database.updateTable("care_entry_actual_children")
        .set({ deleted_at: timestamp, updated_at: timestamp })
        .where("care_entry_id", "=", request.params.id).where("deleted_at", "is", null).execute();
      await database.updateTable("trips")
        .set({ deleted_at: timestamp, updated_by: request.userEmail, updated_at: timestamp })
        .where("care_entry_id", "=", request.params.id).where("deleted_at", "is", null).execute();
      await database.updateTable("costs")
        .set({ deleted_at: timestamp, updated_by: request.userEmail, updated_at: timestamp })
        .where("care_entry_id", "=", request.params.id).where("deleted_at", "is", null).execute();
      await recordDomainAudit(database, {
        userEmail: request.userEmail,
        entityType: "care_entry",
        entityId: request.params.id,
        action: "deleted",
        oldValue: existing
      });
      await markDomainClosedMonthsChanged(
        database,
        request.userEmail,
        "care_entry",
        request.params.id,
        existing.startDateTime.slice(0, 10),
        existing.endDateTime.slice(0, 10),
        timestamp
      );
    });
    return reply.code(204).send();
  });
}
