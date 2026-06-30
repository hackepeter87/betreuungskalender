import type Database from "better-sqlite3";
import { db as defaultDb } from "../db/connection.js";

export interface OidcLoginStateRecord {
  state: string;
  nonce: string;
  pkceVerifier: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
}

interface OidcLoginStateRow {
  state: string;
  nonce: string;
  pkce_verifier: string;
  redirect_uri: string;
  created_at: string;
  expires_at: string;
}

function toRecord(row: OidcLoginStateRow): OidcLoginStateRecord {
  return {
    state: row.state,
    nonce: row.nonce,
    pkceVerifier: row.pkce_verifier,
    redirectUri: row.redirect_uri,
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
    record: Pick<OidcLoginStateRecord, "state" | "nonce" | "pkceVerifier" | "redirectUri">,
    ttlSeconds: number,
    now = new Date()
  ): OidcLoginStateRecord {
    this.deleteExpired(now);
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    this.#db.prepare(`
      INSERT INTO native_oidc_login_states (
        state, nonce, pkce_verifier, redirect_uri, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      record.state,
      record.nonce,
      record.pkceVerifier,
      record.redirectUri,
      createdAt,
      expiresAt
    );
    return { ...record, createdAt, expiresAt };
  }

  consume(state: string, now = new Date()): OidcLoginStateRecord | undefined {
    const consumeState = this.#db.transaction(() => {
      const nowIso = now.toISOString();
      const row = this.#db.prepare(`
        SELECT state, nonce, pkce_verifier, redirect_uri, created_at, expires_at
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
