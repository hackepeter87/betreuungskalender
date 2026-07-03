import type Database from "better-sqlite3";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { db as defaultDb } from "../db/connection.js";
import { permissionsForRole, type RequestUser } from "../auth.js";
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

interface RecoveryCredentialRow {
  username: string;
  password_hash: string;
  password_salt: string;
}

interface RecoverySessionRow {
  id: string;
  username: string;
  password_change_required: number;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string;
}

export class RecoveryAdminError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashPassword(password: string, salt = randomBytes(16).toString("base64url")) {
  const hash = scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1 }).toString("base64url");
  return { hash, salt };
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

function toRecord(row: RecoverySessionRow): RecoverySessionRecord {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.created_at,
    ...(row.last_seen_at ? { lastSeenAt: row.last_seen_at } : {}),
    expiresAt: row.expires_at,
    passwordChangeRequired: row.password_change_required === 1
  };
}

export class RecoveryAdminStore {
  readonly #db: Database.Database;
  readonly #config: RecoveryAdminConfig;

  constructor(
    config: RecoveryAdminConfig,
    database: Database.Database = defaultDb
  ) {
    this.#config = config;
    this.#db = database;
  }

  ensureConfigured(): void {
    if (!this.#config.enabled) return;
    if (this.hasCredential() || this.#initialPassword()) return;
    throw new Error(
      "RECOVERY_ADMIN_ENABLED=true requires an existing recovery credential or RECOVERY_ADMIN_INITIAL_PASSWORD_FILE / RECOVERY_ADMIN_INITIAL_PASSWORD."
    );
  }

  hasCredential(): boolean {
    return Boolean(this.#credential());
  }

  login(
    username: string,
    password: string,
    now = new Date()
  ): { token: string; session: RecoverySessionRecord; user?: RequestUser } {
    this.#requireEnabled();
    const normalizedUsername = safeUsername(this.#config.username);
    if (safeUsername(username) !== normalizedUsername) {
      this.#audit("login_failed", safeUsername(username), now);
      throw new RecoveryAdminError("recovery_login_failed", 401, "Anmeldung fehlgeschlagen.");
    }

    const credential = this.#credential();
    if (credential) {
      if (!passwordMatches(password, credential)) {
        this.#audit("login_failed", normalizedUsername, now);
        throw new RecoveryAdminError("recovery_login_failed", 401, "Anmeldung fehlgeschlagen.");
      }
      const user = userForUsername(normalizedUsername);
      upsertAuthenticatedUser(user, now.toISOString(), this.#db);
      const created = this.#createSession(normalizedUsername, false, now);
      this.#audit("login_succeeded", normalizedUsername, now);
      return { ...created, user };
    }

    const initialPassword = this.#initialPassword();
    if (!initialPassword || initialPassword !== password) {
      this.#audit("login_failed", normalizedUsername, now);
      throw new RecoveryAdminError("recovery_login_failed", 401, "Anmeldung fehlgeschlagen.");
    }
    const created = this.#createSession(normalizedUsername, true, now);
    this.#audit("bootstrap_login_succeeded", normalizedUsername, now);
    return created;
  }

  changePassword(
    token: string | undefined,
    newPassword: string,
    now = new Date()
  ): { session: RecoverySessionRecord; user: RequestUser } {
    this.#requireEnabled();
    if (newPassword.trim().length < 12) {
      throw new RecoveryAdminError(
        "recovery_password_rejected",
        400,
        "Das neue Passwort muss mindestens 12 Zeichen lang sein."
      );
    }
    const session = this.findSessionByToken(token, now);
    if (!session) {
      throw new RecoveryAdminError("authentication_required", 401, "Authentifizierung erforderlich.");
    }

    const { hash, salt } = hashPassword(newPassword);
    const timestamp = now.toISOString();
    this.#db.prepare(`
      INSERT INTO recovery_admin_credentials (
        username, password_hash, password_salt, password_changed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        password_hash = excluded.password_hash,
        password_salt = excluded.password_salt,
        password_changed_at = excluded.password_changed_at,
        updated_at = excluded.updated_at
    `).run(session.username, hash, salt, timestamp, timestamp, timestamp);
    this.#db.prepare(`
      UPDATE recovery_admin_sessions
      SET revoked_at = ?
      WHERE username = ? AND id <> ? AND revoked_at IS NULL
    `).run(timestamp, session.username, session.id);
    this.#db.prepare(`
      UPDATE recovery_admin_sessions
      SET password_change_required = 0, last_seen_at = ?
      WHERE id = ?
    `).run(timestamp, session.id);

    const user = userForUsername(session.username);
    upsertAuthenticatedUser(user, timestamp, this.#db);
    this.#audit("password_changed", session.username, now);
    const refreshed = this.findSessionByToken(token, now);
    if (!refreshed) {
      throw new RecoveryAdminError("authentication_required", 401, "Authentifizierung erforderlich.");
    }
    return { session: refreshed, user };
  }

  findSessionByToken(token: string | undefined, now = new Date()): RecoverySessionRecord | undefined {
    if (!this.#config.enabled) return undefined;
    const normalized = token?.trim();
    if (!normalized) return undefined;
    const nowIso = now.toISOString();
    const row = this.#db.prepare(`
      SELECT id, username, password_change_required, created_at, last_seen_at, expires_at
      FROM recovery_admin_sessions
      WHERE session_hash = ?
        AND revoked_at IS NULL
        AND expires_at > ?
    `).get(hashSessionToken(normalized), nowIso) as RecoverySessionRow | undefined;
    if (!row) return undefined;
    this.#db.prepare(`
      UPDATE recovery_admin_sessions
      SET last_seen_at = ?
      WHERE id = ?
    `).run(nowIso, row.id);
    return toRecord({ ...row, last_seen_at: nowIso });
  }

  findUserByToken(token: string | undefined, now = new Date()): RequestUser | undefined {
    const session = this.findSessionByToken(token, now);
    if (!session || session.passwordChangeRequired) return undefined;
    const user = userForUsername(session.username);
    upsertAuthenticatedUser(user, now.toISOString(), this.#db);
    return user;
  }

  revokeByToken(token: string | undefined, now = new Date()): boolean {
    const normalized = token?.trim();
    if (!normalized) return false;
    const session = this.findSessionByToken(normalized, now);
    const result = this.#db.prepare(`
      UPDATE recovery_admin_sessions
      SET revoked_at = ?
      WHERE session_hash = ?
        AND revoked_at IS NULL
    `).run(now.toISOString(), hashSessionToken(normalized));
    if (result.changes > 0 && session) {
      this.#audit("logout", session.username, now);
    }
    return result.changes > 0;
  }

  #requireEnabled(): void {
    if (!this.#config.enabled) {
      throw new RecoveryAdminError("not_found", 404, "Ressource nicht gefunden.");
    }
  }

  #credential(): RecoveryCredentialRow | undefined {
    return this.#db.prepare(`
      SELECT username, password_hash, password_salt
      FROM recovery_admin_credentials
      WHERE username = ?
    `).get(safeUsername(this.#config.username)) as RecoveryCredentialRow | undefined;
  }

  #createSession(
    username: string,
    passwordChangeRequired: boolean,
    now: Date
  ): { token: string; session: RecoverySessionRecord } {
    const token = randomBytes(32).toString("base64url");
    const timestamp = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.#config.sessionTtlSeconds * 1000).toISOString();
    const session = {
      id: randomUUID(),
      username,
      createdAt: timestamp,
      expiresAt,
      passwordChangeRequired
    };
    this.#db.prepare(`
      INSERT INTO recovery_admin_sessions (
        id, session_hash, username, password_change_required, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      hashSessionToken(token),
      username,
      passwordChangeRequired ? 1 : 0,
      timestamp,
      expiresAt
    );
    return { token, session };
  }

  #initialPassword(): string | undefined {
    const file = this.#config.initialPasswordFile?.trim();
    if (file) {
      try {
        const value = readFileSync(file, "utf8").trim();
        if (value) return value;
      } catch {
        // Missing or unreadable secret files are tolerated when a stored
        // recovery credential already exists or an env fallback is configured.
      }
    }
    return this.#config.initialPassword?.trim() || undefined;
  }

  #audit(event: string, username: string, now: Date): void {
    const timestamp = now.toISOString();
    this.#db.prepare(`
      INSERT INTO audit_log (
        timestamp, user_email, entity_type, entity_id, action, field_name,
        old_value, new_value, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'created', ?, NULL, NULL, ?, ?, ?)
    `).run(
      timestamp,
      `recovery:${safeUsername(username)}`,
      "recovery_admin",
      safeUsername(username),
      event,
      JSON.stringify({ event }),
      timestamp,
      timestamp
    );
  }
}

export const recoveryAdminTesting = {
  hashSessionToken,
  hashPassword,
  userForUsername
};
