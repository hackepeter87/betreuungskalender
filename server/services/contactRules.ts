import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
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
import { db as defaultDb } from "../db/connection.js";
import { recordAudit } from "./audit.js";
import { bool, makeId, nowIso } from "./common.js";
import { previewPlannedCareConflicts } from "./careConflicts.js";

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
  database?: Database.Database;
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

function assertActiveRuleChildren(database: Database.Database, childIds: string[]): void {
  const uniqueIds = [...new Set(childIds)];
  if (!uniqueIds.length) {
    throw new Error("Mindestens ein Kind ist erforderlich.");
  }
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const row = database.prepare(`
    SELECT COUNT(*) AS count
    FROM children
    WHERE deleted_at IS NULL AND id IN (${placeholders})
  `).get(...uniqueIds) as { count: number };
  if (row.count !== uniqueIds.length) {
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

export function contactRuleChildIds(ruleId: string, database = defaultDb): string[] {
  return (database.prepare(`
    SELECT child_id AS childId
    FROM contact_rule_children
    WHERE contact_rule_id = ? AND deleted_at IS NULL
    ORDER BY child_id
  `).all(ruleId) as Array<{ childId: string }>).map((row) => row.childId);
}

export function getContactRule(ruleId: string, database = defaultDb): ApiContactRule | undefined {
  const row = database.prepare(`
    SELECT *
    FROM contact_rules
    WHERE id = ? AND deleted_at IS NULL
  `).get(ruleId) as ContactRuleRow | undefined;
  return row ? mapContactRule(row, contactRuleChildIds(ruleId, database)) : undefined;
}

export function upsertContactRuleFromPattern(
  pattern: ContactRulePatternInput,
  database = defaultDb
): ApiContactRule {
  const recurrence = legacyRecurrenceForPattern();
  const segments = legacySegmentsForPattern(pattern);
  database.prepare(`
    INSERT INTO contact_rules (
      id, name, start_date, timezone, recurrence_json, segments_json,
      sync_horizon_months, responsible_party_id, active, source_contact_pattern_id,
      created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      start_date = excluded.start_date,
      timezone = excluded.timezone,
      recurrence_json = excluded.recurrence_json,
      segments_json = excluded.segments_json,
      responsible_party_id = excluded.responsible_party_id,
      active = excluded.active,
      source_contact_pattern_id = excluded.source_contact_pattern_id,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `).run(
    pattern.id,
    pattern.name,
    pattern.startDate,
    "Europe/Berlin",
    JSON.stringify(recurrence),
    JSON.stringify(segments),
    12,
    pattern.responsiblePartyId ?? null,
    Number(pattern.active),
    pattern.id,
    pattern.createdBy,
    pattern.updatedBy,
    pattern.createdAt,
    pattern.updatedAt
  );

  const timestamp = pattern.updatedAt;
  const existing = database.prepare(`
    SELECT child_id AS childId, deleted_at AS deletedAt
    FROM contact_rule_children
    WHERE contact_rule_id = ?
  `).all(pattern.id) as Array<{ childId: string; deletedAt: string | null }>;
  const selected = new Set(pattern.childIds);
  for (const link of existing) {
    if (selected.has(link.childId)) {
      database.prepare(`
        UPDATE contact_rule_children
        SET deleted_at = NULL, updated_at = ?
        WHERE contact_rule_id = ? AND child_id = ?
      `).run(timestamp, pattern.id, link.childId);
      selected.delete(link.childId);
    } else if (!link.deletedAt) {
      database.prepare(`
        UPDATE contact_rule_children
        SET deleted_at = ?, updated_at = ?
        WHERE contact_rule_id = ? AND child_id = ?
      `).run(timestamp, timestamp, pattern.id, link.childId);
    }
  }
  const insert = database.prepare(`
    INSERT INTO contact_rule_children (contact_rule_id, child_id, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  for (const childId of selected) insert.run(pattern.id, childId, timestamp, timestamp);

  const rule = getContactRule(pattern.id, database);
  if (!rule) throw new Error("Umgangsregel konnte nicht geladen werden.");
  return rule;
}

export function upsertContactRule(input: {
  id: string;
  rule: ContactRuleInput;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  database?: Database.Database;
}): ApiContactRule {
  const database = input.database ?? defaultDb;
  database.prepare(`
    INSERT INTO contact_rules (
      id, name, start_date, end_date, timezone, recurrence_json, segments_json,
      sync_horizon_months, responsible_party_id, active, source_contact_pattern_id,
      created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      timezone = excluded.timezone,
      recurrence_json = excluded.recurrence_json,
      segments_json = excluded.segments_json,
      sync_horizon_months = excluded.sync_horizon_months,
      responsible_party_id = excluded.responsible_party_id,
      active = excluded.active,
      source_contact_pattern_id = excluded.source_contact_pattern_id,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `).run(
    input.id,
    input.rule.name,
    input.rule.startDate,
    input.rule.endDate ?? null,
    input.rule.timezone,
    JSON.stringify(input.rule.recurrence),
    JSON.stringify(input.rule.segments),
    input.rule.syncHorizonMonths,
    input.rule.responsiblePartyId ?? null,
    Number(input.rule.active),
    input.rule.sourceContactPatternId ?? null,
    input.createdBy,
    input.updatedBy,
    input.createdAt,
    input.updatedAt
  );

  const existing = database.prepare(`
    SELECT child_id AS childId, deleted_at AS deletedAt
    FROM contact_rule_children
    WHERE contact_rule_id = ?
  `).all(input.id) as Array<{ childId: string; deletedAt: string | null }>;
  const selected = new Set(input.rule.childIds);
  for (const link of existing) {
    if (selected.has(link.childId)) {
      database.prepare(`
        UPDATE contact_rule_children
        SET deleted_at = NULL, updated_at = ?
        WHERE contact_rule_id = ? AND child_id = ?
      `).run(input.updatedAt, input.id, link.childId);
      selected.delete(link.childId);
    } else if (!link.deletedAt) {
      database.prepare(`
        UPDATE contact_rule_children
        SET deleted_at = ?, updated_at = ?
        WHERE contact_rule_id = ? AND child_id = ?
      `).run(input.updatedAt, input.updatedAt, input.id, link.childId);
    }
  }
  const insert = database.prepare(`
    INSERT INTO contact_rule_children (contact_rule_id, child_id, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  for (const childId of selected) insert.run(input.id, childId, input.updatedAt, input.updatedAt);

  const rule = getContactRule(input.id, database);
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

function existingGeneratedEntry(
  database: Database.Database,
  ruleId: string,
  occurrenceKey: string,
  legacyOccurrenceDate: string
): ExistingGeneratedRow | undefined {
  return database.prepare(`
    SELECT id, status, contact_rule_sync_state, deleted_at
    FROM care_entries
    WHERE (
        (contact_rule_id = ? AND contact_rule_occurrence_key = ?)
        OR (generated_by_pattern_id = ? AND rule_occurrence_date = ?)
      )
    ORDER BY deleted_at IS NULL DESC, updated_at DESC
    LIMIT 1
  `).get(ruleId, occurrenceKey, ruleId, legacyOccurrenceDate) as ExistingGeneratedRow | undefined;
}

function insertGeneratedEntry(input: {
  database: Database.Database;
  rule: ApiContactRule;
  expanded: ExpandedContactRuleEntry;
  timestamp: string;
  userEmail: string;
  confirmationSuppressed?: boolean;
}): void {
  const id = makeId("entry");
  const durationMinutes = Math.round(
    (Date.parse(input.expanded.endDateTime) - Date.parse(input.expanded.startDateTime)) / 60000
  );
  input.database.prepare(`
    INSERT INTO care_entries (
      id, generated_by_pattern_id, rule_occurrence_date,
      contact_rule_id, contact_rule_segment_id, contact_rule_occurrence_key,
      responsible_party_id, contact_rule_sync_state,
      start_datetime, end_datetime, status, care_scope, cancellation_reason,
      overnight, school_handover, holiday, weekend, additional_care, location,
      custom_location, handover_from, handover_to, notes, evidence_reference,
      has_evidence, duration_minutes, is_contact_time, created_by, updated_by,
      created_at, updated_at, confirmation_suppressed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.rule.sourceContactPatternId ?? input.rule.id,
    input.expanded.occurrenceDate,
    input.rule.id,
    input.expanded.segmentId,
    input.expanded.occurrenceKey,
    input.rule.responsiblePartyId ?? null,
    "generated",
    input.expanded.startDateTime,
    input.expanded.endDateTime,
    "planned",
    durationMinutes >= 12 * 60 ? "overnight" : durationMinutes >= 5 * 60 ? "half_day" : "hourly",
    null,
    Number(durationMinutes >= 12 * 60),
    0,
    0,
    Number(["FR", "SA", "SU"].includes(weekdayFor(input.expanded.occurrenceDate))),
    0,
    null,
    null,
    null,
    null,
    null,
    null,
    0,
    durationMinutes,
    Number(durationMinutes < 120),
    input.userEmail,
    input.userEmail,
    input.timestamp,
    input.timestamp,
    Number(input.confirmationSuppressed)
  );

  const childInsert = input.database.prepare(`
    INSERT INTO care_entry_children (care_entry_id, child_id, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  for (const childId of input.rule.childIds) childInsert.run(id, childId, input.timestamp, input.timestamp);

  if (input.database === defaultDb) {
    recordAudit({
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

function syncGeneratedEntryChildren(input: {
  database: Database.Database;
  entryId: string;
  childIds: string[];
  timestamp: string;
}): void {
  const existing = input.database.prepare(`
    SELECT child_id AS childId, deleted_at AS deletedAt
    FROM care_entry_children
    WHERE care_entry_id = ?
  `).all(input.entryId) as Array<{ childId: string; deletedAt: string | null }>;
  const selected = new Set(input.childIds);

  for (const link of existing) {
    if (selected.has(link.childId)) {
      input.database.prepare(`
        UPDATE care_entry_children
        SET deleted_at = NULL, updated_at = ?
        WHERE care_entry_id = ? AND child_id = ?
      `).run(input.timestamp, input.entryId, link.childId);
      selected.delete(link.childId);
    } else if (!link.deletedAt) {
      input.database.prepare(`
        UPDATE care_entry_children
        SET deleted_at = ?, updated_at = ?
        WHERE care_entry_id = ? AND child_id = ?
      `).run(input.timestamp, input.timestamp, input.entryId, link.childId);
    }
  }

  const insert = input.database.prepare(`
    INSERT INTO care_entry_children (care_entry_id, child_id, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  for (const childId of selected) {
    insert.run(input.entryId, childId, input.timestamp, input.timestamp);
  }
}

function updateGeneratedEntry(input: {
  database: Database.Database;
  id: string;
  rule: ApiContactRule;
  expanded: ExpandedContactRuleEntry;
  timestamp: string;
  userEmail: string;
}): void {
  const durationMinutes = Math.round(
    (Date.parse(input.expanded.endDateTime) - Date.parse(input.expanded.startDateTime)) / 60000
  );
  input.database.prepare(`
    UPDATE care_entries
    SET generated_by_pattern_id = ?,
        rule_occurrence_date = ?,
        contact_rule_id = ?,
        contact_rule_segment_id = ?,
        contact_rule_occurrence_key = ?,
        responsible_party_id = ?,
        contact_rule_sync_state = 'generated',
        start_datetime = ?,
        end_datetime = ?,
        care_scope = ?,
        overnight = ?,
        weekend = ?,
        duration_minutes = ?,
        is_contact_time = ?,
        updated_by = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    input.rule.sourceContactPatternId ?? input.rule.id,
    input.expanded.occurrenceDate,
    input.rule.id,
    input.expanded.segmentId,
    input.expanded.occurrenceKey,
    input.rule.responsiblePartyId ?? null,
    input.expanded.startDateTime,
    input.expanded.endDateTime,
    durationMinutes >= 12 * 60 ? "overnight" : durationMinutes >= 5 * 60 ? "half_day" : "hourly",
    Number(durationMinutes >= 12 * 60),
    Number(["FR", "SA", "SU"].includes(weekdayFor(input.expanded.occurrenceDate))),
    durationMinutes,
    Number(durationMinutes < 120),
    input.userEmail,
    input.timestamp,
    input.id
  );
  syncGeneratedEntryChildren({
    database: input.database,
    entryId: input.id,
    childIds: input.rule.childIds,
    timestamp: input.timestamp
  });
}

export function syncContactRule(ruleId: string, options: ContactRuleSyncOptions): ApiContactRuleSyncSummary {
  const database = options.database ?? defaultDb;
  const rule = getContactRule(ruleId, database);
  if (!rule) throw new Error("Umgangsregel wurde nicht gefunden.");
  assertActiveRuleChildren(database, rule.childIds);

  const window = syncWindow(rule, options);
  if (options.previewFingerprint) {
    const preview = previewContactRuleSync(ruleId, {
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
    const existing = existingGeneratedEntry(database, rule.id, item.occurrenceKey, item.occurrenceDate);
    if (!existing) {
      insertGeneratedEntry({
        database,
        rule,
        expanded: item,
        timestamp,
        userEmail: options.userEmail,
        confirmationSuppressed: Boolean(
          options.suppressPastConfirmations &&
          Date.parse(item.endDateTime) < Date.parse(options.now ?? timestamp)
        )
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
    updateGeneratedEntry({ database, id: existing.id, rule, expanded: item, timestamp, userEmail: options.userEmail });
    summary.updated += 1;
  }

  return summary;
}

export function isContactRuleSyncPreviewChangedError(error: unknown): boolean {
  return error instanceof ContactRuleSyncPreviewChangedError ||
    (error instanceof Error && (error as { code?: string }).code === "contact_rule_sync_preview_changed");
}

export function previewContactRuleSync(
  ruleId: string,
  options: Pick<ContactRuleSyncOptions, "startDate" | "endDate" | "now" | "database">
): ApiContactRuleSyncPreview {
  const database = options.database ?? defaultDb;
  const rule = getContactRule(ruleId, database);
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
    const existing = existingGeneratedEntry(database, rule.id, item.occurrenceKey, item.occurrenceDate);
    if (!existing) {
      create += 1;
      const conflictPreview = previewPlannedCareConflicts({
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
