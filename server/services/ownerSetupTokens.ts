import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type { RequestUser } from "../auth.js";
import type { DatabaseExecutor, PersistenceRuntime } from "../db/runtime.js";
import { setMembershipRole } from "./memberships.js";
import { upsertAuthenticatedUser } from "./users.js";

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
  persistence: PersistenceRuntime;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashesEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

async function setting(database: DatabaseExecutor, key: string): Promise<unknown> {
  const row = await database.selectFrom("settings")
    .select("value_json")
    .where("key", "=", key)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  return row ? JSON.parse(row.value_json) as unknown : undefined;
}

async function upsertSetting(
  database: DatabaseExecutor,
  key: string,
  value: unknown,
  actorId: string,
  timestamp: string
): Promise<void> {
  await database.insertInto("settings").values({
    key,
    value_json: JSON.stringify(value),
    created_by: actorId,
    updated_by: actorId,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null
  }).onConflict((conflict) => conflict.column("key").doUpdateSet({
    value_json: JSON.stringify(value),
    updated_by: actorId,
    updated_at: timestamp,
    deleted_at: null
  })).execute();
}

async function recordAudit(
  database: DatabaseExecutor,
  actorId: string,
  fieldName: string,
  timestamp: string
): Promise<void> {
  await database.insertInto("audit_log").values({
    timestamp,
    user_email: actorId,
    entity_type: "setup",
    entity_id: "installation",
    action: "updated",
    field_name: fieldName,
    old_value: null,
    new_value: JSON.stringify({ recorded: true }),
    metadata_json: null,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null
  }).execute();
}

export class OwnerSetupTokenStore {
  readonly #persistence: PersistenceRuntime;
  readonly #tokenFile: string;
  readonly #ttlSeconds: number;

  constructor(options: OwnerSetupTokenOptions) {
    this.#persistence = options.persistence;
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
      throw new OwnerSetupTokenError("owner_setup_unavailable", 404, "Der Owner-Setup-Link ist nicht verfügbar.");
    }
    if (!configuredToken) {
      throw new OwnerSetupTokenError("owner_setup_invalid", 403, "Der Owner-Setup-Link ist ungültig.");
    }
    const expiresAt = new Date(createdAt.getTime() + this.#ttlSeconds * 1000);
    if (expiresAt <= now) {
      throw new OwnerSetupTokenError("owner_setup_expired", 410, "Der Owner-Setup-Link ist abgelaufen.");
    }
    return { hash: tokenHash(configuredToken), createdAt, expiresAt };
  }

  async #rejectStaleContext(now: Date): Promise<never> {
    await recordAudit(
      this.#persistence.query,
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
      throw new OwnerSetupTokenError("owner_setup_invalid", 403, "Der Owner-Setup-Link ist ungültig.");
    }
    const currentToken = this.#currentToken(now);
    const configuredHash = currentToken.hash;
    if (!hashesEqual(configuredHash, tokenHash(rawToken.trim()))) {
      throw new OwnerSetupTokenError("owner_setup_invalid", 403, "Der Owner-Setup-Link ist ungültig.");
    }
    await this.#persistence.query.insertInto("owner_setup_tokens").values({
      token_hash: configuredHash,
      created_at: currentToken.createdAt.toISOString(),
      expires_at: currentToken.expiresAt.toISOString(),
      consumed_at: null,
      consumed_by: null
    }).onConflict((conflict) => conflict.column("token_hash").doNothing()).execute();
    const row = await this.#persistence.query.selectFrom("owner_setup_tokens")
      .select(["consumed_at", "expires_at"])
      .where("token_hash", "=", configuredHash)
      .executeTakeFirst();
    if (!row || row.expires_at <= now.toISOString()) {
      throw new OwnerSetupTokenError("owner_setup_expired", 410, "Der Owner-Setup-Link ist abgelaufen.");
    }
    if (row.consumed_at) {
      await recordAudit(
        this.#persistence.query,
        "system",
        "owner_setup_reuse_rejected",
        now.toISOString()
      );
      throw new OwnerSetupTokenError("owner_setup_consumed", 409, "Der Owner-Setup-Link wurde bereits verwendet.");
    }
    if (await setting(this.#persistence.query, "setup.ownerUserId")) {
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
    now = new Date(),
    activeTransaction?: DatabaseExecutor
  ): Promise<void> {
    let currentToken: { hash: string; createdAt: Date; expiresAt: Date };
    try {
      currentToken = this.#currentToken(now);
    } catch {
      return this.#rejectStaleContext(now);
    }
    if (!hashesEqual(currentToken.hash, tokenDigest)) return this.#rejectStaleContext(now);
    const claim = async (database: DatabaseExecutor): Promise<void> => {
      if (await setting(database, "setup.ownerUserId")) {
        throw new OwnerSetupTokenError(
          "setup_already_complete",
          409,
          "Ein Installationseigentümer wurde bereits festgelegt."
        );
      }
      const timestamp = now.toISOString();
      await upsertAuthenticatedUser(user, database, timestamp);
      const update = await database.updateTable("owner_setup_tokens")
        .set({ consumed_at: timestamp, consumed_by: user.id })
        .where("token_hash", "=", tokenDigest)
        .where("consumed_at", "is", null)
        .where("expires_at", ">", timestamp)
        .executeTakeFirst();
      if (Number(update.numUpdatedRows) !== 1) {
        throw new OwnerSetupTokenError(
          "owner_setup_consumed",
          409,
          "Der Owner-Setup-Link ist ungültig, abgelaufen oder bereits verwendet."
        );
      }
      await setMembershipRole(user.id, "admin", user.id, database, timestamp);
      await upsertSetting(database, "setup.ownerUserId", user.id, user.id, timestamp);
      await recordAudit(database, user.id, "owner_setup_token_consumed", timestamp);
      await recordAudit(database, user.id, "owner_bootstrap", timestamp);
    };
    if (activeTransaction) {
      await claim(activeTransaction);
      return;
    }
    await this.#persistence.transaction(claim);
  }
}
