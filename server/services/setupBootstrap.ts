import type Database from "better-sqlite3";
import type { RequestUser } from "../auth.js";
import { db } from "../db/connection.js";
import { setMembershipRole } from "./memberships.js";
import { buildSetupState, publicSetupState } from "./setupState.js";

export class SetupBootstrapError extends Error {
  constructor(
    public readonly code: "setup_already_complete" | "unknown_user",
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

function assertKnownUser(userId: string, database: Database.Database): void {
  const row = database.prepare(`
    SELECT id
    FROM app_users
    WHERE id = ? AND deleted_at IS NULL
  `).get(userId) as { id: string } | undefined;
  if (!row) {
    throw new SetupBootstrapError(
      "unknown_user",
      400,
      "Der angemeldete Nutzer ist noch nicht als App-Nutzer bekannt."
    );
  }
}

function upsertSetting(
  database: Database.Database,
  key: string,
  value: unknown,
  actorId: string,
  timestamp: string
): void {
  database.prepare(`
    INSERT INTO settings (key, value_json, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `).run(key, JSON.stringify(value), actorId, actorId, timestamp, timestamp);
}

function recordBootstrapAudit(
  database: Database.Database,
  actorId: string,
  fieldName: string,
  value: unknown,
  timestamp: string
): void {
  database.prepare(`
    INSERT INTO audit_log (
      timestamp, user_email, entity_type, entity_id, action, field_name,
      old_value, new_value, created_at, updated_at
    ) VALUES (?, ?, 'setup', 'installation', 'updated', ?, NULL, ?, ?, ?)
  `).run(timestamp, actorId, fieldName, JSON.stringify(value), timestamp, timestamp);
}

export function bootstrapInstallationOwner(
  user: RequestUser,
  timestamp = new Date().toISOString(),
  database: Database.Database = db
) {
  return database.transaction(() => {
    const setup = buildSetupState(database);
    if (setup.complete) {
      throw new SetupBootstrapError(
        "setup_already_complete",
        409,
        "Die Installation wurde bereits eingerichtet."
      );
    }

    assertKnownUser(user.id, database);
    setMembershipRole(user.id, "admin", user.id, timestamp, database);
    upsertSetting(database, "setup.ownerUserId", user.id, user.id, timestamp);
    upsertSetting(database, "setup.completedAt", timestamp, user.id, timestamp);
    upsertSetting(database, "setup.completedBy", user.id, user.id, timestamp);
    recordBootstrapAudit(database, user.id, "owner_bootstrap", {
      userId: user.id,
      role: "admin"
    }, timestamp);
    recordBootstrapAudit(database, user.id, "setup_completed", {
      completedAt: timestamp,
      completedBy: user.id
    }, timestamp);

    return {
      setup: publicSetupState(database),
      completedAt: timestamp,
      owner: {
        id: user.id,
        displayName: user.displayName,
        role: "admin" as const,
        ...(user.email ? { email: user.email } : {})
      }
    };
  })();
}
