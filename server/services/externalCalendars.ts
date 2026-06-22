import { createHash, randomUUID } from "node:crypto";
import ICAL from "ical.js";
import { db } from "../db/connection.js";
import { nowIso } from "./common.js";

const MAX_ICS_BYTES = 1_000_000;
const MAX_ICS_EVENTS = 2_000;
const MAX_TEXT_LENGTH = 10_000;

export class ExternalCalendarError extends Error {
  constructor(readonly code: "external_calendar_invalid" | "external_calendar_limit" | "external_calendar_recurrence_unsupported" | "external_calendar_not_found", message: string) {
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

export interface ExternalCalendarSourceInput { name: string; color: string; content: string }

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

function mapSource(row: Record<string, unknown>) {
  return { id: String(row.id), name: String(row.name), color: String(row.color), visible: Boolean(row.visible), lastImportedAt: String(row.last_imported_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
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
      const changed = db.prepare("UPDATE external_calendar_sources SET name = ?, color = ?, last_imported_at = ?, updated_at = ? WHERE id = ?").run(input.name, input.color, timestamp, timestamp, id);
      if (!changed.changes) throw new ExternalCalendarError("external_calendar_not_found", "External calendar source was not found.");
    } else {
      db.prepare("INSERT INTO external_calendar_sources (id, name, color, visible, last_imported_at, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)").run(id, input.name, input.color, timestamp, timestamp, timestamp);
    }
    writeEvents(id, events, timestamp);
  })();
  return { source: mapSource(db.prepare("SELECT * FROM external_calendar_sources WHERE id = ?").get(id) as Record<string, unknown>), importedEvents: events.length };
}

export function updateExternalCalendarSource(id: string, input: { name?: string; color?: string; visible?: boolean }) {
  const current = db.prepare("SELECT * FROM external_calendar_sources WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!current) throw new ExternalCalendarError("external_calendar_not_found", "External calendar source was not found.");
  db.prepare("UPDATE external_calendar_sources SET name = ?, color = ?, visible = ?, updated_at = ? WHERE id = ?").run(input.name ?? current.name, input.color ?? current.color, input.visible === undefined ? current.visible : Number(input.visible), nowIso(), id);
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
