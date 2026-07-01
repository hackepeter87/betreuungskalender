import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ApiCalendarFeedScope } from "../../shared/api.js";
import { db } from "../db/connection.js";
import { nowIso } from "./common.js";
import { assignedCarePartyIds, canUseCareParty, sharedCarePartyModeEnabled } from "./carePartyAccess.js";
import { getCareParty } from "./careParties.js";
import { findAuthenticatedUserBySubject } from "./users.js";

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
  status: "planned" | "completed";
  updated_at: string;
}

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

function activeTokenForUser(userId: string, scope: ApiCalendarFeedScope): TokenRow | undefined {
  const parsed = parseCalendarFeedScope(scope);
  return db.prepare(`
    SELECT
      t.id, t.user_id, u.external_subject, u.display_name, u.role,
      t.scope_type, t.scope_party_id, p.name AS scope_party_name,
      t.created_at, t.last_used_at
    FROM calendar_feed_tokens t
    JOIN app_users u ON u.id = t.user_id
    LEFT JOIN care_parties p ON p.id = t.scope_party_id AND p.deleted_at IS NULL
    WHERE t.user_id = ?
      AND t.scope_type = ?
      AND COALESCE(t.scope_party_id, '') = ?
      AND t.revoked_at IS NULL
    ORDER BY t.created_at DESC
    LIMIT 1
  `).get(userId, parsed.type, parsed.partyId ?? "") as TokenRow | undefined;
}

export function calendarFeedStatus(
  userId: string,
  scope: ApiCalendarFeedScope,
  feedUrl?: string
): CalendarFeedStatus {
  const token = activeTokenForUser(userId, scope);
  if (!token) return { active: false, scope };
  return {
    active: true,
    scope,
    createdAt: token.created_at,
    lastUsedAt: token.last_used_at ?? undefined,
    ...(feedUrl ? { feedUrl } : {})
  };
}

function assertScopeAllowed(userId: string, scope: ApiCalendarFeedScope): void {
  const parsed = parseCalendarFeedScope(scope);
  if (parsed.type !== "party") return;
  if (!parsed.partyId || !getCareParty(parsed.partyId)) {
    throw new Error("Die ausgewählte betreuende Person existiert nicht.");
  }
  const user = db.prepare(`
    SELECT external_subject AS externalSubject
    FROM app_users
    WHERE id = ? AND deleted_at IS NULL
  `).get(userId) as { externalSubject: string } | undefined;
  const requestUser = user ? findAuthenticatedUserBySubject(user.externalSubject) : undefined;
  if (requestUser && !canUseCareParty(requestUser, parsed.partyId)) {
    throw new Error("Diese betreuende Person ist für deinen Benutzer nicht freigegeben.");
  }
}

export function rotateCalendarFeedToken(
  userId: string,
  scope: ApiCalendarFeedScope
): { token: string; status: CalendarFeedStatus } {
  const parsed = parseCalendarFeedScope(scope);
  assertScopeAllowed(userId, scope);
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const timestamp = nowIso();
  db.transaction(() => {
    db.prepare(`
      UPDATE calendar_feed_tokens
      SET revoked_at = ?
      WHERE user_id = ?
        AND scope_type = ?
        AND COALESCE(scope_party_id, '') = ?
        AND revoked_at IS NULL
    `).run(timestamp, userId, parsed.type, parsed.partyId ?? "");
    db.prepare(`
      INSERT INTO calendar_feed_tokens (
        id, user_id, token_hash, scope_type, scope_party_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), userId, hashToken(token), parsed.type, parsed.partyId ?? null, timestamp);
  })();
  return { token, status: calendarFeedStatus(userId, scope) };
}

export function revokeCalendarFeedTokens(userId: string, scope?: ApiCalendarFeedScope): void {
  const parsed = scope ? parseCalendarFeedScope(scope) : undefined;
  db.prepare(`
    UPDATE calendar_feed_tokens
    SET revoked_at = ?
    WHERE user_id = ?
      AND revoked_at IS NULL
      ${parsed ? "AND scope_type = ? AND COALESCE(scope_party_id, '') = ?" : ""}
  `).run(nowIso(), userId, ...(parsed ? [parsed.type, parsed.partyId ?? ""] : []));
}

export function resolveCalendarFeedToken(token: string): TokenRow | undefined {
  const normalized = token.trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(normalized)) return undefined;
  const row = db.prepare(`
    SELECT
      t.id, t.user_id, u.external_subject, u.display_name, u.role,
      t.scope_type, t.scope_party_id, p.name AS scope_party_name,
      t.created_at, t.last_used_at
    FROM calendar_feed_tokens t
    JOIN app_users u ON u.id = t.user_id
    LEFT JOIN care_parties p ON p.id = t.scope_party_id AND p.deleted_at IS NULL
    WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.deleted_at IS NULL
  `).get(hashToken(normalized)) as TokenRow | undefined;
  if (!row) return undefined;
  if (row.scope_type === "party") {
    if (!row.scope_party_id || !row.scope_party_name) return undefined;
    const requestUser = findAuthenticatedUserBySubject(row.external_subject);
    if (requestUser && !canUseCareParty(requestUser, row.scope_party_id)) return undefined;
  }
  db.prepare("UPDATE calendar_feed_tokens SET last_used_at = ? WHERE id = ?")
    .run(nowIso(), row.id);
  return row;
}

function feedEntriesForToken(token: TokenRow): FeedEntryRow[] {
  const assignedIds = token.role === "admin" || !sharedCarePartyModeEnabled()
    ? []
    : assignedCarePartyIds(token.user_id);
  const scope = scopeFromRow(token);
  if (scope === "legacy") {
    return db.prepare(`
      SELECT id, start_datetime, end_datetime, status, updated_at
      FROM care_entries
      WHERE deleted_at IS NULL
        AND status IN ('planned', 'completed')
        AND created_by = ?
      ORDER BY start_datetime, id
    `).all(token.user_id) as FeedEntryRow[];
  }
  if (scope.startsWith("party:")) {
    return db.prepare(`
      SELECT id, start_datetime, end_datetime, status, updated_at
      FROM care_entries
      WHERE deleted_at IS NULL
        AND status IN ('planned', 'completed')
        AND responsible_party_id = ?
      ORDER BY start_datetime, id
    `).all(token.scope_party_id) as FeedEntryRow[];
  }
  if (assignedIds.length > 0) {
    const placeholders = assignedIds.map(() => "?").join(", ");
    return db.prepare(`
      SELECT id, start_datetime, end_datetime, status, updated_at
      FROM care_entries
      WHERE deleted_at IS NULL
        AND status IN ('planned', 'completed')
        AND responsible_party_id IN (${placeholders})
      ORDER BY start_datetime, id
    `).all(...assignedIds) as FeedEntryRow[];
  }
  return db.prepare(`
    SELECT id, start_datetime, end_datetime, status, updated_at
    FROM care_entries
    WHERE deleted_at IS NULL
      AND status IN ('planned', 'completed')
    ORDER BY start_datetime, id
  `).all() as FeedEntryRow[];
}

function escapeText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let remaining = line;
  parts.push(remaining.slice(0, 75));
  remaining = remaining.slice(75);
  while (remaining.length > 0) {
    parts.push(` ${remaining.slice(0, 74)}`);
    remaining = remaining.slice(74);
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

export function buildPersonalCalendarFeed(input: {
  token: TokenRow;
  generatedAt?: string;
}): string {
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
  for (const entry of feedEntriesForToken(input.token)) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(`${entry.id}@betreuungskalender`)}`,
      `DTSTAMP:${utcDateTimeValue(generatedAt)}`,
      `DTSTART:${localDateTimeValue(entry.start_datetime)}`,
      `DTEND:${localDateTimeValue(entry.end_datetime)}`,
      `SUMMARY:${escapeText(title)}`,
      `LAST-MODIFIED:${utcDateTimeValue(entry.updated_at)}`,
      `CATEGORIES:${entry.status === "planned" ? "Geplant" : "Durchgeführt"}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
