import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseExecutor } from "../db/runtime.js";

export interface OidcSessionRecord {
  id: string;
  externalSubject: string;
  createdAt: string;
  lastSeenAt?: string;
  expiresAt: string;
}

export class OidcSessionLimitError extends Error {
  readonly code = "demo_session_limit";
  readonly statusCode = 429;

  constructor() {
    super("Die maximale Anzahl aktiver Demo-Sitzungen ist erreicht.");
  }
}

export interface OidcSessionStoreOptions {
  maxActiveSessions?: number;
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function revokeOidcSessionsByExternalSubject(
  externalSubject: string,
  database: DatabaseExecutor,
  revokedAt = new Date().toISOString()
): Promise<number> {
  const result = await database.updateTable("native_oidc_sessions")
    .set({ revoked_at: revokedAt })
    .where("external_subject", "=", externalSubject)
    .where("revoked_at", "is", null)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

export class OidcSessionStore {
  private creationGate: Promise<void> = Promise.resolve();

  constructor(
    private readonly database: DatabaseExecutor,
    private readonly options: OidcSessionStoreOptions = {}
  ) {}

  async create(
    externalSubject: string,
    ttlSeconds: number,
    now = new Date(),
    database: DatabaseExecutor = this.database
  ) {
    const previous = this.creationGate;
    let release!: () => void;
    this.creationGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await this.deleteExpired(now, database);
      if (this.options.maxActiveSessions !== undefined) {
        const active = await database.selectFrom("native_oidc_sessions")
          .select(({ fn }) => fn.countAll<number>().as("count"))
          .where("revoked_at", "is", null)
          .where("expires_at", ">", now.toISOString())
          .executeTakeFirstOrThrow();
        if (Number(active.count) >= this.options.maxActiveSessions) {
          throw new OidcSessionLimitError();
        }
      }
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
    } finally {
      release();
    }
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
