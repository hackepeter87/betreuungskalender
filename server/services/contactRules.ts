import type Database from "better-sqlite3";
import type {
  ApiContactRule,
  ApiContactRuleSegment,
  ApiContactRuleSyncSummary,
  ContactRuleMonthlyOrdinal,
  ContactRuleRecurrence,
  ContactRuleWeekday
} from "../../shared/api.js";
import { db as defaultDb } from "../db/connection.js";
import { recordAudit } from "./audit.js";
import { bool, makeId, nowIso } from "./common.js";

const weekdayIndexes: Record<ContactRuleWeekday, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6
};

const indexWeekdays: ContactRuleWeekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

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
}

export interface ExpandedContactRuleEntry {
  occurrenceDate: string;
  occurrenceKey: string;
  segmentId: string;
  startDateTime: string;
  endDateTime: string;
}

function optional<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

function differenceInDays(first: string, second: string): number {
  const firstDate = new Date(`${first}T12:00:00Z`);
  const secondDate = new Date(`${second}T12:00:00Z`);
  return Math.round((secondDate.getTime() - firstDate.getTime()) / 86_400_000);
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

function monthsBetween(first: string, second: string): number {
  const [firstYear = 0, firstMonth = 1] = first.split("-").map(Number);
  const [secondYear = 0, secondMonth = 1] = second.split("-").map(Number);
  return (secondYear - firstYear) * 12 + (secondMonth - firstMonth);
}

function dateInMonth(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day, 12)).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
}

function weekdayFor(date: string): ContactRuleWeekday {
  return indexWeekdays[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? "SU";
}

function startOfWeek(date: string): string {
  return addDays(date, -new Date(`${date}T12:00:00Z`).getUTCDay());
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function orderedUnique<T>(values: T[]): T[] {
  return [...new Set(values)];
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

function monthlyOrdinalDate(
  year: number,
  month: number,
  weekday: ContactRuleWeekday,
  ordinal: ContactRuleMonthlyOrdinal
): string | undefined {
  const targetWeekday = weekdayIndexes[weekday];
  if (ordinal === -1) {
    for (let day = daysInMonth(year, month); day >= 1; day -= 1) {
      const date = dateInMonth(year, month, day);
      if (new Date(`${date}T12:00:00Z`).getUTCDay() === targetWeekday) return date;
    }
    return undefined;
  }

  let count = 0;
  for (let day = 1; day <= daysInMonth(year, month); day += 1) {
    const date = dateInMonth(year, month, day);
    if (new Date(`${date}T12:00:00Z`).getUTCDay() !== targetWeekday) continue;
    count += 1;
    if (count === ordinal) return date;
  }
  return undefined;
}

function weeklyDates(
  recurrence: Extract<ContactRuleRecurrence, { kind: "weekly" }>,
  anchorDate: string,
  startDate: string,
  endDate: string
): string[] {
  const result: string[] = [];
  const anchorWeek = startOfWeek(anchorDate);
  let current = startDate;
  while (current <= endDate) {
    const weekOffset = Math.floor(differenceInDays(anchorWeek, startOfWeek(current)) / 7);
    if (
      weekOffset >= 0 &&
      weekOffset % recurrence.intervalWeeks === 0 &&
      recurrence.weekdays.includes(weekdayFor(current))
    ) {
      result.push(current);
    }
    current = addDays(current, 1);
  }
  return result;
}

function monthlyDates(
  recurrence: Extract<ContactRuleRecurrence, { kind: "monthlyByWeekday" }>,
  anchorDate: string,
  startDate: string,
  endDate: string
): string[] {
  const result: string[] = [];
  let currentMonth = firstDayOfMonth(startDate);
  const endMonth = firstDayOfMonth(endDate);
  const anchorMonth = firstDayOfMonth(anchorDate);

  while (currentMonth <= endMonth) {
    const offset = monthsBetween(anchorMonth, currentMonth);
    if (offset >= 0 && offset % recurrence.intervalMonths === 0) {
      const [year = 0, month = 1] = currentMonth.split("-").map(Number);
      for (const ordinal of recurrence.ordinals) {
        for (const weekday of recurrence.weekdays) {
          const date = monthlyOrdinalDate(year, month, weekday, ordinal);
          if (date && date >= startDate && date <= endDate) result.push(date);
        }
      }
    }
    currentMonth = addMonths(currentMonth, 1);
  }
  return orderedUnique(result).sort();
}

export function expandContactRule(input: {
  startDate: string;
  endDate?: string;
  recurrence: ContactRuleRecurrence;
  segments: ApiContactRuleSegment[];
  active: boolean;
  childIds: string[];
  rangeStart: string;
  rangeEnd: string;
}): ExpandedContactRuleEntry[] {
  if (!input.active || !input.childIds.length || !input.segments.length) return [];
  const rangeStart = input.rangeStart > input.startDate ? input.rangeStart : input.startDate;
  const rangeEnd = input.endDate && input.endDate < input.rangeEnd ? input.endDate : input.rangeEnd;
  if (rangeEnd < rangeStart) return [];

  const occurrenceDates =
    input.recurrence.kind === "weekly"
      ? weeklyDates(input.recurrence, input.startDate, rangeStart, rangeEnd)
      : monthlyDates(input.recurrence, input.startDate, rangeStart, rangeEnd);

  const entries: ExpandedContactRuleEntry[] = [];
  for (const occurrenceDate of occurrenceDates) {
    for (const segment of input.segments) {
      const startDate = addDays(occurrenceDate, segment.startDayOffset);
      const endDate = addDays(occurrenceDate, segment.endDayOffset);
      if (endDate < input.rangeStart || startDate > input.rangeEnd) continue;
      entries.push({
        occurrenceDate,
        occurrenceKey: `${occurrenceDate}:${segment.id}`,
        segmentId: segment.id,
        startDateTime: `${startDate}T${segment.startTime}`,
        endDateTime: `${endDate}T${segment.endTime}`
      });
    }
  }
  return entries.sort((a, b) => a.startDateTime.localeCompare(b.startDateTime));
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
      sync_horizon_months, active, source_contact_pattern_id,
      created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      start_date = excluded.start_date,
      timezone = excluded.timezone,
      recurrence_json = excluded.recurrence_json,
      segments_json = excluded.segments_json,
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
  const currentMonth = firstDayOfMonth((options.now ?? nowIso()).slice(0, 10));
  const startDate = options.startDate ?? (rule.startDate > currentMonth ? rule.startDate : currentMonth);
  const defaultEnd = addDays(addMonths(startDate, rule.syncHorizonMonths), -1);
  const endDate = options.endDate ?? (rule.endDate && rule.endDate < defaultEnd ? rule.endDate : defaultEnd);
  return { startDate, endDate };
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
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    input.timestamp
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
      insertGeneratedEntry({ database, rule, expanded: item, timestamp, userEmail: options.userEmail });
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
