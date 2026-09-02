import type { FastifyInstance } from "fastify";
import type { DatabaseExecutor } from "../db/runtime.js";
import { nowIso } from "../services/common.js";
import { legacyRecurrenceForPattern, legacySegmentsForPattern } from "../services/contactRules.js";
import {
  getPersistedDefaultResponsiblePartyId,
  recordDomainAudit
} from "../services/domainPersistence.js";
import { normalizeClientSettings } from "../services/settings.js";
import {
  appDataImportSchema,
  carePartyInputSchema,
  careEntryInputSchema,
  childInputSchema,
  contactRuleInputSchema,
  contactPatternInputSchema,
  holidayInputSchema,
  unavailablePeriodInputSchema
} from "../validation/schemas.js";

type DataRecord = Record<string, unknown>;

function text(record: DataRecord, key: string, fallback = ""): string {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function optionalText(record: DataRecord, key: string): string | null {
  const value = text(record, key).trim();
  return value ? value : null;
}

function booleanValue(record: DataRecord, key: string, fallback = false): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function externalCalendarSourceType(record: DataRecord): "overlay" | "holiday" {
  return record.sourceType === "holiday" ? "holiday" : "overlay";
}

function numberValue(record: DataRecord, key: string, fallback = 0): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function records(record: DataRecord, key: string): DataRecord[] {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter(
        (item): item is DataRecord =>
          typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}

function stringArray(record: DataRecord, key: string): string[] {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function importedDefaultResponsiblePartyId(
  data: { settings?: Record<string, unknown> },
  database: DatabaseExecutor
): Promise<string | undefined> {
  const configured = data.settings?.defaultResponsiblePartyId;
  if (typeof configured === "string" && configured.trim()) {
    const active = await database.selectFrom("care_parties")
      .select("id")
      .where("id", "=", configured)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (active) return configured;
  }
  return getPersistedDefaultResponsiblePartyId(database);
}

const careDeviationTypes = new Set([
  "cancelled",
  "partial",
  "rescheduled",
  "swapped",
  "externally_blocked",
  "other"
]);

function optionalDeviationType(record: DataRecord): string | null {
  const value = optionalText(record, "deviationType");
  if (!value) return null;
  if (!careDeviationTypes.has(value)) {
    throw new Error("Unbekannte Abweichungsart im Betreuungseintrag.");
  }
  return value;
}

export async function clearDomainData(database: DatabaseExecutor): Promise<void> {
  const tables = [
    "care_entry_actual_children",
    "care_entry_children",
    "care_confirmation_requests",
    "holiday_period_children",
    "unavailable_period_children",
    "contact_rule_children",
    "contact_pattern_children",
    "trips",
    "costs",
    "care_entries",
    "holiday_periods",
    "contact_rules",
    "contact_patterns",
    "app_user_care_party_assignments",
    "unavailable_periods",
    "care_parties",
    "external_calendar_events",
    "external_calendar_sources",
    "push_subscriptions",
    "notification_preferences",
    "calendar_feed_tokens",
    "monthly_closings",
    "children",
    "audit_log"
  ] as const;
  for (const table of tables) {
    await database.deleteFrom(table).execute();
  }
  await database.deleteFrom("settings")
    .where("key", "!=", "setup.ownerUserId")
    .execute();
}

export async function insertChild(
  record: DataRecord,
  timestamp: string,
  userEmail: string,
  database: DatabaseExecutor
): Promise<void> {
  const input = childInputSchema.parse({
    name: record.name,
    birthMonth: record.birthMonth,
    birthYear: record.birthYear,
    color: record.color
  });
  const id = text(record, "id");
  if (!id) throw new Error("Kind ohne ID kann nicht importiert werden.");
  await database.insertInto("children").values({
    id,
    name: input.name,
    birth_month: input.birthMonth,
    birth_year: input.birthYear,
    color: input.color,
    created_by: text(record, "createdBy", userEmail),
    updated_by: text(record, "updatedBy", userEmail),
    created_at: text(record, "createdAt", timestamp),
    updated_at: text(record, "updatedAt", timestamp),
    deleted_at: null
  }).execute();
}

export async function insertCareParty(
  record: DataRecord,
  timestamp: string,
  userEmail: string,
  database: DatabaseExecutor
): Promise<void> {
  if (record.deletedAt) return;
  const input = carePartyInputSchema.parse({
    name: record.name,
    kind: record.kind
  });
  const id = text(record, "id");
  if (!id) throw new Error("Betreuende Person ohne ID kann nicht importiert werden.");
  await database.insertInto("care_parties").values({
    id,
    name: input.name,
    kind: input.kind,
    created_by: text(record, "createdBy", userEmail),
    updated_by: text(record, "updatedBy", userEmail),
    created_at: text(record, "createdAt", timestamp),
    updated_at: text(record, "updatedAt", timestamp),
    deleted_at: null
  }).execute();
}

function deriveCareScope(record: DataRecord): string {
  const configured = text(record, "careScope").trim();
  if (configured) return configured;
  if (booleanValue(record, "overnight")) return "overnight";
  const durationMinutes =
    (Date.parse(text(record, "endDateTime")) -
      Date.parse(text(record, "startDateTime"))) /
    60000;
  if (durationMinutes >= 12 * 60) return "full_day";
  if (durationMinutes >= 5 * 60) return "half_day";
  return "hourly";
}

export async function insertEntry(
  record: DataRecord,
  timestamp: string,
  userEmail: string,
  fallbackResponsiblePartyId: string | undefined,
  database: DatabaseExecutor
): Promise<void> {
  if (record.deletedAt) return;
  const input = careEntryInputSchema.parse({
    startDateTime: record.startDateTime,
    endDateTime: record.endDateTime,
    childIds: stringArray(record, "childIds"),
    generatedByPatternId: optionalText(record, "generatedByPatternId") ?? undefined,
    ruleOccurrenceDate: optionalText(record, "ruleOccurrenceDate") ?? undefined,
    contactRuleId: optionalText(record, "contactRuleId") ?? undefined,
    contactRuleSegmentId: optionalText(record, "contactRuleSegmentId") ?? undefined,
    contactRuleOccurrenceKey: optionalText(record, "contactRuleOccurrenceKey") ?? undefined,
    responsiblePartyId: optionalText(record, "responsiblePartyId") ?? fallbackResponsiblePartyId,
    contactRuleSyncState: optionalText(record, "contactRuleSyncState") ?? undefined,
    status: record.status,
    careScope: deriveCareScope(record),
    cancellationReason: optionalText(record, "cancellationReason") ?? undefined,
    overnight: booleanValue(record, "overnight"),
    schoolHandover: booleanValue(record, "schoolHandover"),
    holiday: booleanValue(record, "holiday"),
    weekend: booleanValue(record, "weekend"),
    additionalCare: booleanValue(record, "additionalCare"),
    location: optionalText(record, "location") ?? undefined,
    customLocation: optionalText(record, "customLocation") ?? undefined,
    handoverFrom: optionalText(record, "handoverFrom") ?? undefined,
    handoverTo: optionalText(record, "handoverTo") ?? undefined,
    notes: optionalText(record, "notes") ?? undefined,
    evidenceReference: optionalText(record, "evidenceReference") ?? undefined,
    hasEvidence: booleanValue(record, "hasEvidence"),
    trips: records(record, "trips")
      .filter((trip) => !trip.deletedAt)
      .map((trip) => ({
        id: text(trip, "id"),
        purpose: text(trip, "purpose"),
        km: numberValue(trip, "km"),
        ownCar: booleanValue(trip, "ownCar", true),
        reimbursed: booleanValue(trip, "reimbursed"),
        reimbursementAmount:
          trip.reimbursementAmount === undefined
            ? undefined
            : numberValue(trip, "reimbursementAmount"),
        notes: optionalText(trip, "notes") ?? undefined
      })),
    costs: records(record, "costs")
      .filter((cost) => !cost.deletedAt)
      .map((cost) => ({
        id: text(cost, "id"),
        category: text(cost, "category"),
        amount: numberValue(cost, "amount"),
        paidBy: text(cost, "paidBy"),
        notes: optionalText(cost, "notes") ?? undefined
      }))
  });
  const id = text(record, "id");
  if (!id) throw new Error("Betreuungseintrag ohne ID kann nicht importiert werden.");
  const createdAt = text(record, "createdAt", timestamp);
  const updatedAt = text(record, "updatedAt", timestamp);
  const durationMinutes = Math.round(
    (Date.parse(input.endDateTime) - Date.parse(input.startDateTime)) / 60000
  );
  const importedActualChildIds = stringArray(record, "actualChildIds");
  const actualStartDateTime = input.status === "partial"
    ? optionalText(record, "actualStartDateTime") ?? input.startDateTime
    : null;
  const actualEndDateTime = input.status === "partial"
    ? optionalText(record, "actualEndDateTime") ?? input.endDateTime
    : null;
  if (actualStartDateTime && actualEndDateTime && Date.parse(actualEndDateTime) <= Date.parse(actualStartDateTime)) {
    throw new Error("Tatsächliches Ende eines teilweise bestätigten Betreuungseintrags muss nach dem Beginn liegen.");
  }
  const actualResponsiblePartyId = input.status === "partial"
    ? optionalText(record, "actualResponsiblePartyId") ?? input.responsiblePartyId ?? null
    : null;
  const actualChildIds = input.status === "partial"
    ? importedActualChildIds.length ? importedActualChildIds : input.childIds
    : [];
  const deviationType =
    optionalDeviationType(record) ??
    (input.status === "cancelled" ? "cancelled" : input.status === "partial" ? "partial" : null);
  const plannedStartDateTime = deviationType
    ? optionalText(record, "plannedStartDateTime") ?? input.startDateTime
    : null;
  const plannedEndDateTime = deviationType
    ? optionalText(record, "plannedEndDateTime") ?? input.endDateTime
    : null;
  if (plannedStartDateTime && plannedEndDateTime && Date.parse(plannedEndDateTime) <= Date.parse(plannedStartDateTime)) {
    throw new Error("Ursprüngliches Soll-Ende eines abweichenden Betreuungseintrags muss nach dem Beginn liegen.");
  }
  await database.insertInto("care_entries").values({
    id,
    generated_by_pattern_id: input.generatedByPatternId ?? null,
    rule_occurrence_date: input.ruleOccurrenceDate ?? null,
    contact_rule_id: input.contactRuleId ?? null,
    contact_rule_segment_id: input.contactRuleSegmentId ?? null,
    contact_rule_occurrence_key: input.contactRuleOccurrenceKey ?? null,
    responsible_party_id: input.responsiblePartyId ?? null,
    contact_rule_sync_state: input.contactRuleSyncState ?? null,
    start_datetime: input.startDateTime,
    end_datetime: input.endDateTime,
    planned_start_datetime: plannedStartDateTime,
    planned_end_datetime: plannedEndDateTime,
    status: input.status,
    deviation_type: deviationType,
    deviation_note: optionalText(record, "deviationNote"),
    care_scope: input.careScope,
    cancellation_reason: input.status === "cancelled" ? input.cancellationReason ?? null : null,
    confirmation_note: optionalText(record, "confirmationNote"),
    confirmed_at: optionalText(record, "confirmedAt"),
    confirmed_by: optionalText(record, "confirmedBy"),
    actual_start_datetime: actualStartDateTime,
    actual_end_datetime: actualEndDateTime,
    actual_responsible_party_id: actualResponsiblePartyId,
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
    is_contact_time: Number(durationMinutes < 120),
    created_by: text(record, "createdBy", userEmail),
    updated_by: text(record, "updatedBy", userEmail),
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at: null,
    confirmation_suppressed: 0
  }).execute();
  if (input.childIds.length) {
    await database.insertInto("care_entry_children").values(input.childIds.map((childId) => ({
      care_entry_id: id,
      child_id: childId,
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: null
    }))).execute();
  }
  if (actualChildIds.length) {
    await database.insertInto("care_entry_actual_children").values(actualChildIds.map((childId) => ({
      care_entry_id: id,
      child_id: childId,
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: null
    }))).execute();
  }
  for (const trip of input.trips) {
    if (!trip.id) throw new Error("Fahrt ohne ID kann nicht importiert werden.");
    await database.insertInto("trips").values({
      id: trip.id,
      care_entry_id: id,
      purpose: trip.purpose,
      km: trip.km,
      own_car: Number(trip.ownCar),
      reimbursed: Number(trip.reimbursed),
      reimbursement_amount: trip.reimbursementAmount ?? null,
      notes: trip.notes ?? null,
      created_by: userEmail,
      updated_by: userEmail,
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: null
    }).execute();
  }
  for (const cost of input.costs) {
    if (!cost.id) throw new Error("Kostenposition ohne ID kann nicht importiert werden.");
    await database.insertInto("costs").values({
      id: cost.id,
      care_entry_id: id,
      category: cost.category,
      amount: cost.amount,
      paid_by: cost.paidBy,
      notes: cost.notes ?? null,
      created_by: userEmail,
      updated_by: userEmail,
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: null
    }).execute();
  }
}

export async function insertHoliday(
  record: DataRecord,
  timestamp: string,
  userEmail: string,
  database: DatabaseExecutor
): Promise<void> {
  if (record.deletedAt) return;
  const input = holidayInputSchema.parse({
    name: record.name,
    startDate: record.startDate,
    endDate: record.endDate,
    childIds: stringArray(record, "childIds"),
    assignedTo: record.assignedTo,
    notes: optionalText(record, "notes") ?? undefined
  });
  const id = text(record, "id");
  if (!id) throw new Error("Ferienzeitraum ohne ID kann nicht importiert werden.");
  await database.insertInto("holiday_periods").values({
    id,
    name: input.name,
    start_date: input.startDate,
    end_date: input.endDate,
    assigned_to: input.assignedTo,
    notes: input.notes ?? null,
    source_external_calendar_source_id: optionalText(record, "sourceExternalCalendarSourceId"),
    source_external_calendar_event_id: optionalText(record, "sourceExternalCalendarEventId"),
    created_by: text(record, "createdBy", userEmail),
    updated_by: text(record, "updatedBy", userEmail),
    created_at: text(record, "createdAt", timestamp),
    updated_at: text(record, "updatedAt", timestamp),
    deleted_at: null
  }).execute();
  if (input.childIds.length) {
    await database.insertInto("holiday_period_children").values(input.childIds.map((childId) => ({
      holiday_period_id: id,
      child_id: childId,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null
    }))).execute();
  }
}

export async function insertPattern(
  record: DataRecord,
  timestamp: string,
  userEmail: string,
  fallbackResponsiblePartyId: string | undefined,
  database: DatabaseExecutor
): Promise<void> {
  const input = contactPatternInputSchema.parse({
    name: record.name,
    startDate: record.startDate,
    frequency: "biweekly",
    fridayStartTime: record.fridayStartTime,
    sundayEndTime: record.sundayEndTime,
    childIds: stringArray(record, "childIds"),
    active: booleanValue(record, "active", true)
  });
  const id = text(record, "id");
  if (!id) throw new Error("Umgangsregel ohne ID kann nicht importiert werden.");
  await database.insertInto("contact_patterns").values({
    id,
    name: input.name,
    start_date: input.startDate,
    frequency: input.frequency,
    friday_start_time: input.fridayStartTime,
    sunday_end_time: input.sundayEndTime,
    active: Number(input.active),
    created_by: text(record, "createdBy", userEmail),
    updated_by: text(record, "updatedBy", userEmail),
    created_at: text(record, "createdAt", timestamp),
    updated_at: text(record, "updatedAt", timestamp),
    deleted_at: null
  }).execute();
  if (input.childIds.length) {
    await database.insertInto("contact_pattern_children").values(input.childIds.map((childId) => ({
      contact_pattern_id: id,
      child_id: childId,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null
    }))).execute();
  }
  await insertImportedContactRule({
    id,
    name: input.name,
    startDate: input.startDate,
    timezone: "Europe/Berlin",
    recurrence: legacyRecurrenceForPattern(),
    segments: legacySegmentsForPattern(input),
    syncHorizonMonths: 12,
    responsiblePartyId: fallbackResponsiblePartyId,
    childIds: input.childIds,
    active: input.active,
    sourceContactPatternId: id,
    createdBy: text(record, "createdBy", userEmail),
    updatedBy: text(record, "updatedBy", userEmail),
    createdAt: text(record, "createdAt", timestamp),
    updatedAt: text(record, "updatedAt", timestamp),
    database
  });
}

interface ImportedContactRule {
  id: string;
  name: string;
  startDate: string;
  endDate?: string;
  timezone: string;
  recurrence: unknown;
  segments: unknown;
  syncHorizonMonths: number;
  responsiblePartyId?: string;
  childIds: string[];
  active: boolean;
  sourceContactPatternId?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  database: DatabaseExecutor;
}

async function insertImportedContactRule(input: ImportedContactRule): Promise<void> {
  await input.database.insertInto("contact_rules").values({
    id: input.id,
    name: input.name,
    start_date: input.startDate,
    end_date: input.endDate ?? null,
    timezone: input.timezone,
    recurrence_json: JSON.stringify(input.recurrence),
    segments_json: JSON.stringify(input.segments),
    sync_horizon_months: input.syncHorizonMonths,
    responsible_party_id: input.responsiblePartyId ?? null,
    active: Number(input.active),
    source_contact_pattern_id: input.sourceContactPatternId ?? null,
    created_by: input.createdBy,
    updated_by: input.updatedBy,
    created_at: input.createdAt,
    updated_at: input.updatedAt,
    deleted_at: null
  }).onConflict((conflict) => conflict.column("id").doUpdateSet({
    name: input.name,
    start_date: input.startDate,
    end_date: input.endDate ?? null,
    timezone: input.timezone,
    recurrence_json: JSON.stringify(input.recurrence),
    segments_json: JSON.stringify(input.segments),
    sync_horizon_months: input.syncHorizonMonths,
    responsible_party_id: input.responsiblePartyId ?? null,
    active: Number(input.active),
    source_contact_pattern_id: input.sourceContactPatternId ?? null,
    updated_by: input.updatedBy,
    updated_at: input.updatedAt,
    deleted_at: null
  })).execute();
  await input.database.deleteFrom("contact_rule_children")
    .where("contact_rule_id", "=", input.id)
    .execute();
  if (input.childIds.length) {
    await input.database.insertInto("contact_rule_children").values(input.childIds.map((childId) => ({
      contact_rule_id: input.id,
      child_id: childId,
      created_at: input.updatedAt,
      updated_at: input.updatedAt,
      deleted_at: null
    }))).execute();
  }
}

export async function insertContactRule(
  record: DataRecord,
  timestamp: string,
  userEmail: string,
  fallbackResponsiblePartyId: string | undefined,
  database: DatabaseExecutor
): Promise<void> {
  const input = contactRuleInputSchema.parse({
    name: record.name,
    startDate: record.startDate,
    endDate: optionalText(record, "endDate") ?? undefined,
    timezone: text(record, "timezone", "Europe/Berlin"),
    recurrence: record.recurrence,
    segments: record.segments,
    syncHorizonMonths: numberValue(record, "syncHorizonMonths", 12),
    responsiblePartyId: optionalText(record, "responsiblePartyId") ?? fallbackResponsiblePartyId,
    childIds: stringArray(record, "childIds"),
    active: booleanValue(record, "active", true)
  });
  const id = text(record, "id");
  if (!id) throw new Error("Umgangsregel ohne ID kann nicht importiert werden.");
  await insertImportedContactRule({
    id,
    ...input,
    sourceContactPatternId: optionalText(record, "sourceContactPatternId") ?? undefined,
    createdBy: text(record, "createdBy", userEmail),
    updatedBy: text(record, "updatedBy", userEmail),
    createdAt: text(record, "createdAt", timestamp),
    updatedAt: text(record, "updatedAt", timestamp),
    database
  });
}

export async function insertUnavailable(
  record: DataRecord,
  timestamp: string,
  userEmail: string,
  database: DatabaseExecutor
): Promise<void> {
  if (record.deletedAt) return;
  const input = unavailablePeriodInputSchema.parse({
    startDateTime: record.startDateTime,
    endDateTime: record.endDateTime,
    category: record.category,
    scope: text(record, "scope", "own_unavailability"),
    responsiblePartyId: optionalText(record, "responsiblePartyId") ?? undefined,
    childIds: stringArray(record, "childIds"),
    dutyRelated: booleanValue(record, "dutyRelated"),
    affectsContact: booleanValue(record, "affectsContact"),
    affectsHolidays: booleanValue(record, "affectsHolidays"),
    location: optionalText(record, "location") ?? undefined,
    notes: optionalText(record, "notes") ?? undefined,
    hasEvidence: booleanValue(record, "hasEvidence"),
    evidenceReference: optionalText(record, "evidenceReference") ?? undefined
  });
  const id = text(record, "id");
  if (!id) throw new Error("Nichtverfügbarkeit ohne ID kann nicht importiert werden.");
  await database.insertInto("unavailable_periods").values({
    id,
    start_datetime: input.startDateTime,
    end_datetime: input.endDateTime,
    scope: input.scope,
    responsible_party_id: input.responsiblePartyId ?? null,
    category: input.category,
    duty_related: Number(input.dutyRelated),
    affects_contact: Number(input.affectsContact),
    affects_holidays: Number(input.affectsHolidays),
    location: input.location ?? null,
    notes: input.notes ?? null,
    has_evidence: Number(input.hasEvidence),
    evidence_reference: input.evidenceReference ?? null,
    created_by: text(record, "createdBy", userEmail),
    updated_by: text(record, "updatedBy", userEmail),
    created_at: text(record, "createdAt", timestamp),
    updated_at: text(record, "updatedAt", timestamp),
    deleted_at: null
  }).execute();
  if (input.childIds.length) {
    await database.insertInto("unavailable_period_children").values(input.childIds.map((childId) => ({
      unavailable_period_id: id,
      child_id: childId,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null
    }))).execute();
  }
}

export async function importData(
  data: ReturnType<typeof appDataImportSchema.parse>,
  userEmail: string,
  database: DatabaseExecutor
): Promise<void> {
  const timestamp = nowIso();
  await clearDomainData(database);
  for (const child of data.children) await insertChild(child, timestamp, userEmail, database);
  for (const party of data.careParties) await insertCareParty(party, timestamp, userEmail, database);
  const importedSettings = await normalizeClientSettings({
    ...data.settings,
    lastJsonBackupAt: data.lastJsonBackupAt ?? data.settings.lastJsonBackupAt
  }, database);
  const fallbackResponsiblePartyId = importedSettings.defaultResponsiblePartyId
    ?? await importedDefaultResponsiblePartyId(data, database);
  for (const entry of data.entries) await insertEntry(entry, timestamp, userEmail, fallbackResponsiblePartyId, database);
  for (const holiday of data.holidayPeriods) await insertHoliday(holiday, timestamp, userEmail, database);
  for (const pattern of data.contactPatterns) await insertPattern(pattern, timestamp, userEmail, fallbackResponsiblePartyId, database);
  for (const rule of data.contactRules) await insertContactRule(rule, timestamp, userEmail, fallbackResponsiblePartyId, database);
  for (const period of data.unavailablePeriods) await insertUnavailable(period, timestamp, userEmail, database);
  for (const source of data.externalCalendarSources) {
    const id = text(source, "id");
    if (!id) throw new Error("External calendar source without ID.");
    await database.insertInto("external_calendar_sources").values({
      id,
      name: text(source, "name"),
      color: text(source, "color"),
      visible: Number(booleanValue(source, "visible", true)),
      source_type: externalCalendarSourceType(source),
      source_kind: "file",
      feed_url: null,
      last_imported_at: text(source, "lastImportedAt", timestamp),
      last_refresh_at: null,
      last_refresh_error: null,
      created_at: text(source, "createdAt", timestamp),
      updated_at: text(source, "updatedAt", timestamp)
    }).execute();
  }
  for (const event of data.externalCalendarEvents) {
    const id = text(event, "id");
    if (!id || !text(event, "sourceId")) throw new Error("External calendar event is incomplete.");
    await database.insertInto("external_calendar_events").values({
      id,
      source_id: text(event, "sourceId"),
      ical_uid: text(event, "icalUid"),
      recurrence_id: text(event, "recurrenceId"),
      title: text(event, "title"),
      description: optionalText(event, "description"),
      start_datetime: text(event, "startDateTime"),
      end_datetime: text(event, "endDateTime"),
      all_day: Number(booleanValue(event, "allDay")),
      location: optionalText(event, "location"),
      raw_hash: text(event, "rawHash"),
      created_at: text(event, "createdAt", timestamp),
      updated_at: text(event, "updatedAt", timestamp)
    }).execute();
  }

  for (const [key, value] of Object.entries(importedSettings)) {
    if (value !== undefined) {
      await database.insertInto("settings").values({
        key,
        value_json: JSON.stringify(value),
        created_by: userEmail,
        updated_by: userEmail,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null
      }).execute();
    }
  }

  for (const closure of data.monthClosures) {
    const monthKey = text(closure, "monthKey");
    if (!monthKey) continue;
    const closedAt = text(closure, "closedAt", timestamp);
    await database.insertInto("monthly_closings").values({
      id: `closing_${monthKey}`,
      month_key: monthKey,
      summary_json: JSON.stringify({
        dataUpdatedAt: text(closure, "dataUpdatedAt", data.updatedAt),
        summary: closure.summary ?? {}
      }),
      closed_by: text(closure, "closedBy", userEmail),
      updated_by: text(closure, "updatedBy", userEmail),
      changed_after_close_at: optionalText(closure, "changedAfterCloseAt"),
      created_at: closedAt,
      updated_at: timestamp,
      deleted_at: null
    }).execute();
  }

  const typeMap: Record<string, string> = {
    careEntry: "care_entry",
    trip: "trip",
    cost: "cost",
    holiday: "holiday_period",
    unavailablePeriod: "unavailable_period",
    child: "child",
    careParty: "care_party",
    contactPattern: "contact_pattern",
    settings: "settings",
    monthClosure: "month_closure"
  };
  for (const audit of data.auditLog) {
    const action = text(audit, "action");
    if (!["created", "updated", "deleted"].includes(action)) continue;
    await recordDomainAudit(database, {
      userEmail: text(audit, "userId", userEmail),
      entityType: typeMap[text(audit, "objectType")] ?? text(audit, "objectType", "unknown"),
      entityId: text(audit, "objectId", "unknown"),
      action: action as "created" | "updated" | "deleted",
      fieldName: optionalText(audit, "field") ?? undefined,
      oldValue: optionalText(audit, "oldValue") ?? undefined,
      newValue: optionalText(audit, "newValue") ?? undefined,
      metadata: { importedLabel: text(audit, "objectLabel") },
      timestamp: text(audit, "timestamp", timestamp)
    });
  }
  await recordDomainAudit(database, {
    userEmail,
    entityType: "app_data",
    entityId: "global",
    action: "updated",
    newValue: "JSON-Wiederherstellung abgeschlossen",
    timestamp
  });
}

export async function appDataRoutes(app: FastifyInstance): Promise<void> {
  const destructive = { config: { permission: "admin:destructive" as const } };
  app.put("/api/app-data", destructive, async (request, reply) => {
    const parsed = appDataImportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        issues: parsed.error.issues
      });
    }
    try {
      await app.persistence.transaction((database) => importData(parsed.data, request.userEmail, database));
    } catch (error) {
      return reply.code(400).send({
        error: "import_failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
    return reply.code(204).send();
  });

  app.delete("/api/app-data", destructive, async (_request, reply) => {
    await app.persistence.transaction((database) => clearDomainData(database));
    return reply.code(204).send();
  });
}
