import type Database from "better-sqlite3";
import { db as defaultDb } from "../db/connection.js";

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
  readonly #db: Database.Database;

  constructor(database: Database.Database = defaultDb) {
    this.#db = database;
  }

  create(
    record: Pick<OidcLoginStateRecord, "state" | "nonce" | "pkceVerifier" | "redirectUri"> & {
      context?: OidcLoginContext;
    },
    ttlSeconds: number,
    now = new Date()
  ): OidcLoginStateRecord {
    this.deleteExpired(now);
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const context = record.context ?? { type: "normal" as const };
    const tokenHash = context.type === "normal" ? null : context.tokenHash;
    if (tokenHash !== null && !/^[0-9a-f]{64}$/.test(tokenHash)) {
      throw new Error("OIDC login context token hash must be a SHA-256 hex digest.");
    }
    this.#db.prepare(`
      INSERT INTO native_oidc_login_states (
        state, nonce, pkce_verifier, redirect_uri, context_type,
        context_token_hash, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.state,
      record.nonce,
      record.pkceVerifier,
      record.redirectUri,
      context.type,
      tokenHash,
      createdAt,
      expiresAt
    );
    return { ...record, context, createdAt, expiresAt };
  }

  consume(state: string, now = new Date()): OidcLoginStateRecord | undefined {
    const consumeState = this.#db.transaction(() => {
      const nowIso = now.toISOString();
      const row = this.#db.prepare(`
        SELECT state, nonce, pkce_verifier, redirect_uri, context_type,
               context_token_hash, created_at, expires_at
        FROM native_oidc_login_states
        WHERE state = ?
          AND consumed_at IS NULL
          AND expires_at > ?
      `).get(state, nowIso) as OidcLoginStateRow | undefined;
      if (!row) return undefined;
      this.#db.prepare(`
        UPDATE native_oidc_login_states
        SET consumed_at = ?
        WHERE state = ?
          AND consumed_at IS NULL
      `).run(nowIso, state);
      return toRecord(row);
    });
    return consumeState();
  }

  deleteExpired(now = new Date()): void {
    this.#db.prepare(`
      DELETE FROM native_oidc_login_states
      WHERE expires_at <= ?
        OR consumed_at IS NOT NULL
    `).run(now.toISOString());
  }
}
