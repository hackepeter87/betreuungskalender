import type { FastifyInstance } from "fastify";
import { db } from "../db/connection.js";
import { recordAudit } from "../services/audit.js";
import { nowIso } from "../services/common.js";
import { upsertContactRule, upsertContactRuleFromPattern } from "../services/contactRules.js";
import {
  appDataImportSchema,
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

export function clearDomainData(): void {
  for (const table of [
    "care_entry_children",
    "holiday_period_children",
    "contact_rule_children",
    "contact_pattern_children",
    "trips",
    "costs",
    "care_entries",
    "holiday_periods",
    "contact_rules",
    "contact_patterns",
    "unavailable_periods",
    "external_calendar_events",
    "external_calendar_sources",
    "calendar_feed_tokens",
    "monthly_closings",
    "settings",
    "children",
    "audit_log"
  ]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
}

export function insertChild(record: DataRecord, timestamp: string, userEmail: string): void {
  const input = childInputSchema.parse({
    name: record.name,
    birthMonth: record.birthMonth,
    birthYear: record.birthYear,
    color: record.color
  });
  const id = text(record, "id");
  if (!id) throw new Error("Kind ohne ID kann nicht importiert werden.");
  db.prepare(`
    INSERT INTO children (
      id, name, birth_month, birth_year, color, created_by, updated_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.birthMonth,
    input.birthYear,
    input.color,
    text(record, "createdBy", userEmail),
    text(record, "updatedBy", userEmail),
    text(record, "createdAt", timestamp),
    text(record, "updatedAt", timestamp)
  );
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

export function insertEntry(record: DataRecord, timestamp: string, userEmail: string): void {
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
    responsiblePartyId: optionalText(record, "responsiblePartyId") ?? undefined,
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
  db.prepare(`
    INSERT INTO care_entries (
      id, generated_by_pattern_id, rule_occurrence_date,
      contact_rule_id, contact_rule_segment_id, contact_rule_occurrence_key,
      responsible_party_id, contact_rule_sync_state,
      start_datetime, end_datetime, status, care_scope, cancellation_reason,
      overnight, school_handover, holiday, weekend, additional_care, location,
      custom_location, handover_from, handover_to, notes, evidence_reference,
      has_evidence, duration_minutes, is_contact_time, created_by, updated_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.generatedByPatternId ?? null,
    input.ruleOccurrenceDate ?? null,
    input.contactRuleId ?? null,
    input.contactRuleSegmentId ?? null,
    input.contactRuleOccurrenceKey ?? null,
    input.responsiblePartyId ?? null,
    input.contactRuleSyncState ?? null,
    input.startDateTime,
    input.endDateTime,
    input.status,
    input.careScope,
    input.status === "cancelled" ? input.cancellationReason ?? null : null,
    Number(input.overnight),
    Number(input.schoolHandover),
    Number(input.holiday),
    Number(input.weekend),
    Number(input.additionalCare),
    input.location ?? null,
    input.customLocation ?? null,
    input.handoverFrom ?? null,
    input.handoverTo ?? null,
    input.notes ?? null,
    input.evidenceReference ?? null,
    Number(input.hasEvidence),
    durationMinutes,
    Number(durationMinutes < 120),
    userEmail,
    userEmail,
    createdAt,
    updatedAt
  );
  const junction = db.prepare(`
    INSERT INTO care_entry_children (
      care_entry_id, child_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?)
  `);
  for (const childId of input.childIds) junction.run(id, childId, createdAt, updatedAt);
  const tripInsert = db.prepare(`
    INSERT INTO trips (
      id, care_entry_id, purpose, km, own_car, reimbursed,
      reimbursement_amount, notes, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const trip of input.trips) {
    tripInsert.run(
      trip.id,
      id,
      trip.purpose,
      trip.km,
      Number(trip.ownCar),
      Number(trip.reimbursed),
      trip.reimbursementAmount ?? null,
      trip.notes ?? null,
      text(trip, "createdBy", userEmail),
      text(trip, "updatedBy", userEmail),
      createdAt,
      updatedAt
    );
  }
  const costInsert = db.prepare(`
    INSERT INTO costs (
      id, care_entry_id, category, amount, paid_by, notes,
      created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const cost of input.costs) {
    costInsert.run(
      cost.id,
      id,
      cost.category,
      cost.amount,
      cost.paidBy,
      cost.notes ?? null,
      text(cost, "createdBy", userEmail),
      text(cost, "updatedBy", userEmail),
      createdAt,
      updatedAt
    );
  }
}

export function insertHoliday(record: DataRecord, timestamp: string, userEmail: string): void {
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
  db.prepare(`
    INSERT INTO holiday_periods (
      id, name, start_date, end_date, assigned_to, notes, created_by, updated_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.startDate,
    input.endDate,
    input.assignedTo,
    input.notes ?? null,
    text(record, "createdBy", userEmail),
    text(record, "updatedBy", userEmail),
    text(record, "createdAt", timestamp),
    text(record, "updatedAt", timestamp)
  );
  const junction = db.prepare(`
    INSERT INTO holiday_period_children (
      holiday_period_id, child_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?)
  `);
  for (const childId of input.childIds) junction.run(id, childId, timestamp, timestamp);
}

export function insertPattern(record: DataRecord, timestamp: string, userEmail: string): void {
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
  db.prepare(`
    INSERT INTO contact_patterns (
      id, name, start_date, frequency, friday_start_time, sunday_end_time,
      active, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.startDate,
    input.frequency,
    input.fridayStartTime,
    input.sundayEndTime,
    Number(input.active),
    text(record, "createdBy", userEmail),
    text(record, "updatedBy", userEmail),
    text(record, "createdAt", timestamp),
    text(record, "updatedAt", timestamp)
  );
  const junction = db.prepare(`
    INSERT INTO contact_pattern_children (
      contact_pattern_id, child_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?)
  `);
  for (const childId of input.childIds) junction.run(id, childId, timestamp, timestamp);
  upsertContactRuleFromPattern({
    id,
    name: input.name,
    startDate: input.startDate,
    fridayStartTime: input.fridayStartTime,
    sundayEndTime: input.sundayEndTime,
    childIds: input.childIds,
    active: input.active,
    createdBy: text(record, "createdBy", userEmail),
    updatedBy: text(record, "updatedBy", userEmail),
    createdAt: text(record, "createdAt", timestamp),
    updatedAt: text(record, "updatedAt", timestamp)
  });
}

export function insertContactRule(record: DataRecord, timestamp: string, userEmail: string): void {
  const input = contactRuleInputSchema.parse({
    name: record.name,
    startDate: record.startDate,
    endDate: optionalText(record, "endDate") ?? undefined,
    timezone: text(record, "timezone", "Europe/Berlin"),
    recurrence: record.recurrence,
    segments: record.segments,
    syncHorizonMonths: numberValue(record, "syncHorizonMonths", 12),
    responsiblePartyId: optionalText(record, "responsiblePartyId") ?? undefined,
    childIds: stringArray(record, "childIds"),
    active: booleanValue(record, "active", true)
  });
  const id = text(record, "id");
  if (!id) throw new Error("Umgangsregel ohne ID kann nicht importiert werden.");
  upsertContactRule({
    id,
    rule: {
      ...input,
      sourceContactPatternId: optionalText(record, "sourceContactPatternId") ?? undefined
    },
    createdBy: text(record, "createdBy", userEmail),
    updatedBy: text(record, "updatedBy", userEmail),
    createdAt: text(record, "createdAt", timestamp),
    updatedAt: text(record, "updatedAt", timestamp)
  });
}

export function insertUnavailable(record: DataRecord, timestamp: string, userEmail: string): void {
  if (record.deletedAt) return;
  const input = unavailablePeriodInputSchema.parse({
    startDateTime: record.startDateTime,
    endDateTime: record.endDateTime,
    category: record.category,
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
  db.prepare(`
    INSERT INTO unavailable_periods (
      id, start_datetime, end_datetime, category, duty_related,
      affects_contact, affects_holidays, location, notes, has_evidence,
      evidence_reference, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.startDateTime,
    input.endDateTime,
    input.category,
    Number(input.dutyRelated),
    Number(input.affectsContact),
    Number(input.affectsHolidays),
    input.location ?? null,
    input.notes ?? null,
    Number(input.hasEvidence),
    input.evidenceReference ?? null,
    text(record, "createdBy", userEmail),
    text(record, "updatedBy", userEmail),
    text(record, "createdAt", timestamp),
    text(record, "updatedAt", timestamp)
  );
}

export function importData(data: ReturnType<typeof appDataImportSchema.parse>, userEmail: string): void {
  const timestamp = nowIso();
  clearDomainData();
  for (const child of data.children) insertChild(child, timestamp, userEmail);
  for (const entry of data.entries) insertEntry(entry, timestamp, userEmail);
  for (const holiday of data.holidayPeriods) insertHoliday(holiday, timestamp, userEmail);
  for (const pattern of data.contactPatterns) insertPattern(pattern, timestamp, userEmail);
  for (const rule of data.contactRules) insertContactRule(rule, timestamp, userEmail);
  for (const period of data.unavailablePeriods) insertUnavailable(period, timestamp, userEmail);
  const sourceInsert = db.prepare(`INSERT INTO external_calendar_sources (id, name, color, visible, last_imported_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const source of data.externalCalendarSources) {
    const id = text(source, "id");
    if (!id) throw new Error("External calendar source without ID.");
    sourceInsert.run(id, text(source, "name"), text(source, "color"), Number(booleanValue(source, "visible", true)), text(source, "lastImportedAt", timestamp), text(source, "createdAt", timestamp), text(source, "updatedAt", timestamp));
  }
  const eventInsert = db.prepare(`INSERT INTO external_calendar_events (id, source_id, ical_uid, recurrence_id, title, description, start_datetime, end_datetime, all_day, location, raw_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const event of data.externalCalendarEvents) {
    const id = text(event, "id");
    if (!id || !text(event, "sourceId")) throw new Error("External calendar event is incomplete.");
    eventInsert.run(id, text(event, "sourceId"), text(event, "icalUid"), text(event, "recurrenceId"), text(event, "title"), optionalText(event, "description"), text(event, "startDateTime"), text(event, "endDateTime"), Number(booleanValue(event, "allDay")), optionalText(event, "location"), text(event, "rawHash"), text(event, "createdAt", timestamp), text(event, "updatedAt", timestamp));
  }

  const settingInsert = db.prepare(`
    INSERT INTO settings (key, value_json, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const [key, value] of Object.entries({
    ...data.settings,
    lastJsonBackupAt: data.lastJsonBackupAt
  })) {
    if (value !== undefined) {
      settingInsert.run(
        key,
        JSON.stringify(value),
        userEmail,
        userEmail,
        timestamp,
        timestamp
      );
    }
  }

  const closingInsert = db.prepare(`
    INSERT INTO monthly_closings (
      id, month_key, summary_json, closed_by, updated_by, changed_after_close_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const closure of data.monthClosures) {
    const monthKey = text(closure, "monthKey");
    if (!monthKey) continue;
    const closedAt = text(closure, "closedAt", timestamp);
    closingInsert.run(
      `closing_${monthKey}`,
      monthKey,
      JSON.stringify({
        dataUpdatedAt: text(closure, "dataUpdatedAt", data.updatedAt),
        summary: closure.summary ?? {}
      }),
      text(closure, "closedBy", userEmail),
      text(closure, "updatedBy", userEmail),
      optionalText(closure, "changedAfterCloseAt"),
      closedAt,
      timestamp
    );
  }

  const typeMap: Record<string, string> = {
    careEntry: "care_entry",
    trip: "trip",
    cost: "cost",
    holiday: "holiday_period",
    unavailablePeriod: "unavailable_period",
    child: "child",
    contactPattern: "contact_pattern",
    settings: "settings",
    monthClosure: "month_closure"
  };
  for (const audit of data.auditLog) {
    const action = text(audit, "action");
    if (!["created", "updated", "deleted"].includes(action)) continue;
    recordAudit({
      userEmail,
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
  recordAudit({
    userEmail,
    entityType: "app_data",
    entityId: "global",
    action: "updated",
    newValue: "JSON-Wiederherstellung abgeschlossen",
    timestamp
  });
}

export async function appDataRoutes(app: FastifyInstance): Promise<void> {
  app.put("/api/app-data", async (request, reply) => {
    const parsed = appDataImportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        issues: parsed.error.issues
      });
    }
    try {
      db.transaction(() => importData(parsed.data, request.userEmail))();
    } catch (error) {
      return reply.code(400).send({
        error: "import_failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
    return reply.code(204).send();
  });

  app.delete("/api/app-data", async (_request, reply) => {
    db.transaction(clearDomainData)();
    return reply.code(204).send();
  });
}
