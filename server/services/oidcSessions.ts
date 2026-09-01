import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PersistenceExecutor } from "../db/runtime.js";

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
  readonly #database: PersistenceExecutor;

  constructor(database: PersistenceExecutor) {
    this.#database = database;
  }

  async create(
    externalSubject: string,
    ttlSeconds: number,
    now = new Date()
  ): Promise<{ token: string; session: OidcSessionRecord }> {
    await this.deleteExpired(now);
    const token = randomBytes(32).toString("base64url");
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const session = {
      id: randomUUID(),
      externalSubject,
      createdAt,
      expiresAt
    };
    await this.#database.run(`
      INSERT INTO native_oidc_sessions (
        id, session_hash, external_subject, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?)
    `, [
      session.id,
      hashSessionToken(token),
      externalSubject,
      createdAt,
      expiresAt
    ]);
    return { token, session };
  }

  async findByToken(
    token: string | undefined,
    now = new Date()
  ): Promise<OidcSessionRecord | undefined> {
    const normalized = token?.trim();
    if (!normalized) return undefined;
    const nowIso = now.toISOString();
    const row = await this.#database.one<OidcSessionRow>(`
      SELECT id, external_subject, created_at, last_seen_at, expires_at
      FROM native_oidc_sessions
      WHERE session_hash = ?
        AND revoked_at IS NULL
        AND expires_at > ?
    `, [hashSessionToken(normalized), nowIso]);
    if (!row) return undefined;
    await this.#database.run(`
      UPDATE native_oidc_sessions
      SET last_seen_at = ?
      WHERE id = ?
    `, [nowIso, row.id]);
    return toRecord({ ...row, last_seen_at: nowIso });
  }

  async revokeByToken(token: string | undefined, now = new Date()): Promise<boolean> {
    const normalized = token?.trim();
    if (!normalized) return false;
    const result = await this.#database.run(`
      UPDATE native_oidc_sessions
      SET revoked_at = ?
      WHERE session_hash = ?
        AND revoked_at IS NULL
    `, [now.toISOString(), hashSessionToken(normalized)]);
    return result.affectedRows > 0;
  }

  async deleteExpired(now = new Date()): Promise<void> {
    await this.#database.run(`
      DELETE FROM native_oidc_sessions
      WHERE expires_at <= ?
        OR revoked_at IS NOT NULL
    `, [now.toISOString()]);
  }
}

export const oidcSessionTokenForTesting = {
  hashSessionToken
};
