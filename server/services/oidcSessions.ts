import type Database from "better-sqlite3";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db as defaultDb } from "../db/connection.js";

export interface OidcSessionRecord {
  id: string;
  externalSubject: string;
  createdAt: string;
  lastSeenAt?: string;
  expiresAt: string;
}

interface OidcSessionRow {
  id: string;
  external_subject: string;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string;
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toRecord(row: OidcSessionRow): OidcSessionRecord {
  return {
    id: row.id,
    externalSubject: row.external_subject,
    createdAt: row.created_at,
    ...(row.last_seen_at ? { lastSeenAt: row.last_seen_at } : {}),
    expiresAt: row.expires_at
  };
}

export class OidcSessionStore {
  readonly #db: Database.Database;

  constructor(database: Database.Database = defaultDb) {
    this.#db = database;
  }

  create(
    externalSubject: string,
    ttlSeconds: number,
    now = new Date()
  ): { token: string; session: OidcSessionRecord } {
    this.deleteExpired(now);
    const token = randomBytes(32).toString("base64url");
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const session = {
      id: randomUUID(),
      externalSubject,
      createdAt,
      expiresAt
    };
    this.#db.prepare(`
      INSERT INTO native_oidc_sessions (
        id, session_hash, external_subject, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      session.id,
      hashSessionToken(token),
      externalSubject,
      createdAt,
      expiresAt
    );
    return { token, session };
  }

  findByToken(token: string | undefined, now = new Date()): OidcSessionRecord | undefined {
    const normalized = token?.trim();
    if (!normalized) return undefined;
    const nowIso = now.toISOString();
    const row = this.#db.prepare(`
      SELECT id, external_subject, created_at, last_seen_at, expires_at
      FROM native_oidc_sessions
      WHERE session_hash = ?
        AND revoked_at IS NULL
        AND expires_at > ?
    `).get(hashSessionToken(normalized), nowIso) as OidcSessionRow | undefined;
    if (!row) return undefined;
    this.#db.prepare(`
      UPDATE native_oidc_sessions
      SET last_seen_at = ?
      WHERE id = ?
    `).run(nowIso, row.id);
    return toRecord({ ...row, last_seen_at: nowIso });
  }

  revokeByToken(token: string | undefined, now = new Date()): boolean {
    const normalized = token?.trim();
    if (!normalized) return false;
    const result = this.#db.prepare(`
      UPDATE native_oidc_sessions
      SET revoked_at = ?
      WHERE session_hash = ?
        AND revoked_at IS NULL
    `).run(now.toISOString(), hashSessionToken(normalized));
    return result.changes > 0;
  }

  deleteExpired(now = new Date()): void {
    this.#db.prepare(`
      DELETE FROM native_oidc_sessions
      WHERE expires_at <= ?
        OR revoked_at IS NOT NULL
    `).run(now.toISOString());
  }
}

export const oidcSessionTokenForTesting = {
  hashSessionToken
};
