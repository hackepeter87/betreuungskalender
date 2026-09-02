import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import ICAL from "ical.js";
import ipaddr from "ipaddr.js";
import type { ApiExternalCalendarSourceKind, ApiExternalCalendarSourceType } from "../../shared/api.js";
import type { DatabaseExecutor, PersistenceRuntime } from "../db/runtime.js";
import { makeId, nowIso } from "./common.js";
import {
  assertPersistedChildren,
  markDomainClosedMonthsChanged,
  recordDomainAudit,
  syncPersistedChildJunction
} from "./domainPersistence.js";

const MAX_ICS_BYTES = 1_000_000;
const MAX_ICS_EVENTS = 2_000;
const MAX_TEXT_LENGTH = 10_000;
const MAX_FEED_URL_LENGTH = 2_048;
const FEED_FETCH_TIMEOUT_MS = 10_000;
const MAX_FEED_REDIRECTS = 5;

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

function normalizedIpAddress(input: string): ipaddr.IPv4 | ipaddr.IPv6 | undefined {
  try {
    const address = ipaddr.parse(input);
    if (address.kind() !== "ipv6") return address;
    const ipv6Address = address as ipaddr.IPv6;
    return ipv6Address.isIPv4MappedAddress() ? ipv6Address.toIPv4Address() : ipv6Address;
  } catch {
    return undefined;
  }
}

function isPublicIpAddress(input: string): boolean {
  return normalizedIpAddress(input)?.range() === "unicast";
}

function isBlockedFeedHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) return true;
  return isIP(normalized) !== 0 && !isPublicIpAddress(normalized);
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

export interface ExternalCalendarResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface ExternalCalendarResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  cancel(): void;
}

export interface ExternalCalendarFetchDependencies {
  resolve(hostname: string): Promise<ExternalCalendarResolvedAddress[]>;
  request(
    url: URL,
    address: ExternalCalendarResolvedAddress,
    signal: AbortSignal
  ): Promise<ExternalCalendarResponse>;
  timeoutMs?: number;
}

function pinnedLookup(address: ExternalCalendarResolvedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [address]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

const defaultFetchDependencies: ExternalCalendarFetchDependencies = {
  async resolve(hostname) {
    const literal = hostname.replace(/^\[/, "").replace(/\]$/, "");
    const family = isIP(literal);
    if (family === 4 || family === 6) return [{ address: literal, family }];
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.flatMap(({ address, family }) =>
      family === 4 || family === 6 ? [{ address, family }] : []);
  },
  request(url, address, signal) {
    return new Promise((resolve, reject) => {
      const request = httpsRequest(url, {
        headers: {
          accept: "text/calendar, text/plain;q=0.8, */*;q=0.1",
          "accept-encoding": "gzip, deflate, br"
        },
        lookup: pinnedLookup(address),
        signal
      }, (response) => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
          cancel: () => response.destroy()
        });
      });
      request.once("error", reject);
      request.end();
    });
  }
};

function singleHeader(headers: ExternalCalendarResponse["headers"], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function resolvePublicAddress(
  url: URL,
  dependencies: ExternalCalendarFetchDependencies,
  signal: AbortSignal
): Promise<ExternalCalendarResolvedAddress> {
  const addresses = await abortable(
    dependencies.resolve(url.hostname.replace(/^\[/, "").replace(/\]$/, "")),
    signal
  );
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new ExternalCalendarError("external_calendar_fetch_failed", "Calendar feed could not be fetched.");
  }
  return addresses[0] as ExternalCalendarResolvedAddress;
}

async function* limitedByteStream(
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal
): AsyncGenerator<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  let receivedBytes = 0;
  try {
    while (true) {
      const item = await abortable(iterator.next(), signal);
      if (item.done) return;
      const chunk = Buffer.from(item.value);
      receivedBytes += chunk.byteLength;
      if (receivedBytes > MAX_ICS_BYTES) {
        throw new ExternalCalendarError("external_calendar_limit", "Calendar feed exceeds the supported size.");
      }
      yield chunk;
    }
  } finally {
    if (!signal.aborted) await iterator.return?.();
  }
}

function decodedBody(response: ExternalCalendarResponse, signal: AbortSignal): AsyncIterable<Uint8Array> {
  const encoding = singleHeader(response.headers, "content-encoding")?.toLowerCase().trim();
  const source = limitedByteStream(response.body, signal);
  if (!encoding || encoding === "identity") return source;
  const compressedSource = Readable.from(source);
  if (encoding === "gzip") return compressedSource.pipe(createGunzip());
  if (encoding === "deflate") return compressedSource.pipe(createInflate());
  if (encoding === "br") return compressedSource.pipe(createBrotliDecompress());
  throw new ExternalCalendarError("external_calendar_fetch_failed", "Calendar feed could not be fetched.");
}

async function readLimitedFeed(response: ExternalCalendarResponse, signal: AbortSignal): Promise<string> {
  const declaredLength = Number(singleHeader(response.headers, "content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ICS_BYTES) {
    throw new ExternalCalendarError("external_calendar_limit", "Calendar feed exceeds the supported size.");
  }
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of limitedByteStream(decodedBody(response, signal), signal)) {
    const buffer = Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > MAX_ICS_BYTES) {
      throw new ExternalCalendarError("external_calendar_limit", "Calendar feed exceeds the supported size.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, receivedBytes).toString("utf8");
}

export async function fetchExternalCalendarFeedContent(
  input: string,
  dependencies: ExternalCalendarFetchDependencies = defaultFetchDependencies
): Promise<string> {
  let url = new URL(normalizeExternalCalendarFeedUrl(input));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? FEED_FETCH_TIMEOUT_MS);
  try {
    for (let redirectCount = 0; redirectCount <= MAX_FEED_REDIRECTS; redirectCount += 1) {
      const address = await resolvePublicAddress(url, dependencies, controller.signal);
      const response = await abortable(
        dependencies.request(url, address, controller.signal),
        controller.signal
      );
      const location = singleHeader(response.headers, "location");
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && location) {
        response.cancel();
        if (redirectCount === MAX_FEED_REDIRECTS) break;
        try {
          url = new URL(normalizeExternalCalendarFeedUrl(new URL(location, url).href));
        } catch {
          throw new ExternalCalendarError("external_calendar_fetch_failed", "Calendar feed could not be fetched.");
        }
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.cancel();
        throw new ExternalCalendarError("external_calendar_fetch_failed", "Calendar feed could not be fetched.");
      }
      try {
        return await readLimitedFeed(response, controller.signal);
      } finally {
        response.cancel();
      }
    }
    throw new ExternalCalendarError("external_calendar_fetch_failed", "Calendar feed could not be fetched.");
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

export async function listExternalCalendarSources(database: DatabaseExecutor) {
  const rows = await database.selectFrom("external_calendar_sources")
    .selectAll()
    .orderBy("name")
    .execute();
  return rows.map((row) => mapSource(row as unknown as Record<string, unknown>));
}

export async function listExternalCalendarBackupEvents(database: DatabaseExecutor) {
  return database.selectFrom("external_calendar_events")
    .select([
      "id",
      "source_id as sourceId",
      "ical_uid as icalUid",
      "recurrence_id as recurrenceId",
      "title",
      "description",
      "start_datetime as startDateTime",
      "end_datetime as endDateTime",
      "all_day as allDay",
      "location",
      "raw_hash as rawHash",
      "created_at as createdAt",
      "updated_at as updatedAt"
    ])
    .orderBy("start_datetime")
    .orderBy("id")
    .execute();
}

async function getChildIds(database: DatabaseExecutor, id: string): Promise<string[]> {
  const rows = await database.selectFrom("holiday_period_children")
    .select("child_id")
    .where("holiday_period_id", "=", id)
    .where("deleted_at", "is", null)
    .orderBy("child_id")
    .execute();
  return rows.map((row) => row.child_id);
}

async function mapHoliday(database: DatabaseExecutor, row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    childIds: await getChildIds(database, String(row.id)),
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

async function sourceById(database: DatabaseExecutor, id: string) {
  const row = await database.selectFrom("external_calendar_sources")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return row ? mapSource(row as unknown as Record<string, unknown>) : undefined;
}

async function requiredSourceById(database: DatabaseExecutor, id: string) {
  const source = await sourceById(database, id);
  if (!source) {
    throw new ExternalCalendarError("external_calendar_not_found", "External calendar source was not found.");
  }
  return source;
}

async function writeEvents(
  database: DatabaseExecutor,
  sourceId: string,
  events: ParsedExternalCalendarEvent[],
  timestamp: string
): Promise<void> {
  const retained = new Set(events.map((event) => `${event.icalUid}\u0000${event.recurrenceId}`));
  for (const event of events) {
    await database.insertInto("external_calendar_events").values({
      id: randomUUID(),
      source_id: sourceId,
      ical_uid: event.icalUid,
      recurrence_id: event.recurrenceId,
      title: event.title,
      description: event.description ?? null,
      start_datetime: event.startDateTime,
      end_datetime: event.endDateTime,
      all_day: Number(event.allDay),
      location: event.location ?? null,
      raw_hash: event.rawHash,
      created_at: timestamp,
      updated_at: timestamp
    }).onConflict((conflict) => conflict.columns(["source_id", "ical_uid", "recurrence_id"])
      .doUpdateSet({
        title: event.title,
        description: event.description ?? null,
        start_datetime: event.startDateTime,
        end_datetime: event.endDateTime,
        all_day: Number(event.allDay),
        location: event.location ?? null,
        raw_hash: event.rawHash,
        updated_at: timestamp
      })).execute();
  }
  const existing = await database.selectFrom("external_calendar_events")
    .select(["ical_uid", "recurrence_id"])
    .where("source_id", "=", sourceId)
    .execute();
  for (const event of existing) {
    if (!retained.has(`${event.ical_uid}\u0000${event.recurrence_id}`)) {
      await database.deleteFrom("external_calendar_events")
        .where("source_id", "=", sourceId)
        .where("ical_uid", "=", event.ical_uid)
        .where("recurrence_id", "=", event.recurrence_id)
        .execute();
    }
  }
}

export async function importExternalCalendar(
  runtime: PersistenceRuntime,
  input: ExternalCalendarSourceInput,
  sourceId?: string
) {
  const events = parseIcs(input.content);
  const timestamp = nowIso();
  const id = sourceId ?? randomUUID();
  return runtime.transaction(async (database) => {
    if (sourceId) {
      const changed = await database.updateTable("external_calendar_sources").set({
        name: input.name,
        color: input.color,
        source_type: input.sourceType,
        source_kind: "file",
        feed_url: null,
        last_refresh_at: null,
        last_refresh_error: null,
        last_imported_at: timestamp,
        updated_at: timestamp
      }).where("id", "=", id).executeTakeFirst();
      if (changed.numUpdatedRows === 0n) {
        throw new ExternalCalendarError("external_calendar_not_found", "External calendar source was not found.");
      }
    } else {
      await database.insertInto("external_calendar_sources").values({
        id,
        name: input.name,
        color: input.color,
        visible: 1,
        source_type: input.sourceType,
        source_kind: "file",
        feed_url: null,
        last_imported_at: timestamp,
        last_refresh_at: null,
        last_refresh_error: null,
        created_at: timestamp,
        updated_at: timestamp
      }).execute();
    }
    await writeEvents(database, id, events, timestamp);
    return { source: await requiredSourceById(database, id), importedEvents: events.length };
  });
}

export async function importExternalCalendarFeed(
  runtime: PersistenceRuntime,
  input: ExternalCalendarFeedInput,
  sourceId?: string
) {
  const url = normalizeExternalCalendarFeedUrl(input.url);
  const content = await fetchExternalCalendarFeedContent(url);
  const events = parseIcs(content);
  const timestamp = nowIso();
  const id = sourceId ?? randomUUID();
  return runtime.transaction(async (database) => {
    if (sourceId) {
      const changed = await database.updateTable("external_calendar_sources").set({
        name: input.name,
        color: input.color,
        source_type: input.sourceType,
        source_kind: "url",
        feed_url: url,
        last_imported_at: timestamp,
        last_refresh_at: timestamp,
        last_refresh_error: null,
        updated_at: timestamp
      }).where("id", "=", id).executeTakeFirst();
      if (changed.numUpdatedRows === 0n) {
        throw new ExternalCalendarError("external_calendar_not_found", "External calendar source was not found.");
      }
    } else {
      await database.insertInto("external_calendar_sources").values({
        id,
        name: input.name,
        color: input.color,
        visible: 1,
        source_type: input.sourceType,
        source_kind: "url",
        feed_url: url,
        last_imported_at: timestamp,
        last_refresh_at: timestamp,
        last_refresh_error: null,
        created_at: timestamp,
        updated_at: timestamp
      }).execute();
    }
    await writeEvents(database, id, events, timestamp);
    return { source: await requiredSourceById(database, id), importedEvents: events.length };
  });
}

export async function refreshExternalCalendarFeed(runtime: PersistenceRuntime, id: string) {
  const current = await runtime.query.selectFrom("external_calendar_sources")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!current) throw new ExternalCalendarError("external_calendar_not_found", "External calendar source was not found.");
  if (current.source_kind !== "url" || typeof current.feed_url !== "string") {
    throw new ExternalCalendarError("external_calendar_invalid", "External calendar source is not a URL feed.");
  }
  const timestamp = nowIso();
  try {
    const content = await fetchExternalCalendarFeedContent(current.feed_url);
    const events = parseIcs(content);
    return await runtime.transaction(async (database) => {
      await database.updateTable("external_calendar_sources").set({
        last_imported_at: timestamp,
        last_refresh_at: timestamp,
        last_refresh_error: null,
        updated_at: timestamp
      }).where("id", "=", id).execute();
      await writeEvents(database, id, events, timestamp);
      return { source: await requiredSourceById(database, id), importedEvents: events.length };
    });
  } catch (error) {
    await runtime.query.updateTable("external_calendar_sources").set({
      last_refresh_at: timestamp,
      last_refresh_error: error instanceof ExternalCalendarError ? error.code : "external_calendar_fetch_failed",
      updated_at: timestamp
    }).where("id", "=", id).execute();
    throw error;
  }
}

export async function updateExternalCalendarSource(
  database: DatabaseExecutor,
  id: string,
  input: { name?: string; color?: string; visible?: boolean; sourceType?: ApiExternalCalendarSourceType }
) {
  const current = await database.selectFrom("external_calendar_sources")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!current) throw new ExternalCalendarError("external_calendar_not_found", "External calendar source was not found.");
  await database.updateTable("external_calendar_sources").set({
    name: input.name ?? current.name,
    color: input.color ?? current.color,
    visible: input.visible === undefined ? current.visible : Number(input.visible),
    source_type: input.sourceType ?? current.source_type ?? "overlay",
    updated_at: nowIso()
  }).where("id", "=", id).execute();
  return sourceById(database, id);
}

export async function deleteExternalCalendarSource(database: DatabaseExecutor, id: string): Promise<boolean> {
  const result = await database.deleteFrom("external_calendar_sources")
    .where("id", "=", id)
    .executeTakeFirst();
  return result.numDeletedRows > 0n;
}

export async function visibleExternalCalendarEvents(database: DatabaseExecutor, from: string, to: string) {
  return database.selectFrom("external_calendar_events as event")
    .innerJoin("external_calendar_sources as source", "source.id", "event.source_id")
    .select([
      "event.id",
      "event.source_id as sourceId",
      "source.name as sourceName",
      "source.color as sourceColor",
      "event.title",
      "event.description",
      "event.start_datetime as startDateTime",
      "event.end_datetime as endDateTime",
      "event.all_day as allDay",
      "event.location"
    ])
    .where("source.visible", "=", 1)
    .where("event.start_datetime", "<", to)
    .where("event.end_datetime", ">", from)
    .orderBy("event.start_datetime")
    .orderBy("event.title")
    .execute();
}

export async function deriveHolidayPeriodsFromExternalCalendar(
  runtime: PersistenceRuntime,
  sourceId: string,
  input: ExternalCalendarHolidayDeriveInput
) {
  return runtime.transaction(async (database) => {
    const sourceRow = await database.selectFrom("external_calendar_sources")
      .selectAll()
      .where("id", "=", sourceId)
      .executeTakeFirst();
    if (!sourceRow) throw new ExternalCalendarError("external_calendar_not_found", "External calendar source was not found.");
    const source = mapSource(sourceRow as unknown as Record<string, unknown>);
    if (source.sourceType !== "holiday") {
      throw new ExternalCalendarError("external_calendar_invalid", "Only holiday calendar sources can derive holiday periods.");
    }
    await assertPersistedChildren(database, input.childIds);
    const events = await database.selectFrom("external_calendar_events")
      .select(["id", "title", "description", "start_datetime", "end_datetime", "all_day"])
      .where("source_id", "=", sourceId)
      .orderBy("start_datetime")
      .orderBy("title")
      .execute();
    const existingRows = await database.selectFrom("holiday_periods")
      .select("source_external_calendar_event_id")
      .where("source_external_calendar_source_id", "=", sourceId)
      .where("source_external_calendar_event_id", "is not", null)
      .where("deleted_at", "is", null)
      .execute();
    const existing = new Set(existingRows.map((row) => row.source_external_calendar_event_id));
    const timestamp = nowIso();
    const holidays = [];
    let skippedExisting = 0;
    let skippedUnsupported = 0;

    for (const event of events) {
      if (existing.has(event.id)) {
        skippedExisting += 1;
        continue;
      }
      if (!event.all_day) {
        skippedUnsupported += 1;
        continue;
      }
      const startDate = dateKey(event.start_datetime);
      const endDate = inclusiveEndDateKey(event.end_datetime, true);
      if (endDate < startDate) {
        skippedUnsupported += 1;
        continue;
      }
      const id = makeId("holiday");
      const noteParts = [
        `Aus importierter Ferienquelle "${source.name}" abgeleitet.`,
        event.description ? truncate(event.description, 3500) : undefined
      ].filter(Boolean);
      await database.insertInto("holiday_periods").values({
        id,
        name: truncate(event.title, 200),
        start_date: startDate,
        end_date: endDate,
        assigned_to: input.assignedTo,
        notes: noteParts.join("\n\n") || null,
        source_external_calendar_source_id: sourceId,
        source_external_calendar_event_id: event.id,
        created_by: input.userEmail,
        updated_by: input.userEmail,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null
      }).execute();
      await syncPersistedChildJunction(
        database,
        { table: "holiday_period_children", owner: "holiday_period_id" },
        id,
        input.childIds,
        timestamp
      );
      const row = await database.selectFrom("holiday_periods").selectAll().where("id", "=", id).executeTakeFirst();
      if (!row) throw new Error("Ferienzeitraum konnte nicht geladen werden.");
      const holiday = await mapHoliday(database, row as unknown as Record<string, unknown>);
      await recordDomainAudit(database, {
        userEmail: input.userEmail,
        entityType: "holiday_period",
        entityId: id,
        action: "created",
        newValue: holiday
      });
      await markDomainClosedMonthsChanged(
        database,
        input.userEmail,
        "holiday_period",
        id,
        startDate,
        endDate,
        timestamp
      );
      holidays.push(holiday);
    }
    return {
      source,
      created: holidays.length,
      skippedExisting,
      skippedUnsupported,
      holidays
    };
  });
}
