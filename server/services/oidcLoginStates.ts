import type { PersistenceExecutor, PersistenceRuntime } from "../db/runtime.js";

export type OidcLoginContext =
  | { type: "normal" }
  | { type: "owner_setup"; tokenHash: string }
  | { type: "invitation"; tokenHash: string };

export interface OidcLoginStateRecord {
  state: string;
  nonce: string;
  pkceVerifier: string;
  redirectUri: string;
  context: OidcLoginContext;
  createdAt: string;
  expiresAt: string;
}

interface OidcLoginStateRow {
  state: string;
  nonce: string;
  pkce_verifier: string;
  redirect_uri: string;
  context_type: OidcLoginContext["type"];
  context_token_hash: string | null;
  created_at: string;
  expires_at: string;
}

function toRecord(row: OidcLoginStateRow): OidcLoginStateRecord {
  const context = row.context_type === "normal"
    ? { type: "normal" } as const
    : { type: row.context_type, tokenHash: row.context_token_hash! };
  return {
    state: row.state,
    nonce: row.nonce,
    pkceVerifier: row.pkce_verifier,
    redirectUri: row.redirect_uri,
    context,
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}

export class OidcLoginStateStore {
  readonly #database: PersistenceRuntime;

  constructor(database: PersistenceRuntime) {
    this.#database = database;
  }

  async create(
    record: Pick<OidcLoginStateRecord, "state" | "nonce" | "pkceVerifier" | "redirectUri"> & {
      context?: OidcLoginContext;
    },
    ttlSeconds: number,
    now = new Date()
  ): Promise<OidcLoginStateRecord> {
    await this.deleteExpired(now);
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const context = record.context ?? { type: "normal" as const };
    const tokenHash = context.type === "normal" ? null : context.tokenHash;
    if (tokenHash !== null && !/^[0-9a-f]{64}$/.test(tokenHash)) {
      throw new Error("OIDC login context token hash must be a SHA-256 hex digest.");
    }
    await this.#database.run(`
      INSERT INTO native_oidc_login_states (
        state, nonce, pkce_verifier, redirect_uri, context_type,
        context_token_hash, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      record.state,
      record.nonce,
      record.pkceVerifier,
      record.redirectUri,
      context.type,
      tokenHash,
      createdAt,
      expiresAt
    ]);
    return { ...record, context, createdAt, expiresAt };
  }

  async consume(state: string, now = new Date()): Promise<OidcLoginStateRecord | undefined> {
    return this.#database.transaction(async (transaction) => {
      const nowIso = now.toISOString();
      const row = await transaction.one<OidcLoginStateRow>(`
        SELECT state, nonce, pkce_verifier, redirect_uri, context_type,
               context_token_hash, created_at, expires_at
        FROM native_oidc_login_states
        WHERE state = ?
          AND consumed_at IS NULL
          AND expires_at > ?
      `, [state, nowIso]);
      if (!row) return undefined;
      const update = await transaction.run(`
        UPDATE native_oidc_login_states
        SET consumed_at = ?
        WHERE state = ?
          AND consumed_at IS NULL
      `, [nowIso, state]);
      if (update.affectedRows !== 1) return undefined;
      return toRecord(row);
    });
  }

  async deleteExpired(now = new Date()): Promise<void> {
    await this.#database.run(`
      DELETE FROM native_oidc_login_states
      WHERE expires_at <= ?
        OR consumed_at IS NOT NULL
    `, [now.toISOString()]);
  }
}
