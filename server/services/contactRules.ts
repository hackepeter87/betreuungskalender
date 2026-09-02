import { createHash } from "node:crypto";
import { sql } from "kysely";
import type {
  ApiContactRule,
  ApiContactRuleSegment,
  ApiContactRuleSyncPreview,
  ApiContactRuleSyncSummary,
  ContactRuleRecurrence,
  ContactRuleWeekday
} from "../../shared/api.js";
import {
  expandContactRule,
  type ExpandedContactRuleEntry
} from "../../shared/contactRuleExpansion.js";
import type { DatabaseExecutor } from "../db/runtime.js";
import { bool, makeId, nowIso } from "./common.js";
import { previewPlannedCareConflicts } from "./careConflicts.js";
import {
  recordDomainAudit,
  syncPersistedChildJunction
} from "./domainPersistence.js";

const indexWeekdays: ContactRuleWeekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export { expandContactRule };
export type { ExpandedContactRuleEntry };

export interface ContactRuleRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  timezone: string;
  recurrence_json: string;
  segments_json: string;
  sync_horizon_months: number;
  responsible_party_id: string | null;
  active: number;
  source_contact_pattern_id: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface ContactRulePatternInput {
  id: string;
  name: string;
  startDate: string;
  fridayStartTime: string;
  sundayEndTime: string;
  childIds: string[];
  responsiblePartyId?: string;
  active: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContactRuleInput {
  name: string;
  startDate: string;
  endDate?: string;
  timezone: string;
  recurrence: ContactRuleRecurrence;
  segments: ApiContactRuleSegment[];
  syncHorizonMonths: number;
  responsiblePartyId?: string;
  childIds: string[];
  active: boolean;
  sourceContactPatternId?: string;
}

export interface ContactRuleSyncOptions {
  startDate?: string;
  endDate?: string;
  now?: string;
  userEmail: string;
  database: DatabaseExecutor;
  recordAudit?: boolean;
  previewFingerprint?: string;
  suppressPastConfirmations?: boolean;
  strictWindow?: boolean;
}

export class ContactRuleSyncPreviewChangedError extends Error {
  readonly code = "contact_rule_sync_preview_changed";

  constructor() {
    super("The contact-rule sync preview is no longer current.");
    this.name = "ContactRuleSyncPreviewChangedError";
  }
}

function optional<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function addMonths(date: string, months: number): string {
  const [year = 0, month = 1] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1 + months, 1, 12));
  return value.toISOString().slice(0, 10);
}

function firstDayOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function weekdayFor(date: string): ContactRuleWeekday {
  return indexWeekdays[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? "SU";
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function assertActiveRuleChildren(database: DatabaseExecutor, childIds: string[]): Promise<void> {
  const uniqueIds = [...new Set(childIds)];
  if (!uniqueIds.length) {
    throw new Error("Mindestens ein Kind ist erforderlich.");
  }
  const row = await database.selectFrom("children")
    .select(({ fn }) => fn.count<number>("id").as("count"))
    .where("deleted_at", "is", null)
    .where("id", "in", uniqueIds)
    .executeTakeFirst();
  if (Number(row?.count ?? 0) !== uniqueIds.length) {
    throw new Error("Mindestens ein zugeordnetes Kind existiert nicht oder wurde gelöscht.");
  }
}

export function legacyRecurrenceForPattern(): ContactRuleRecurrence {
  return {
    kind: "weekly",
    intervalWeeks: 2,
    weekdays: ["FR"]
  };
}

export function legacySegmentsForPattern(input: {
  fridayStartTime: string;
  sundayEndTime: string;
}): ApiContactRuleSegment[] {
  return [
    {
      id: "weekend",
      startDayOffset: 0,
      startTime: input.fridayStartTime,
      endDayOffset: 2,
      endTime: input.sundayEndTime
    }
  ];
}

export function mapContactRule(row: ContactRuleRow, childIds: string[], syncSummary?: ApiContactRuleSyncSummary): ApiContactRule {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    endDate: optional(row.end_date),
    timezone: row.timezone,
    recurrence: parseJson<ContactRuleRecurrence>(row.recurrence_json, legacyRecurrenceForPattern()),
    segments: parseJson<ApiContactRuleSegment[]>(row.segments_json, []),
    syncHorizonMonths: row.sync_horizon_months,
    responsiblePartyId: optional(row.responsible_party_id),
    childIds,
    active: bool(row.active),
    sourceContactPatternId: optional(row.source_contact_pattern_id),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(syncSummary ? { syncSummary } : {})
  };
}

export async function contactRuleChildIds(ruleId: string, database: DatabaseExecutor): Promise<string[]> {
  const rows = await database.selectFrom("contact_rule_children")
    .select("child_id")
    .where("contact_rule_id", "=", ruleId)
    .where("deleted_at", "is", null)
    .orderBy("child_id")
    .execute();
  return rows.map((row) => row.child_id);
}

export async function getContactRule(ruleId: string, database: DatabaseExecutor): Promise<ApiContactRule | undefined> {
  const row = await database.selectFrom("contact_rules")
    .selectAll()
    .where("id", "=", ruleId)
    .where("deleted_at", "is", null)
    .executeTakeFirst() as ContactRuleRow | undefined;
  return row ? mapContactRule(row, await contactRuleChildIds(ruleId, database)) : undefined;
}

export async function upsertContactRuleFromPattern(
  pattern: ContactRulePatternInput,
  database: DatabaseExecutor
): Promise<ApiContactRule> {
  const recurrence = legacyRecurrenceForPattern();
  const segments = legacySegmentsForPattern(pattern);
  await database.insertInto("contact_rules").values({
    id: pattern.id,
    name: pattern.name,
    start_date: pattern.startDate,
    end_date: null,
    timezone: "Europe/Berlin",
    recurrence_json: JSON.stringify(recurrence),
    segments_json: JSON.stringify(segments),
    sync_horizon_months: 12,
    responsible_party_id: pattern.responsiblePartyId ?? null,
    active: Number(pattern.active),
    source_contact_pattern_id: pattern.id,
    created_by: pattern.createdBy,
    updated_by: pattern.updatedBy,
    created_at: pattern.createdAt,
    updated_at: pattern.updatedAt,
    deleted_at: null
  }).onConflict((conflict) => conflict.column("id").doUpdateSet({
    name: pattern.name,
    start_date: pattern.startDate,
    timezone: "Europe/Berlin",
    recurrence_json: JSON.stringify(recurrence),
    segments_json: JSON.stringify(segments),
    responsible_party_id: pattern.responsiblePartyId ?? null,
    active: Number(pattern.active),
    source_contact_pattern_id: pattern.id,
    updated_by: pattern.updatedBy,
    updated_at: pattern.updatedAt,
    deleted_at: null
  })).execute();

  await syncPersistedChildJunction(database, { table: "contact_rule_children", owner: "contact_rule_id" }, pattern.id, pattern.childIds, pattern.updatedAt);

  const rule = await getContactRule(pattern.id, database);
  if (!rule) throw new Error("Umgangsregel konnte nicht geladen werden.");
  return rule;
}

export async function upsertContactRule(input: {
  id: string;
  rule: ContactRuleInput;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  database: DatabaseExecutor;
}): Promise<ApiContactRule> {
  const database = input.database;
  await database.insertInto("contact_rules").values({
    id: input.id,
    name: input.rule.name,
    start_date: input.rule.startDate,
    end_date: input.rule.endDate ?? null,
    timezone: input.rule.timezone,
    recurrence_json: JSON.stringify(input.rule.recurrence),
    segments_json: JSON.stringify(input.rule.segments),
    sync_horizon_months: input.rule.syncHorizonMonths,
    responsible_party_id: input.rule.responsiblePartyId ?? null,
    active: Number(input.rule.active),
    source_contact_pattern_id: input.rule.sourceContactPatternId ?? null,
    created_by: input.createdBy,
    updated_by: input.updatedBy,
    created_at: input.createdAt,
    updated_at: input.updatedAt,
    deleted_at: null
  }).onConflict((conflict) => conflict.column("id").doUpdateSet({
    name: input.rule.name,
    start_date: input.rule.startDate,
    end_date: input.rule.endDate ?? null,
    timezone: input.rule.timezone,
    recurrence_json: JSON.stringify(input.rule.recurrence),
    segments_json: JSON.stringify(input.rule.segments),
    sync_horizon_months: input.rule.syncHorizonMonths,
    responsible_party_id: input.rule.responsiblePartyId ?? null,
    active: Number(input.rule.active),
    source_contact_pattern_id: input.rule.sourceContactPatternId ?? null,
    updated_by: input.updatedBy,
    updated_at: input.updatedAt,
    deleted_at: null
  })).execute();
  await syncPersistedChildJunction(database, { table: "contact_rule_children", owner: "contact_rule_id" }, input.id, input.rule.childIds, input.updatedAt);
  const rule = await getContactRule(input.id, database);
  if (!rule) throw new Error("Umgangsregel konnte nicht geladen werden.");
  return rule;
}

function syncWindow(rule: ApiContactRule, options: ContactRuleSyncOptions): { startDate: string; endDate: string } {
  if (rule.endDate) {
    const maximumEndDate = addDays(addMonths(rule.startDate, 36), -1);
    if (rule.endDate > maximumEndDate) {
      throw new Error("Der vollständige Regelzeitraum darf höchstens 36 Monate umfassen.");
    }
    const result = {
      startDate: options.startDate ?? rule.startDate,
      endDate: options.endDate ?? rule.endDate
    };
    assertSyncWindow(rule, result, Boolean(options.strictWindow || options.previewFingerprint));
    return result;
  }
  const currentMonth = firstDayOfMonth((options.now ?? nowIso()).slice(0, 10));
  const startDate = options.startDate ?? (rule.startDate > currentMonth ? rule.startDate : currentMonth);
  const defaultEnd = addDays(addMonths(startDate, rule.syncHorizonMonths), -1);
  const endDate = options.endDate ?? defaultEnd;
  const result = { startDate, endDate };
  assertSyncWindow(rule, result, Boolean(options.strictWindow || options.previewFingerprint));
  return result;
}

function assertSyncWindow(
  rule: ApiContactRule,
  window: { startDate: string; endDate: string },
  strict: boolean
): void {
  if (window.startDate > window.endDate) throw new Error("Der Synchronisierungszeitraum ist ungültig.");
  if (strict && (window.startDate < rule.startDate || (rule.endDate && window.endDate > rule.endDate))) {
    throw new Error("Der Synchronisierungszeitraum muss innerhalb der Regel liegen.");
  }
  if (strict && window.endDate >= addMonths(window.startDate, 36)) {
    throw new Error("Der Synchronisierungszeitraum darf höchstens 36 Monate umfassen.");
  }
}

interface ExistingGeneratedRow {
  id: string;
  status: string;
  contact_rule_sync_state: "generated" | "manual_override" | null;
  deleted_at: string | null;
}

async function existingGeneratedEntry(
  database: DatabaseExecutor,
  ruleId: string,
  occurrenceKey: string,
  legacyOccurrenceDate: string
): Promise<ExistingGeneratedRow | undefined> {
  return await database.selectFrom("care_entries")
    .select(["id", "status", "contact_rule_sync_state", "deleted_at"])
    .where((expression) => expression.or([
      expression.and([
        expression("contact_rule_id", "=", ruleId),
        expression("contact_rule_occurrence_key", "=", occurrenceKey)
      ]),
      expression.and([
        expression("generated_by_pattern_id", "=", ruleId),
        expression("rule_occurrence_date", "=", legacyOccurrenceDate)
      ])
    ]))
    .orderBy(sql<boolean>`deleted_at IS NULL`, "desc")
    .orderBy("updated_at", "desc")
    .executeTakeFirst() as ExistingGeneratedRow | undefined;
}

async function insertGeneratedEntry(input: {
  database: DatabaseExecutor;
  rule: ApiContactRule;
  expanded: ExpandedContactRuleEntry;
  timestamp: string;
  userEmail: string;
  confirmationSuppressed?: boolean;
  recordAudit?: boolean;
}): Promise<void> {
  const id = makeId("entry");
  const durationMinutes = Math.round(
    (Date.parse(input.expanded.endDateTime) - Date.parse(input.expanded.startDateTime)) / 60000
  );
  await input.database.insertInto("care_entries").values({
    id,
    generated_by_pattern_id: input.rule.sourceContactPatternId ?? input.rule.id,
    rule_occurrence_date: input.expanded.occurrenceDate,
    contact_rule_id: input.rule.id,
    contact_rule_segment_id: input.expanded.segmentId,
    contact_rule_occurrence_key: input.expanded.occurrenceKey,
    responsible_party_id: input.rule.responsiblePartyId ?? null,
    contact_rule_sync_state: "generated",
    start_datetime: input.expanded.startDateTime,
    end_datetime: input.expanded.endDateTime,
    status: "planned",
    care_scope: durationMinutes >= 12 * 60 ? "overnight" : durationMinutes >= 5 * 60 ? "half_day" : "hourly",
    cancellation_reason: null,
    confirmation_note: null,
    confirmed_at: null,
    confirmed_by: null,
    overnight: Number(durationMinutes >= 12 * 60),
    school_handover: 0,
    holiday: 0,
    weekend: Number(["FR", "SA", "SU"].includes(weekdayFor(input.expanded.occurrenceDate))),
    additional_care: 0,
    location: null,
    custom_location: null,
    handover_from: null,
    handover_to: null,
    notes: null,
    evidence_reference: null,
    has_evidence: 0,
    duration_minutes: durationMinutes,
    is_contact_time: Number(durationMinutes < 120),
    actual_start_datetime: null,
    actual_end_datetime: null,
    actual_responsible_party_id: null,
    planned_start_datetime: null,
    planned_end_datetime: null,
    deviation_type: null,
    deviation_note: null,
    created_by: input.userEmail,
    updated_by: input.userEmail,
    created_at: input.timestamp,
    updated_at: input.timestamp,
    confirmation_suppressed: Number(input.confirmationSuppressed),
    deleted_at: null
  }).execute();
  await syncPersistedChildJunction(
    input.database,
    { table: "care_entry_children", owner: "care_entry_id" },
    id,
    input.rule.childIds,
    input.timestamp
  );
  if (input.recordAudit) {
    await recordDomainAudit(input.database, {
      userEmail: input.userEmail,
      entityType: "care_entry",
      entityId: id,
      action: "created",
      newValue: {
        id,
        contactRuleId: input.rule.id,
        contactRuleOccurrenceKey: input.expanded.occurrenceKey,
        startDateTime: input.expanded.startDateTime,
        endDateTime: input.expanded.endDateTime,
        status: "planned"
      }
    });
  }
}

async function updateGeneratedEntry(input: {
  database: DatabaseExecutor;
  id: string;
  rule: ApiContactRule;
  expanded: ExpandedContactRuleEntry;
  timestamp: string;
  userEmail: string;
}): Promise<void> {
  const durationMinutes = Math.round(
    (Date.parse(input.expanded.endDateTime) - Date.parse(input.expanded.startDateTime)) / 60000
  );
  await input.database.updateTable("care_entries").set({
    generated_by_pattern_id: input.rule.sourceContactPatternId ?? input.rule.id,
    rule_occurrence_date: input.expanded.occurrenceDate,
    contact_rule_id: input.rule.id,
    contact_rule_segment_id: input.expanded.segmentId,
    contact_rule_occurrence_key: input.expanded.occurrenceKey,
    responsible_party_id: input.rule.responsiblePartyId ?? null,
    contact_rule_sync_state: "generated",
    start_datetime: input.expanded.startDateTime,
    end_datetime: input.expanded.endDateTime,
    care_scope: durationMinutes >= 12 * 60 ? "overnight" : durationMinutes >= 5 * 60 ? "half_day" : "hourly",
    overnight: Number(durationMinutes >= 12 * 60),
    weekend: Number(["FR", "SA", "SU"].includes(weekdayFor(input.expanded.occurrenceDate))),
    duration_minutes: durationMinutes,
    is_contact_time: Number(durationMinutes < 120),
    updated_by: input.userEmail,
    updated_at: input.timestamp
  }).where("id", "=", input.id).execute();
  await syncPersistedChildJunction(
    input.database,
    { table: "care_entry_children", owner: "care_entry_id" },
    input.id,
    input.rule.childIds,
    input.timestamp
  );
}

export async function syncContactRule(
  ruleId: string,
  options: ContactRuleSyncOptions
): Promise<ApiContactRuleSyncSummary> {
  const database = options.database;
  const rule = await getContactRule(ruleId, database);
  if (!rule) throw new Error("Umgangsregel wurde nicht gefunden.");
  await assertActiveRuleChildren(database, rule.childIds);

  const window = syncWindow(rule, options);
  if (options.previewFingerprint) {
    const preview = await previewContactRuleSync(ruleId, {
      startDate: window.startDate,
      endDate: window.endDate,
      now: options.now,
      database
    });
    if (preview.fingerprint !== options.previewFingerprint) {
      throw new ContactRuleSyncPreviewChangedError();
    }
  }
  const expanded = expandContactRule({
    startDate: rule.startDate,
    endDate: rule.endDate,
    recurrence: rule.recurrence,
    segments: rule.segments,
    active: rule.active,
    childIds: rule.childIds,
    rangeStart: window.startDate,
    rangeEnd: window.endDate
  });

  const summary: ApiContactRuleSyncSummary = {
    ...window,
    created: 0,
    updated: 0,
    skipped: 0,
    preserved: 0
  };
  const timestamp = options.now ?? nowIso();

  for (const item of expanded) {
    const existing = await existingGeneratedEntry(database, rule.id, item.occurrenceKey, item.occurrenceDate);
    if (!existing) {
      await insertGeneratedEntry({
        database,
        rule,
        expanded: item,
        timestamp,
        userEmail: options.userEmail,
        confirmationSuppressed: Boolean(
          options.suppressPastConfirmations &&
          Date.parse(item.endDateTime) < Date.parse(options.now ?? timestamp)
        ),
        recordAudit: options.recordAudit
      });
      summary.created += 1;
      continue;
    }
    if (existing.deleted_at) {
      summary.preserved += 1;
      continue;
    }
    if (existing.status !== "planned" || existing.contact_rule_sync_state === "manual_override") {
      summary.preserved += 1;
      continue;
    }
    await updateGeneratedEntry({
      database,
      id: existing.id,
      rule,
      expanded: item,
      timestamp,
      userEmail: options.userEmail
    });
    summary.updated += 1;
  }

  return summary;
}

export function isContactRuleSyncPreviewChangedError(error: unknown): boolean {
  return error instanceof ContactRuleSyncPreviewChangedError ||
    (error instanceof Error && (error as { code?: string }).code === "contact_rule_sync_preview_changed");
}

export async function previewContactRuleSync(
  ruleId: string,
  options: Pick<ContactRuleSyncOptions, "startDate" | "endDate" | "now" | "database">
): Promise<ApiContactRuleSyncPreview> {
  const database = options.database;
  const rule = await getContactRule(ruleId, database);
  if (!rule) throw new Error("Umgangsregel wurde nicht gefunden.");
  const window = syncWindow(rule, { ...options, userEmail: "preview", strictWindow: true });
  const expanded = expandContactRule({
    startDate: rule.startDate,
    endDate: rule.endDate,
    recurrence: rule.recurrence,
    segments: rule.segments,
    active: rule.active,
    childIds: rule.childIds,
    rangeStart: window.startDate,
    rangeEnd: window.endDate
  });
  const today = (options.now ?? nowIso()).slice(0, 10);
  let create = 0;
  let alreadyPresent = 0;
  let manualExceptions = 0;
  let conflicts = 0;
  let pastOccurrences = 0;
  const evidence: Array<Record<string, unknown>> = [];

  for (const item of expanded) {
    if (item.occurrenceDate < today) pastOccurrences += 1;
    const existing = await existingGeneratedEntry(database, rule.id, item.occurrenceKey, item.occurrenceDate);
    if (!existing) {
      create += 1;
      const conflictPreview = await previewPlannedCareConflicts({
        status: "planned",
        startDateTime: item.startDateTime,
        endDateTime: item.endDateTime,
        childIds: rule.childIds
      }, database);
      conflicts += conflictPreview.conflicts.length;
      evidence.push({ occurrenceKey: item.occurrenceKey, conflicts: conflictPreview.fingerprint });
    } else if (
      existing.deleted_at || existing.status !== "planned" ||
      existing.contact_rule_sync_state === "manual_override"
    ) {
      manualExceptions += 1;
      evidence.push({ occurrenceKey: item.occurrenceKey, state: "manual" });
    } else {
      alreadyPresent += 1;
      evidence.push({ occurrenceKey: item.occurrenceKey, state: "existing" });
    }
  }
  const fingerprint = createHash("sha256").update(JSON.stringify({
    ruleId,
    ruleUpdatedAt: rule.updatedAt,
    window,
    evidence
  })).digest("hex");
  return {
    fingerprint,
    ...window,
    create,
    alreadyPresent,
    manualExceptions,
    conflicts,
    pastOccurrences
  };
}
