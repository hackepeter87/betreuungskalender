import { permissionsForRole, type RequestUser } from "../auth.js";
import type { DatabaseExecutor, PersistenceRuntime } from "../db/runtime.js";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { upsertAuthenticatedUser } from "./users.js";

export interface RecoveryAdminConfig {
  enabled: boolean;
  username: string;
  initialPasswordFile?: string;
  initialPassword?: string;
  sessionTtlSeconds: number;
}

export interface RecoverySessionRecord {
  id: string;
  username: string;
  createdAt: string;
  lastSeenAt?: string;
  expiresAt: string;
  passwordChangeRequired: boolean;
}

interface RecoveryLoginResult {
  token: string;
  session: RecoverySessionRecord;
  user?: RequestUser;
}

type RecoveryCredentialRow = {
  username: string;
  password_hash: string;
  password_salt: string;
};

export class RecoveryAdminError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) {
    super(message);
  }
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashPassword(password: string, salt = randomBytes(16).toString("base64url")) {
  return {
    hash: scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1 }).toString("base64url"),
    salt
  };
}

function passwordMatches(password: string, row: RecoveryCredentialRow): boolean {
  const candidate = Buffer.from(hashPassword(password, row.password_salt).hash, "base64url");
  const stored = Buffer.from(row.password_hash, "base64url");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

function safeUsername(username: string): string {
  return username.trim().replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 64) || "breakglass";
}

function userForUsername(username: string): RequestUser {
  const normalized = safeUsername(username);
  return {
    id: `recovery_${createHash("sha256").update(normalized).digest("hex").slice(0, 24)}`,
    externalSubject: `recovery:${normalized}`,
    displayName: normalized,
    groups: ["recovery:admin"],
    role: "admin",
    permissions: permissionsForRole("admin")
  };
}

export class RecoveryAdminStore {
  constructor(
    private readonly config: RecoveryAdminConfig,
    private readonly persistence: PersistenceRuntime
  ) {}

  async ensureConfigured(): Promise<void> {
    if (!this.config.enabled) return;
    if (await this.hasCredential() || this.#initialPassword()) return;
    throw new Error(
      "RECOVERY_ADMIN_ENABLED=true requires an existing recovery credential or RECOVERY_ADMIN_INITIAL_PASSWORD_FILE / RECOVERY_ADMIN_INITIAL_PASSWORD."
    );
  }

  async hasCredential(): Promise<boolean> {
    return Boolean(await this.#credential(this.persistence.query));
  }

  async login(username: string, password: string, now = new Date()): Promise<RecoveryLoginResult> {
    this.#requireEnabled();
    const normalizedUsername = safeUsername(this.config.username);
    if (safeUsername(username) !== normalizedUsername) {
      await this.#audit(this.persistence.query, "login_failed", safeUsername(username), now);
      throw new RecoveryAdminError("recovery_login_failed", 401, "Anmeldung fehlgeschlagen.");
    }
    const credential = await this.#credential(this.persistence.query);
    if (credential) {
      if (!passwordMatches(password, credential)) {
        await this.#audit(this.persistence.query, "login_failed", normalizedUsername, now);
        throw new RecoveryAdminError("recovery_login_failed", 401, "Anmeldung fehlgeschlagen.");
      }
      return this.persistence.transaction(async (database) => {
        const user = userForUsername(normalizedUsername);
        await upsertAuthenticatedUser(user, database, now.toISOString());
        const created = await this.#createSession(database, normalizedUsername, false, now);
        await this.#audit(database, "login_succeeded", normalizedUsername, now);
        return { ...created, user };
      });
    }
    const initialPassword = this.#initialPassword();
    if (!initialPassword || initialPassword !== password) {
      await this.#audit(this.persistence.query, "login_failed", normalizedUsername, now);
      throw new RecoveryAdminError("recovery_login_failed", 401, "Anmeldung fehlgeschlagen.");
    }
    return this.persistence.transaction(async (database) => {
      const created = await this.#createSession(database, normalizedUsername, true, now);
      await this.#audit(database, "bootstrap_login_succeeded", normalizedUsername, now);
      return created;
    });
  }

  async changePassword(token: string | undefined, newPassword: string, now = new Date()) {
    this.#requireEnabled();
    if (newPassword.trim().length < 12) {
      throw new RecoveryAdminError(
        "recovery_password_rejected",
        400,
        "Das neue Passwort muss mindestens 12 Zeichen lang sein."
      );
    }
    const session = await this.findSessionByToken(token, now);
    if (!session) {
      throw new RecoveryAdminError("authentication_required", 401, "Authentifizierung erforderlich.");
    }
    const { hash, salt } = hashPassword(newPassword);
    const timestamp = now.toISOString();
    const user = userForUsername(session.username);
    await this.persistence.transaction(async (database) => {
      await database.insertInto("recovery_admin_credentials").values({
        username: session.username,
        password_hash: hash,
        password_salt: salt,
        password_changed_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp
      }).onConflict((conflict) => conflict.column("username").doUpdateSet({
        password_hash: hash,
        password_salt: salt,
        password_changed_at: timestamp,
        updated_at: timestamp
      })).execute();
      await database.updateTable("recovery_admin_sessions")
        .set({ revoked_at: timestamp })
        .where("username", "=", session.username)
        .where("id", "!=", session.id)
        .where("revoked_at", "is", null)
        .execute();
      await database.updateTable("recovery_admin_sessions")
        .set({ password_change_required: 0, last_seen_at: timestamp })
        .where("id", "=", session.id)
        .execute();
      await upsertAuthenticatedUser(user, database, timestamp);
      await this.#audit(database, "password_changed", session.username, now);
    });
    const refreshed = await this.findSessionByToken(token, now);
    if (!refreshed) {
      throw new RecoveryAdminError("authentication_required", 401, "Authentifizierung erforderlich.");
    }
    return { session: refreshed, user };
  }

  async findSessionByToken(
    token: string | undefined,
    now = new Date()
  ): Promise<RecoverySessionRecord | undefined> {
    if (!this.config.enabled) return undefined;
    const normalized = token?.trim();
    if (!normalized) return undefined;
    const nowIso = now.toISOString();
    const row = await this.persistence.query.selectFrom("recovery_admin_sessions")
      .select(["id", "username", "password_change_required", "created_at", "last_seen_at", "expires_at"])
      .where("session_hash", "=", hashSessionToken(normalized))
      .where("revoked_at", "is", null)
      .where("expires_at", ">", nowIso)
      .executeTakeFirst();
    if (!row) return undefined;
    await this.persistence.query.updateTable("recovery_admin_sessions")
      .set({ last_seen_at: nowIso })
      .where("id", "=", row.id)
      .execute();
    return {
      id: row.id,
      username: row.username,
      createdAt: row.created_at,
      lastSeenAt: nowIso,
      expiresAt: row.expires_at,
      passwordChangeRequired: row.password_change_required === 1
    };
  }

  async findUserByToken(token: string | undefined, now = new Date()): Promise<RequestUser | undefined> {
    const session = await this.findSessionByToken(token, now);
    if (!session || session.passwordChangeRequired) return undefined;
    const user = userForUsername(session.username);
    await upsertAuthenticatedUser(user, this.persistence.query, now.toISOString());
    return user;
  }

  async revokeByToken(token: string | undefined, now = new Date()): Promise<boolean> {
    const normalized = token?.trim();
    if (!normalized) return false;
    const session = await this.findSessionByToken(normalized, now);
    const result = await this.persistence.query.updateTable("recovery_admin_sessions")
      .set({ revoked_at: now.toISOString() })
      .where("session_hash", "=", hashSessionToken(normalized))
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    const revoked = Number(result.numUpdatedRows) > 0;
    if (revoked && session) {
      await this.#audit(this.persistence.query, "logout", session.username, now);
    }
    return revoked;
  }

  #requireEnabled(): void {
    if (!this.config.enabled) {
      throw new RecoveryAdminError("not_found", 404, "Ressource nicht gefunden.");
    }
  }

  #credential(database: DatabaseExecutor): Promise<RecoveryCredentialRow | undefined> {
    return database.selectFrom("recovery_admin_credentials")
      .select(["username", "password_hash", "password_salt"])
      .where("username", "=", safeUsername(this.config.username))
      .executeTakeFirst();
  }

  async #createSession(
    database: DatabaseExecutor,
    username: string,
    passwordChangeRequired: boolean,
    now: Date
  ) {
    const token = randomBytes(32).toString("base64url");
    const timestamp = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlSeconds * 1000).toISOString();
    const session: RecoverySessionRecord = {
      id: randomUUID(),
      username,
      createdAt: timestamp,
      expiresAt,
      passwordChangeRequired
    };
    await database.insertInto("recovery_admin_sessions").values({
      id: session.id,
      session_hash: hashSessionToken(token),
      username,
      password_change_required: passwordChangeRequired ? 1 : 0,
      created_at: timestamp,
      last_seen_at: null,
      expires_at: expiresAt,
      revoked_at: null
    }).execute();
    return { token, session };
  }

  #initialPassword(): string | undefined {
    const file = this.config.initialPasswordFile?.trim();
    if (file) {
      try {
        const value = readFileSync(file, "utf8").trim();
        if (value) return value;
      } catch {
        // Stored credentials or the environment fallback may still be available.
      }
    }
    return this.config.initialPassword?.trim() || undefined;
  }

  async #audit(
    database: DatabaseExecutor,
    event: string,
    username: string,
    now: Date
  ): Promise<void> {
    const timestamp = now.toISOString();
    const normalized = safeUsername(username);
    await database.insertInto("audit_log").values({
      timestamp,
      user_email: `recovery:${normalized}`,
      entity_type: "recovery_admin",
      entity_id: normalized,
      action: "created",
      field_name: event,
      old_value: null,
      new_value: null,
      metadata_json: JSON.stringify({ event }),
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null
    }).execute();
  }
}

export const recoveryAdminTesting = { hashSessionToken, hashPassword, userForUsername };
