import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseExecutor } from "../db/runtime.js";

export interface OidcSessionRecord {
  id: string;
  externalSubject: string;
  createdAt: string;
  lastSeenAt?: string;
  expiresAt: string;
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class OidcSessionStore {
  constructor(private readonly database: DatabaseExecutor) {}

  async create(
    externalSubject: string,
    ttlSeconds: number,
    now = new Date(),
    database: DatabaseExecutor = this.database
  ) {
    await this.deleteExpired(now, database);
    const token = randomBytes(32).toString("base64url");
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const session = { id: randomUUID(), externalSubject, createdAt, expiresAt };
    await database.insertInto("native_oidc_sessions").values({
      id: session.id,
      session_hash: hashSessionToken(token),
      external_subject: externalSubject,
      created_at: createdAt,
      last_seen_at: null,
      expires_at: expiresAt,
      revoked_at: null
    }).execute();
    return { token, session };
  }

  async findByToken(
    token: string | undefined,
    now = new Date()
  ): Promise<OidcSessionRecord | undefined> {
    const normalized = token?.trim();
    if (!normalized) return undefined;
    const nowIso = now.toISOString();
    const row = await this.database.selectFrom("native_oidc_sessions")
      .select(["id", "external_subject", "created_at", "last_seen_at", "expires_at"])
      .where("session_hash", "=", hashSessionToken(normalized))
      .where("revoked_at", "is", null)
      .where("expires_at", ">", nowIso)
      .executeTakeFirst();
    if (!row) return undefined;
    await this.database.updateTable("native_oidc_sessions")
      .set({ last_seen_at: nowIso })
      .where("id", "=", row.id)
      .execute();
    return {
      id: row.id,
      externalSubject: row.external_subject,
      createdAt: row.created_at,
      lastSeenAt: nowIso,
      expiresAt: row.expires_at
    };
  }

  async revokeByToken(token: string | undefined, now = new Date()): Promise<boolean> {
    const normalized = token?.trim();
    if (!normalized) return false;
    const result = await this.database.updateTable("native_oidc_sessions")
      .set({ revoked_at: now.toISOString() })
      .where("session_hash", "=", hashSessionToken(normalized))
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }

  async deleteExpired(
    now = new Date(),
    database: DatabaseExecutor = this.database
  ): Promise<void> {
    await database.deleteFrom("native_oidc_sessions")
      .where((expression) => expression.or([
        expression("expires_at", "<=", now.toISOString()),
        expression("revoked_at", "is not", null)
      ]))
      .execute();
  }
}

export const oidcSessionTokenForTesting = { hashSessionToken };
