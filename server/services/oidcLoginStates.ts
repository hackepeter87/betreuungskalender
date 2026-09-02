import type { PersistenceRuntime } from "../db/runtime.js";

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

export class OidcLoginStateStore {
  constructor(private readonly persistence: PersistenceRuntime) {}

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
    await this.persistence.query.insertInto("native_oidc_login_states").values({
      state: record.state,
      nonce: record.nonce,
      pkce_verifier: record.pkceVerifier,
      redirect_uri: record.redirectUri,
      context_type: context.type,
      context_token_hash: tokenHash,
      created_at: createdAt,
      expires_at: expiresAt,
      consumed_at: null
    }).execute();
    return { ...record, context, createdAt, expiresAt };
  }

  async consume(state: string, now = new Date()): Promise<OidcLoginStateRecord | undefined> {
    return this.persistence.transaction(async (database) => {
      const nowIso = now.toISOString();
      const row = await database.selectFrom("native_oidc_login_states")
        .select([
          "state", "nonce", "pkce_verifier", "redirect_uri", "context_type",
          "context_token_hash", "created_at", "expires_at"
        ])
        .where("state", "=", state)
        .where("consumed_at", "is", null)
        .where("expires_at", ">", nowIso)
        .executeTakeFirst();
      if (!row) return undefined;
      const update = await database.updateTable("native_oidc_login_states")
        .set({ consumed_at: nowIso })
        .where("state", "=", state)
        .where("consumed_at", "is", null)
        .executeTakeFirst();
      if (Number(update.numUpdatedRows) !== 1) return undefined;
      const context = row.context_type === "normal"
        ? { type: "normal" } as const
        : { type: row.context_type, tokenHash: row.context_token_hash! } as OidcLoginContext;
      return {
        state: row.state,
        nonce: row.nonce,
        pkceVerifier: row.pkce_verifier,
        redirectUri: row.redirect_uri,
        context,
        createdAt: row.created_at,
        expiresAt: row.expires_at
      };
    });
  }

  async deleteExpired(now = new Date()): Promise<void> {
    await this.persistence.query.deleteFrom("native_oidc_login_states")
      .where((expression) => expression.or([
        expression("expires_at", "<=", now.toISOString()),
        expression("consumed_at", "is not", null)
      ]))
      .execute();
  }
}
