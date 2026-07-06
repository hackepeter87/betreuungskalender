import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import ICAL from "ical.js";
import type { ApiExternalCalendarSourceKind, ApiExternalCalendarSourceType } from "../../shared/api.js";
import { db } from "../db/connection.js";
import { markClosedMonthsChanged, recordAudit } from "./audit.js";
import { assertActiveChildren, makeId, nowIso, syncJunction } from "./common.js";

const MAX_ICS_BYTES = 1_000_000;
const MAX_ICS_EVENTS = 2_000;
const MAX_TEXT_LENGTH = 10_000;
const MAX_FEED_URL_LENGTH = 2_048;
const FEED_FETCH_TIMEOUT_MS = 10_000;

type ExternalCalendarErrorCode =
  | "external_calendar_invalid"
  | "external_calendar_limit"
  | "external_calendar_fetch_failed"
  | "external_calendar_recurrence_unsupported"
  | "external_calendar_not_found";

export class ExternalCalendarError extends Error {
  constructor(readonly code: ExternalCalendarErrorCode, message: string) {
    super(message);
  }
}

export interface ParsedExternalCalendarEvent {
  icalUid: string;
  recurrenceId: string;
  title: string;
  description?: string;
  startDateTime: string;
  endDateTime: string;
  allDay: boolean;
  location?: string;
  rawHash: string;
}

export interface ExternalCalendarSourceInput {
  name: string;
  color: string;
  sourceType: ApiExternalCalendarSourceType;
  content: string;
}

export interface ExternalCalendarFeedInput {
  name: string;
  color: string;
  sourceType: ApiExternalCalendarSourceType;
  url: string;
}

export interface ExternalCalendarHolidayDeriveInput {
  childIds: string[];
  assignedTo: "father" | "mother" | "shared";
  userEmail: string;
}

function text(value: unknown, limit = MAX_TEXT_LENGTH): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > limit) throw new ExternalCalendarError("external_calendar_limit", "Calendar text exceeds the supported length.");
  return normalized;
}

function iso(value: { toJSDate(): Date; isDate: boolean }): string {
  if (value.isDate) {
    const calendarDate = value as unknown as { year: number; month: number; day: number };
    return new Date(Date.UTC(calendarDate.year, calendarDate.month - 1, calendarDate.day)).toISOString();
  }
  const date = value.toJSDate();
  if (Number.isNaN(date.getTime())) throw new ExternalCalendarError("external_calendar_invalid", "Calendar contains an invalid date.");
  return date.toISOString();
}

export function parseIcs(content: string): ParsedExternalCalendarEvent[] {
  if (Buffer.byteLength(content, "utf8") > MAX_ICS_BYTES) {
    throw new ExternalCalendarError("external_calendar_limit", "Calendar file exceeds the supported size.");
  }
  let component: ICAL.Component;
  try { component = new ICAL.Component(ICAL.parse(content)); } catch {
    throw new ExternalCalendarError("external_calendar_invalid", "Calendar file is malformed.");
  }
  if (component.name !== "vcalendar") throw new ExternalCalendarError("external_calendar_invalid", "Calendar must contain VCALENDAR.");
  const events = component.getAllSubcomponents("vevent");
  if (events.length > MAX_ICS_EVENTS) throw new ExternalCalendarError("external_calendar_limit", "Calendar contains too many events.");
  return events.map((eventComponent) => {
    if (eventComponent.hasProperty("rrule")) throw new ExternalCalendarError("external_calendar_recurrence_unsupported", "Recurring event rules are not supported.");
    const uid = text(eventComponent.getFirstPropertyValue("uid"));
    const start = eventComponent.getFirstPropertyValue("dtstart") as ICAL.Time | null;
    const end = eventComponent.getFirstPropertyValue("dtend") as ICAL.Time | null;
    if (!uid || !start || !end) throw new ExternalCalendarError("external_calendar_invalid", "Every event requires UID, DTSTART, and DTEND.");
    const allDay = start.isDate;
    const startDateTime = iso(start);
    const endDateTime = iso(end);
    if (Date.parse(endDateTime) <= Date.parse(startDateTime)) throw new ExternalCalendarError("external_calendar_invalid", "Event end must be after its start.");
    const recurrence = eventComponent.getFirstPropertyValue("recurrence-id") as ICAL.Time | null;
    const title = text(eventComponent.getFirstPropertyValue("summary"), 500) ?? "Untitled event";
    const description = text(eventComponent.getFirstPropertyValue("description"));
    const location = text(eventComponent.getFirstPropertyValue("location"), 500);
    return {
      icalUid: uid,
      recurrenceId: recurrence ? iso(recurrence) : "",
      title,
      description,
      startDateTime,
      endDateTime,
      allDay,
      location,
      rawHash: createHash("sha256").update(eventComponent.toString()).digest("hex")
    };
  });
}

function dateKey(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function inclusiveEndDateKey(value: string, allDay: boolean): string {
  const date = new Date(value);
  if (allDay) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit - 1) : value;
}

function isBlockedFeedHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) return true;
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const [a = 0, b = 0] = normalized.split(".").map((part) => Number.parseInt(part, 10));
    return a === 0 ||
      a === 10 ||
      a === 127 ||
      a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 ||
      a === 192 && b === 168 ||
      a === 100 && b >= 64 && b <= 127 ||
      a === 198 && (b === 18 || b === 19);
  }
  if (ipVersion === 6) {
    return normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:192.168.");
  }
  return false;
}

export function normalizeExternalCalendarFeedUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_FEED_URL_LENGTH) {
    throw new ExternalCalendarError("external_calendar_invalid", "Calendar feed URL is invalid.");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ExternalCalendarError("external_calendar_invalid", "Calendar feed URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname || isBlockedFeedHost(url.hostname)) {
    throw new ExternalCalendarError("external_calendar_invalid", "Calendar feed URL is invalid.");
  }
  url.hash = "";
  return url.href;
}

export function redactExternalCalendarFeedUrl(input: string): string {
  try {
    const url = new URL(input);
    url.username = "";
    url.password = "";
    url.hash = "";
    url.search = url.search ? "?..." : "";
    return url.href;
  } catch {
    return "invalid-url";
  }
}

export async function fetchExternalCalendarFeedContent(
  input: string,
  fetcher: typeof fetch = fetch
): Promise<string> {
  const url = normalizeExternalCalendarFeedUrl(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      headers: { accept: "text/calendar, text/plain;q=0.8, */*;q=0.1" },
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new ExternalCalendarError("external_calendar_fetch_failed", "Calendar feed could not be fetched.");
    }
    const length = response.headers.get("content-length");
    if (length && Number(length) > MAX_ICS_BYTES) {
      throw new ExternalCalendarError("external_calendar_limit", "Calendar feed exceeds the supported size.");
    }
    const content = await response.text();
    if (Buffer.byteLength(content, "utf8") > MAX_ICS_BYTES) {
      throw new ExternalCalendarError("external_calendar_limit", "Calendar feed exceeds the supported size.");
    }
    return content;
  } catch (error) {
    if (error instanceof ExternalCalendarError) throw error;
    throw new ExternalCalendarError("external_calendar_fetch_failed", "Calendar feed could not be fetched.");
  } finally {
    clearTimeout(timeout);
  }
}

function mapSource(row: Record<string, unknown>) {
  const sourceKind = (row.source_kind === "url" ? "url" : "file") as ApiExternalCalendarSourceKind;
  const feedUrl = typeof row.feed_url === "string" ? row.feed_url : "";
  return {
    id: String(row.id),
    name: String(row.name),
    color: String(row.color),
    visible: Boolean(row.visible),
    sourceType: (row.source_type === "holiday" ? "holiday" : "overlay") as ApiExternalCalendarSourceType,
    sourceKind,
    feedUrlRedacted: sourceKind === "url" && feedUrl ? redactExternalCalendarFeedUrl(feedUrl) : undefined,
    lastImportedAt: String(row.last_imported_at),
    lastRefreshAt: row.last_refresh_at ? String(row.last_refresh_at) : undefined,
    lastRefreshError: row.last_refresh_error ? String(row.last_refresh_error) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function listExternalCalendarSources() {
  return (db.prepare("SELECT * FROM external_calendar_sources ORDER BY name").all() as Record<string, unknown>[]).map(mapSource);
}

export function listExternalCalendarBackupEvents() {
  return db.prepare(`
    SELECT id, source_id AS sourceId, ical_uid AS icalUid,
      recurrence_id AS recurrenceId, title, description,
      start_datetime AS startDateTime, end_datetime AS endDateTime,
      all_day AS allDay, location, raw_hash AS rawHash,
      created_at AS createdAt, updated_at AS updatedAt
    FROM external_calendar_events
    ORDER BY start_datetime, id
  `).all() as Array<Record<string, unknown>>;
}

function getChildIds(id: string): string[] {
  return (db.prepare(`
    SELECT child_id AS childId
    FROM holiday_period_children
    WHERE holiday_period_id = ? AND deleted_at IS NULL
    ORDER BY child_id
  `).all(id) as Array<{ childId: string }>).map((row) => row.childId);
}

function mapHoliday(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    childIds: getChildIds(String(row.id)),
    assignedTo: row.assigned_to as "father" | "mother" | "shared",
    notes: row.notes ? String(row.notes) : undefined,
    sourceExternalCalendarSourceId: row.source_external_calendar_source_id ? String(row.source_external_calendar_source_id) : undefined,
    sourceExternalCalendarEventId: row.source_external_calendar_event_id ? String(row.source_external_calendar_event_id) : undefined,
    createdBy: String(row.created_by),
    updatedBy: String(row.updated_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function writeEvents(sourceId: string, events: ParsedExternalCalendarEvent[], timestamp: string) {
  const retained = new Set(events.map((event) => `${event.icalUid}\u0000${event.recurrenceId}`));
  const upsert = db.prepare(`
    INSERT INTO external_calendar_events (id, source_id, ical_uid, recurrence_id, title, description, start_datetime, end_datetime, all_day, location, raw_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, ical_uid, recurrence_id) DO UPDATE SET
      title = excluded.title, description = excluded.description, start_datetime = excluded.start_datetime,
      end_datetime = excluded.end_datetime, all_day = excluded.all_day, location = excluded.location,
      raw_hash = excluded.raw_hash, updated_at = excluded.updated_at
  `);
  for (const event of events) upsert.run(randomUUID(), sourceId, event.icalUid, event.recurrenceId, event.title, event.description ?? null, event.startDateTime, event.endDateTime, Number(event.allDay), event.location ?? null, event.rawHash, timestamp, timestamp);
  const existing = db.prepare("SELECT ical_uid, recurrence_id FROM external_calendar_events WHERE source_id = ?").all(sourceId) as Array<{ ical_uid: string; recurrence_id: string }>;
  const remove = db.prepare("DELETE FROM external_calendar_events WHERE source_id = ? AND ical_uid = ? AND recurrence_id = ?");
  for (const item of existing) if (!retained.has(`${item.ical_uid}\u0000${item.recurrence_id}`)) remove.run(sourceId, item.ical_uid, item.recurrence_id);
}

export function importExternalCalendar(input: ExternalCalendarSourceInput, sourceId?: string) {
  const events = parseIcs(input.content);
  const timestamp = nowIso();
  const id = sourceId ?? randomUUID();
  db.transaction(() => {
    if (sourceId) {
      const changed = db.prepare("UPDATE external_calendar_sources SET name = ?, color = ?, source_type = ?, source_kind = 'file', feed_url = NULL, last_refresh_at = NULL, last_refresh_error = NULL, last_imported_at = ?, updated_at = ? WHERE id = ?").run(input.name, input.color, input.sourceType, timestamp, timestamp, id);
      if (!changed.changes) throw new ExternalCalendarError("external_calendar_not_found", "External calendar source was not found.");
    } else {
      db.prepare("INSERT INTO external_calendar_sources (id, name, color, visible, source_type, source_kind, feed_url, last_imported_at, created_at, updated_at) VALUES (?, ?, ?, 1, ?, 'file', NULL, ?, ?, ?)").run(id, input.name, input.color, input.sourceType, timestamp, timestamp, timestamp);
    }
    writeEvents(id, events, timestamp);
  })();
  return { source: mapSource(db.prepare("SELECT * FROM external_calendar_sources WHERE id = ?").get(id) as Record<string, unknown>), importedEvents: events.length };
}

export async function importExternalCalendarFeed(input: ExternalCalendarFeedInput, sourceId?: string) {
  const url = normalizeExternalCalendarFeedUrl(input.url);
  const content = await fetchExternalCalendarFeedContent(url);
  const events = parseIcs(content);
  const timestamp = nowIso();
  const id = sourceId ?? randomUUID();
  db.transaction(() => {
    if (sourceId) {
      const changed = db.prepare(`
        UPDATE external_calendar_sources
        SET name = ?, color = ?, source_type = ?, source_kind = 'url',
          feed_url = ?, last_imported_at = ?, last_refresh_at = ?,
          last_refresh_error = NULL, updated_at = ?
        WHERE id = ?
      `).run(input.name, input.color, input.sourceType, url, timestamp, timestamp, timestamp, id);
      if (!changed.changes) throw new ExternalCalendarError("external_calendar_not_found", "External calendar source was not found.");
    } else {
      db.prepare(`
        INSERT INTO external_calendar_sources (
          id, name, color, visible, source_type, source_kind, feed_url,
          last_imported_at, last_refresh_at, last_refresh_error, created_at, updated_at
        ) VALUES (?, ?, ?, 1, ?, 'url', ?, ?, ?, NULL, ?, ?)
      `).run(id, input.name, input.color, input.sourceType, url, timestamp, timestamp, timestamp, timestamp);
    }
    writeEvents(id, events, timestamp);
  })();
  return { source: mapSource(db.prepare("SELECT * FROM external_calendar_sources WHERE id = ?").get(id) as Record<string, unknown>), importedEvents: events.length };
}

export async function refreshExternalCalendarFeed(id: string) {
  const current = db.prepare("SELECT * FROM external_calendar_sources WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!current) throw new ExternalCalendarError("external_calendar_not_found", "External calendar source was not found.");
  if (current.source_kind !== "url" || typeof current.feed_url !== "string") {
    throw new ExternalCalendarError("external_calendar_invalid", "External calendar source is not a URL feed.");
  }
  const timestamp = nowIso();
  try {
    const content = await fetchExternalCalendarFeedContent(current.feed_url);
    const events = parseIcs(content);
    db.transaction(() => {
      db.prepare(`
        UPDATE external_calendar_sources
        SET last_imported_at = ?, last_refresh_at = ?, last_refresh_error = NULL, updated_at = ?
        WHERE id = ?
      `).run(timestamp, timestamp, timestamp, id);
      writeEvents(id, events, timestamp);
    })();
    return { source: mapSource(db.prepare("SELECT * FROM external_calendar_sources WHERE id = ?").get(id) as Record<string, unknown>), importedEvents: events.length };
  } catch (error) {
    db.prepare("UPDATE external_calendar_sources SET last_refresh_at = ?, last_refresh_error = ?, updated_at = ? WHERE id = ?").run(timestamp, error instanceof ExternalCalendarError ? error.code : "external_calendar_fetch_failed", timestamp, id);
    throw error;
  }
}

export function updateExternalCalendarSource(id: string, input: { name?: string; color?: string; visible?: boolean; sourceType?: ApiExternalCalendarSourceType }) {
  const current = db.prepare("SELECT * FROM external_calendar_sources WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!current) throw new ExternalCalendarError("external_calendar_not_found", "External calendar source was not found.");
  db.prepare("UPDATE external_calendar_sources SET name = ?, color = ?, visible = ?, source_type = ?, updated_at = ? WHERE id = ?").run(input.name ?? current.name, input.color ?? current.color, input.visible === undefined ? current.visible : Number(input.visible), input.sourceType ?? current.source_type ?? "overlay", nowIso(), id);
  return mapSource(db.prepare("SELECT * FROM external_calendar_sources WHERE id = ?").get(id) as Record<string, unknown>);
}

export function deleteExternalCalendarSource(id: string): boolean {
  return db.prepare("DELETE FROM external_calendar_sources WHERE id = ?").run(id).changes > 0;
}

export function visibleExternalCalendarEvents(from: string, to: string) {
  return db.prepare(`
    SELECT e.id, e.source_id AS sourceId, s.name AS sourceName, s.color AS sourceColor, e.title, e.description,
      e.start_datetime AS startDateTime, e.end_datetime AS endDateTime, e.all_day AS allDay, e.location
    FROM external_calendar_events e JOIN external_calendar_sources s ON s.id = e.source_id
    WHERE s.visible = 1 AND e.start_datetime < ? AND e.end_datetime > ? ORDER BY e.start_datetime, e.title
  `).all(to, from) as Array<Record<string, unknown>>;
}

export function deriveHolidayPeriodsFromExternalCalendar(sourceId: string, input: ExternalCalendarHolidayDeriveInput) {
  const sourceRow = db.prepare("SELECT * FROM external_calendar_sources WHERE id = ?").get(sourceId) as Record<string, unknown> | undefined;
  if (!sourceRow) throw new ExternalCalendarError("external_calendar_not_found", "External calendar source was not found.");
  const source = mapSource(sourceRow);
  if (source.sourceType !== "holiday") {
    throw new ExternalCalendarError("external_calendar_invalid", "Only holiday calendar sources can derive holiday periods.");
  }

  const events = db.prepare(`
    SELECT id, title, description, start_datetime AS startDateTime,
      end_datetime AS endDateTime, all_day AS allDay
    FROM external_calendar_events
    WHERE source_id = ?
    ORDER BY start_datetime, title
  `).all(sourceId) as Array<{
    id: string;
    title: string;
    description: string | null;
    startDateTime: string;
    endDateTime: string;
    allDay: number;
  }>;

  const existing = new Set((db.prepare(`
    SELECT source_external_calendar_event_id AS eventId
    FROM holiday_periods
    WHERE source_external_calendar_source_id = ?
      AND source_external_calendar_event_id IS NOT NULL
      AND deleted_at IS NULL
  `).all(sourceId) as Array<{ eventId: string }>).map((row) => row.eventId));

  const timestamp = nowIso();
  const createdIds: string[] = [];
  let skippedExisting = 0;
  let skippedUnsupported = 0;

  db.transaction(() => {
    assertActiveChildren(input.childIds);
    for (const event of events) {
      if (existing.has(event.id)) {
        skippedExisting += 1;
        continue;
      }
      if (!event.allDay) {
        skippedUnsupported += 1;
        continue;
      }
      const startDate = dateKey(event.startDateTime);
      const endDate = inclusiveEndDateKey(event.endDateTime, true);
      if (endDate < startDate) {
        skippedUnsupported += 1;
        continue;
      }

      const id = makeId("holiday");
      const noteParts = [
        `Aus importierter Ferienquelle "${source.name}" abgeleitet.`,
        event.description ? truncate(event.description, 3500) : undefined
      ].filter(Boolean);
      db.prepare(`
        INSERT INTO holiday_periods (
          id, name, start_date, end_date, assigned_to, notes,
          source_external_calendar_source_id, source_external_calendar_event_id,
          created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        truncate(event.title, 200),
        startDate,
        endDate,
        input.assignedTo,
        noteParts.join("\n\n") || null,
        sourceId,
        event.id,
        input.userEmail,
        input.userEmail,
        timestamp,
        timestamp
      );
      syncJunction("holiday_period_children", "holiday_period_id", id, input.childIds, timestamp);
      const holiday = mapHoliday(db.prepare("SELECT * FROM holiday_periods WHERE id = ?").get(id) as Record<string, unknown>);
      recordAudit({
        userEmail: input.userEmail,
        entityType: "holiday_period",
        entityId: id,
        action: "created",
        newValue: holiday
      });
      markClosedMonthsChanged(input.userEmail, "holiday_period", id, startDate, endDate, timestamp);
      createdIds.push(id);
    }
  })();

  const holidays = createdIds.map((id) => mapHoliday(db.prepare("SELECT * FROM holiday_periods WHERE id = ?").get(id) as Record<string, unknown>));
  return {
    source,
    created: holidays.length,
    skippedExisting,
    skippedUnsupported,
    holidays
  };
}
