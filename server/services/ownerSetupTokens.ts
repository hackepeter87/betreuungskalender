import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type { RequestUser } from "../auth.js";
import type { PersistenceExecutor, PersistenceRuntime } from "../db/runtime.js";
import { setMembershipRole } from "./memberships.js";

export class OwnerSetupTokenError extends Error {
  constructor(
    readonly code:
      | "owner_setup_unavailable"
      | "owner_setup_invalid"
      | "owner_setup_expired"
      | "owner_setup_consumed"
      | "setup_already_complete",
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

interface OwnerSetupTokenOptions {
  tokenFile: string;
  ttlSeconds: number;
  database: PersistenceRuntime;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashesEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

async function setting(database: PersistenceExecutor, key: string): Promise<unknown> {
  const row = await database.one<{ value_json: string }>(`
    SELECT value_json
    FROM settings
    WHERE key = ? AND deleted_at IS NULL
  `, [key]);
  return row ? JSON.parse(row.value_json) : undefined;
}

async function upsertSetting(
  database: PersistenceExecutor,
  key: string,
  value: unknown,
  actorId: string,
  timestamp: string
): Promise<void> {
  await database.run(`
    INSERT INTO settings (key, value_json, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `, [key, JSON.stringify(value), actorId, actorId, timestamp, timestamp]);
}

async function recordAudit(
  database: PersistenceExecutor,
  actorId: string,
  fieldName: string,
  timestamp: string
): Promise<void> {
  await database.run(`
    INSERT INTO audit_log (
      timestamp, user_email, entity_type, entity_id, action, field_name,
      old_value, new_value, created_at, updated_at
    ) VALUES (?, ?, 'setup', 'installation', 'updated', ?, NULL, ?, ?, ?)
  `, [
    timestamp, actorId, fieldName, JSON.stringify({ recorded: true }),
    timestamp, timestamp
  ]);
}

export class OwnerSetupTokenStore {
  readonly #database: PersistenceRuntime;
  readonly #tokenFile: string;
  readonly #ttlSeconds: number;

  constructor(options: OwnerSetupTokenOptions) {
    this.#database = options.database;
    this.#tokenFile = options.tokenFile;
    this.#ttlSeconds = options.ttlSeconds;
  }

  #currentToken(now: Date): { hash: string; createdAt: Date; expiresAt: Date } {
    let configuredToken: string;
    let createdAt: Date;
    try {
      configuredToken = readFileSync(this.#tokenFile, "utf8").trim();
      createdAt = statSync(this.#tokenFile).mtime;
    } catch {
      throw new OwnerSetupTokenError(
        "owner_setup_unavailable",
        404,
        "Der Owner-Setup-Link ist nicht verfügbar."
      );
    }
    if (!configuredToken) {
      throw new OwnerSetupTokenError(
        "owner_setup_invalid",
        403,
        "Der Owner-Setup-Link ist ungültig."
      );
    }

    const expiresAt = new Date(createdAt.getTime() + this.#ttlSeconds * 1000);
    if (expiresAt <= now) {
      throw new OwnerSetupTokenError(
        "owner_setup_expired",
        410,
        "Der Owner-Setup-Link ist abgelaufen."
      );
    }
    return {
      hash: tokenHash(configuredToken),
      createdAt,
      expiresAt
    };
  }

  async #rejectStaleContext(now: Date): Promise<never> {
    await recordAudit(
      this.#database,
      "system",
      "owner_setup_context_rejected",
      now.toISOString()
    );
    throw new OwnerSetupTokenError(
      "owner_setup_invalid",
      403,
      "Der Owner-Setup-Link ist ungültig, abgelaufen oder nicht mehr verfügbar."
    );
  }

  async begin(rawToken: string, now = new Date()): Promise<string> {
    if (!rawToken.trim()) {
      throw new OwnerSetupTokenError(
        "owner_setup_invalid",
        403,
        "Der Owner-Setup-Link ist ungültig."
      );
    }

    const currentToken = this.#currentToken(now);
    const configuredHash = currentToken.hash;
    const candidateHash = tokenHash(rawToken.trim());
    if (!hashesEqual(configuredHash, candidateHash)) {
      throw new OwnerSetupTokenError(
        "owner_setup_invalid",
        403,
        "Der Owner-Setup-Link ist ungültig."
      );
    }

    await this.#database.run(`
      INSERT INTO owner_setup_tokens (token_hash, created_at, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(token_hash) DO NOTHING
    `, [
      configuredHash,
      currentToken.createdAt.toISOString(),
      currentToken.expiresAt.toISOString()
    ]);

    const row = await this.#database.one<{ consumed_at: string | null; expires_at: string }>(`
      SELECT consumed_at, expires_at
      FROM owner_setup_tokens
      WHERE token_hash = ?
    `, [configuredHash]);
    if (!row || row.expires_at <= now.toISOString()) {
      throw new OwnerSetupTokenError(
        "owner_setup_expired",
        410,
        "Der Owner-Setup-Link ist abgelaufen."
      );
    }
    if (row?.consumed_at) {
      await recordAudit(
        this.#database,
        "system",
        "owner_setup_reuse_rejected",
        now.toISOString()
      );
      throw new OwnerSetupTokenError(
        "owner_setup_consumed",
        409,
        "Der Owner-Setup-Link wurde bereits verwendet."
      );
    }
    if (await setting(this.#database, "setup.ownerUserId")) {
      throw new OwnerSetupTokenError(
        "setup_already_complete",
        409,
        "Ein Installationseigentümer wurde bereits festgelegt."
      );
    }
    return configuredHash;
  }

  async consumeAndClaim(
    tokenDigest: string,
    user: RequestUser,
    now = new Date()
  ): Promise<void> {
    let currentToken: { hash: string; createdAt: Date; expiresAt: Date };
    try {
      currentToken = this.#currentToken(now);
    } catch {
      return this.#rejectStaleContext(now);
    }
    if (!hashesEqual(currentToken.hash, tokenDigest)) {
      return this.#rejectStaleContext(now);
    }

    await this.#database.transaction(async (transaction) => {
      if (await setting(transaction, "setup.ownerUserId")) {
        throw new OwnerSetupTokenError(
          "setup_already_complete",
          409,
          "Ein Installationseigentümer wurde bereits festgelegt."
        );
      }
      const timestamp = now.toISOString();
      const update = await transaction.run(`
        UPDATE owner_setup_tokens
        SET consumed_at = ?, consumed_by = ?
        WHERE token_hash = ?
          AND consumed_at IS NULL
          AND expires_at > ?
      `, [timestamp, user.id, tokenDigest, timestamp]);
      if (update.affectedRows !== 1) {
        throw new OwnerSetupTokenError(
          "owner_setup_consumed",
          409,
          "Der Owner-Setup-Link ist ungültig, abgelaufen oder bereits verwendet."
        );
      }
      await setMembershipRole(user.id, "admin", user.id, transaction, timestamp);
      await upsertSetting(transaction, "setup.ownerUserId", user.id, user.id, timestamp);
      await recordAudit(transaction, user.id, "owner_setup_token_consumed", timestamp);
      await recordAudit(transaction, user.id, "owner_bootstrap", timestamp);
    });
  }
}
