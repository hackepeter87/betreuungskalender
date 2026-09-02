import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ApiCalendarFeedScope } from "../../shared/api.js";
import type { DatabaseExecutor, PersistenceRuntime } from "../db/runtime.js";
import { nowIso } from "./common.js";
import { assignedCarePartyIds, canUseCareParty, sharedCarePartyModeEnabled } from "./carePartyAccess.js";
import { getCareParty } from "./careParties.js";
import { findAuthenticatedUserBySubject } from "./users.js";
import { userHasWorkspacePermission } from "./memberships.js";

const TOKEN_BYTES = 32;
const PRODUCT_ID = "-//Betreuungskalender//Personal Calendar Feed//DE";

export interface CalendarFeedStatus {
  active: boolean;
  scope: ApiCalendarFeedScope;
  createdAt?: string;
  lastUsedAt?: string;
  feedUrl?: string;
}

export interface TokenRow {
  id: string;
  user_id: string;
  external_subject: string;
  display_name: string;
  role: "admin" | "parent" | "readonly";
  scope_type: "legacy" | "all" | "party";
  scope_party_id: string | null;
  scope_party_name: string | null;
  created_at: string;
  last_used_at: string | null;
}

interface FeedEntryRow {
  id: string;
  start_datetime: string;
  end_datetime: string;
  status: "planned" | "completed" | "partial";
  location: string | null;
  custom_location: string | null;
  child_names_json: string;
  responsible_party_name: string | null;
  updated_at: string;
}

const CARE_LOCATION_LABELS: Record<string, string> = {
  commuterApartment: "Pendlerwohnung",
  mainResidence: "Hauptwohnsitz",
  mother: "Bei der Mutter",
  school: "Schule",
  ogs: "OGS",
  other: "Anderer Ort"
};

export function parseCalendarFeedScope(scope: string | undefined): {
  type: "legacy" | "all" | "party";
  partyId?: string;
  scope: ApiCalendarFeedScope;
} {
  if (!scope || scope === "legacy") return { type: "legacy", scope: "legacy" };
  if (scope === "all") return { type: "all", scope: "all" };
  if (scope.startsWith("party:")) {
    const partyId = scope.slice("party:".length);
    return { type: "party", partyId, scope: `party:${partyId}` };
  }
  return { type: "legacy", scope: "legacy" };
}

function scopeFromRow(row: Pick<TokenRow, "scope_type" | "scope_party_id">): ApiCalendarFeedScope {
  if (row.scope_type === "party" && row.scope_party_id) return `party:${row.scope_party_id}`;
  return row.scope_type === "all" ? "all" : "legacy";
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function activeTokenForUser(
  userId: string,
  scope: ApiCalendarFeedScope,
  database: DatabaseExecutor
): Promise<TokenRow | undefined> {
  const parsed = parseCalendarFeedScope(scope);
  let query = database.selectFrom("calendar_feed_tokens as t")
    .innerJoin("app_users as u", "u.id", "t.user_id")
    .leftJoin("care_parties as p", (join) => join
      .onRef("p.id", "=", "t.scope_party_id")
      .on("p.deleted_at", "is", null))
    .select([
      "t.id", "t.user_id", "u.external_subject", "u.display_name", "u.role",
      "t.scope_type", "t.scope_party_id", "p.name as scope_party_name",
      "t.created_at", "t.last_used_at"
    ])
    .where("t.user_id", "=", userId)
    .where("t.scope_type", "=", parsed.type)
    .where("t.revoked_at", "is", null)
    .orderBy("t.created_at", "desc");
  query = parsed.partyId
    ? query.where("t.scope_party_id", "=", parsed.partyId)
    : query.where("t.scope_party_id", "is", null);
  return query.executeTakeFirst() as Promise<TokenRow | undefined>;
}

export async function calendarFeedStatus(
  userId: string,
  scope: ApiCalendarFeedScope,
  database: DatabaseExecutor,
  feedUrl?: string
): Promise<CalendarFeedStatus> {
  const token = await activeTokenForUser(userId, scope, database);
  if (!token) return { active: false, scope };
  return {
    active: true,
    scope,
    createdAt: token.created_at,
    lastUsedAt: token.last_used_at ?? undefined,
    ...(feedUrl ? { feedUrl } : {})
  };
}

async function assertScopeAllowed(
  userId: string,
  scope: ApiCalendarFeedScope,
  database: DatabaseExecutor
): Promise<void> {
  const parsed = parseCalendarFeedScope(scope);
  if (parsed.type !== "party") return;
  if (!parsed.partyId || !(await getCareParty(parsed.partyId, database))) {
    throw new Error("Die ausgewählte betreuende Person existiert nicht.");
  }
  const user = await database.selectFrom("app_users")
    .select("external_subject as externalSubject")
    .where("id", "=", userId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  const requestUser = user
    ? await findAuthenticatedUserBySubject(user.externalSubject, database)
    : undefined;
  if (requestUser && !(await canUseCareParty(requestUser, parsed.partyId, database))) {
    throw new Error("Diese betreuende Person ist für deinen Benutzer nicht freigegeben.");
  }
}

export async function rotateCalendarFeedToken(
  userId: string,
  scope: ApiCalendarFeedScope,
  runtime: PersistenceRuntime
): Promise<{ token: string; status: CalendarFeedStatus }> {
  const parsed = parseCalendarFeedScope(scope);
  await assertScopeAllowed(userId, scope, runtime.query);
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const timestamp = nowIso();
  await runtime.transaction(async (database) => {
    let revoke = database.updateTable("calendar_feed_tokens")
      .set({ revoked_at: timestamp })
      .where("user_id", "=", userId)
      .where("scope_type", "=", parsed.type)
      .where("revoked_at", "is", null);
    revoke = parsed.partyId
      ? revoke.where("scope_party_id", "=", parsed.partyId)
      : revoke.where("scope_party_id", "is", null);
    await revoke.execute();
    await database.insertInto("calendar_feed_tokens").values({
      id: randomUUID(),
      user_id: userId,
      token_hash: hashToken(token),
      scope_type: parsed.type,
      scope_party_id: parsed.partyId ?? null,
      created_at: timestamp,
      last_used_at: null,
      revoked_at: null
    }).execute();
  });
  return { token, status: await calendarFeedStatus(userId, scope, runtime.query) };
}

export async function revokeCalendarFeedTokens(
  userId: string,
  database: DatabaseExecutor,
  scope?: ApiCalendarFeedScope
): Promise<void> {
  const parsed = scope ? parseCalendarFeedScope(scope) : undefined;
  let update = database.updateTable("calendar_feed_tokens")
    .set({ revoked_at: nowIso() })
    .where("user_id", "=", userId)
    .where("revoked_at", "is", null);
  if (parsed) {
    update = update.where("scope_type", "=", parsed.type);
    update = parsed.partyId
      ? update.where("scope_party_id", "=", parsed.partyId)
      : update.where("scope_party_id", "is", null);
  }
  await update.execute();
}

export async function resolveCalendarFeedToken(
  token: string,
  database: DatabaseExecutor
): Promise<TokenRow | undefined> {
  const normalized = token.trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(normalized)) return undefined;
  const row = await database.selectFrom("calendar_feed_tokens as t")
    .innerJoin("app_users as u", "u.id", "t.user_id")
    .leftJoin("care_parties as p", (join) => join
      .onRef("p.id", "=", "t.scope_party_id")
      .on("p.deleted_at", "is", null))
    .select([
      "t.id", "t.user_id", "u.external_subject", "u.display_name", "u.role",
      "t.scope_type", "t.scope_party_id", "p.name as scope_party_name",
      "t.created_at", "t.last_used_at"
    ])
    .where("t.token_hash", "=", hashToken(normalized))
    .where("t.revoked_at", "is", null)
    .where("u.deleted_at", "is", null)
    .executeTakeFirst() as TokenRow | undefined;
  if (!row) return undefined;
  if (!(await userHasWorkspacePermission(
    row.user_id,
    "feeds:manage-own",
    database
  ))) return undefined;
  const requestUser = await findAuthenticatedUserBySubject(
    row.external_subject,
    database
  );
  if (!requestUser?.workspaceAccess) return undefined;
  if (row.scope_type === "party") {
    if (!row.scope_party_id || !row.scope_party_name) return undefined;
    if (!(await canUseCareParty(requestUser, row.scope_party_id, database))) return undefined;
  }
  await database.updateTable("calendar_feed_tokens")
    .set({ last_used_at: nowIso() })
    .where("id", "=", row.id)
    .execute();
  return row;
}

async function feedEntriesForToken(
  token: TokenRow,
  database: DatabaseExecutor
): Promise<FeedEntryRow[]> {
  const requestUser = await findAuthenticatedUserBySubject(
    token.external_subject,
    database
  );
  if (!requestUser?.workspaceAccess || !requestUser.workspacePermissions?.includes("feeds:manage-own")) {
    return [];
  }
  const sharedMode = await sharedCarePartyModeEnabled(database);
  const unrestricted = !sharedMode || requestUser.isOwner || requestUser.workspaceRole === "admin";
  const assignedIds = unrestricted ? [] : await assignedCarePartyIds(token.user_id, database);
  const scope = scopeFromRow(token);
  let query = database.selectFrom("care_entries as e")
    .leftJoin("care_parties as responsible_party", (join) => join
      .onRef("responsible_party.id", "=", "e.responsible_party_id")
      .on("responsible_party.deleted_at", "is", null))
    .select([
      "e.id", "e.start_datetime", "e.end_datetime", "e.status", "e.location",
      "e.custom_location", "e.updated_at",
      "responsible_party.name as responsible_party_name"
    ])
    .where("e.deleted_at", "is", null)
    .where("e.status", "in", ["planned", "completed", "partial"])
    .orderBy("e.start_datetime")
    .orderBy("e.id");
  if (scope === "legacy") {
    query = query.where("e.created_by", "=", token.user_id);
  } else if (scope.startsWith("party:")) {
    if (!token.scope_party_id) return [];
    query = query.where("e.responsible_party_id", "=", token.scope_party_id);
  } else if (!unrestricted && assignedIds.length > 0) {
    query = query.where("e.responsible_party_id", "in", assignedIds);
  } else if (!unrestricted) {
    return [];
  }
  const entries = await query.execute();
  if (!entries.length) return [];
  const childRows = await database.selectFrom("care_entry_children as ec")
    .innerJoin("children as c", (join) => join
      .onRef("c.id", "=", "ec.child_id")
      .on("c.deleted_at", "is", null))
    .select(["ec.care_entry_id", "c.id as child_id", "c.name"])
    .where("ec.care_entry_id", "in", entries.map((entry) => entry.id))
    .where("ec.deleted_at", "is", null)
    .orderBy("c.name")
    .orderBy("c.id")
    .execute();
  const childrenByEntry = new Map<string, string[]>();
  for (const child of childRows) {
    childrenByEntry.set(child.care_entry_id, [
      ...(childrenByEntry.get(child.care_entry_id) ?? []),
      child.name
    ]);
  }
  return entries.map((entry) => ({
    ...entry,
    status: entry.status as FeedEntryRow["status"],
    child_names_json: JSON.stringify(childrenByEntry.get(entry.id) ?? [])
  }));
}

function escapeText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

function feedLocation(entry: FeedEntryRow): string | undefined {
  const customLocation = entry.custom_location?.trim();
  if (customLocation) return customLocation;
  const location = entry.location?.trim();
  if (!location) return undefined;
  return CARE_LOCATION_LABELS[location] ?? location;
}

function childNames(entry: FeedEntryRow): string[] {
  try {
    const parsed = JSON.parse(entry.child_names_json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
  } catch {
    return [];
  }
}

function germanList(values: string[]): string {
  if (values.length === 0) return "Kinder";
  if (values.length === 1) return values[0] ?? "Kinder";
  if (values.length === 2) return `${values[0]} und ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} und ${values.at(-1)}`;
}

function eventTitle(entry: FeedEntryRow): string {
  const careParty = entry.responsible_party_name?.trim() || "betreuender Person";
  return `${germanList(childNames(entry))} bei ${careParty}`;
}

function utf8Prefix(value: string, maximumBytes: number): [string, string] {
  let bytes = 0;
  let end = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maximumBytes) break;
    bytes += characterBytes;
    end += character.length;
  }
  return [value.slice(0, end), value.slice(end)];
}

function foldLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const parts: string[] = [];
  let remaining = line;
  while (remaining.length > 0) {
    const [part, rest] = utf8Prefix(remaining, parts.length === 0 ? 75 : 74);
    parts.push(parts.length === 0 ? part : ` ${part}`);
    remaining = rest;
  }
  return parts.join("\r\n");
}

function localDateTimeValue(value: string): string {
  const normalized = value.trim();
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (!match) return utcDateTimeValue(value);
  return `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6] ?? "00"}`;
}

function utcDateTimeValue(value: string): string {
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return utcDateTimeValue(nowIso());
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export async function buildPersonalCalendarFeed(input: {
  token: TokenRow;
  generatedAt?: string;
  database: DatabaseExecutor;
}): Promise<string> {
  const generatedAt = input.generatedAt ?? nowIso();
  const scope = scopeFromRow(input.token);
  const title = scope === "legacy"
    ? `Kinder bei ${input.token.display_name}`
    : scope === "all"
      ? "Betreuungskalender Gesamt"
      : `Kinder bei ${input.token.scope_party_name ?? "betreuende Person"}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODUCT_ID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(title)}`,
    "X-WR-TIMEZONE:Europe/Berlin"
  ];
  for (const entry of await feedEntriesForToken(input.token, input.database)) {
    const location = feedLocation(entry);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(`${entry.id}@betreuungskalender`)}`,
      `DTSTAMP:${utcDateTimeValue(generatedAt)}`,
      `DTSTART:${localDateTimeValue(entry.start_datetime)}`,
      `DTEND:${localDateTimeValue(entry.end_datetime)}`,
      `SUMMARY:${escapeText(eventTitle(entry))}`,
      ...(location ? [`LOCATION:${escapeText(location)}`] : []),
      `LAST-MODIFIED:${utcDateTimeValue(entry.updated_at)}`,
      `CATEGORIES:${entry.status === "planned" ? "Geplant" : entry.status === "partial" ? "Teilweise" : "Durchgeführt"}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
