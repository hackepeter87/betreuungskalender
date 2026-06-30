import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "../db/connection.js";
import { nowIso } from "./common.js";

const TOKEN_BYTES = 32;
const PRODUCT_ID = "-//Betreuungskalender//Personal Calendar Feed//DE";

export interface CalendarFeedStatus {
  active: boolean;
  createdAt?: string;
  lastUsedAt?: string;
  feedUrl?: string;
}

interface TokenRow {
  id: string;
  user_id: string;
  display_name: string;
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

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function activeTokenForUser(userId: string): TokenRow | undefined {
  return db.prepare(`
    SELECT t.id, t.user_id, u.display_name, t.created_at, t.last_used_at
    FROM calendar_feed_tokens t
    JOIN app_users u ON u.id = t.user_id
    WHERE t.user_id = ? AND t.revoked_at IS NULL
    ORDER BY t.created_at DESC
    LIMIT 1
  `).get(userId) as TokenRow | undefined;
}

export function calendarFeedStatus(userId: string, feedUrl?: string): CalendarFeedStatus {
  const token = activeTokenForUser(userId);
  if (!token) return { active: false };
  return {
    active: true,
    createdAt: token.created_at,
    lastUsedAt: token.last_used_at ?? undefined,
    ...(feedUrl ? { feedUrl } : {})
  };
}

export function rotateCalendarFeedToken(userId: string): { token: string; status: CalendarFeedStatus } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const timestamp = nowIso();
  db.transaction(() => {
    db.prepare(`
      UPDATE calendar_feed_tokens
      SET revoked_at = ?
      WHERE user_id = ? AND revoked_at IS NULL
    `).run(timestamp, userId);
    db.prepare(`
      INSERT INTO calendar_feed_tokens (id, user_id, token_hash, created_at)
      VALUES (?, ?, ?, ?)
    `).run(randomUUID(), userId, hashToken(token), timestamp);
  })();
  return { token, status: calendarFeedStatus(userId) };
}

export function revokeCalendarFeedTokens(userId: string): void {
  db.prepare(`
    UPDATE calendar_feed_tokens
    SET revoked_at = ?
    WHERE user_id = ? AND revoked_at IS NULL
  `).run(nowIso(), userId);
}

export function resolveCalendarFeedToken(token: string): TokenRow | undefined {
  const normalized = token.trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(normalized)) return undefined;
  const row = db.prepare(`
    SELECT t.id, t.user_id, u.display_name, t.created_at, t.last_used_at
    FROM calendar_feed_tokens t
    JOIN app_users u ON u.id = t.user_id
    WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.deleted_at IS NULL
  `).get(hashToken(normalized)) as TokenRow | undefined;
  if (!row) return undefined;
  db.prepare("UPDATE calendar_feed_tokens SET last_used_at = ? WHERE id = ?")
    .run(nowIso(), row.id);
  return row;
}

function feedEntriesForUser(userId: string): FeedEntryRow[] {
  return db.prepare(`
    SELECT id, start_datetime, end_datetime, status, updated_at
    FROM care_entries
    WHERE deleted_at IS NULL
      AND status IN ('planned', 'completed')
      AND created_by = ?
    ORDER BY start_datetime, id
  `).all(userId) as FeedEntryRow[];
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
  userId: string;
  displayName: string;
  generatedAt?: string;
}): string {
  const generatedAt = input.generatedAt ?? nowIso();
  const title = `Kinder bei ${input.displayName}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODUCT_ID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(title)}`,
    "X-WR-TIMEZONE:Europe/Berlin"
  ];
  for (const entry of feedEntriesForUser(input.userId)) {
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
