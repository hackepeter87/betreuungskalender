import type Database from "better-sqlite3";
import type { RequestUser } from "../auth.js";
import { db } from "../db/connection.js";
import type { ApiCarePartyKind } from "../../shared/api.js";
import { setMembershipRole } from "./memberships.js";
import { buildSetupState, publicSetupState } from "./setupState.js";
import { makeId } from "./common.js";

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

function recordSetupComplete(
  database: Database.Database,
  user: RequestUser,
  timestamp: string
) {
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
    return recordSetupComplete(database, user, timestamp);
  })();
}

export interface FirstUseSetupInput {
  installationLabel?: string;
  careParty: {
    name: string;
    kind: ApiCarePartyKind;
  };
  child?: {
    name: string;
    birthMonth: number;
    birthYear: number;
    color: string;
  };
}

export function completeFirstUseSetup(
  user: RequestUser,
  input: FirstUseSetupInput,
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

    const carePartyId = makeId("party");
    database.prepare(`
      INSERT INTO care_parties (
        id, name, kind, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      carePartyId,
      input.careParty.name,
      input.careParty.kind,
      user.id,
      user.id,
      timestamp,
      timestamp
    );
    recordBootstrapAudit(database, user.id, "care_party_created", {
      carePartyId,
      kind: input.careParty.kind
    }, timestamp);

    let childId: string | undefined;
    if (input.child) {
      childId = makeId("child");
      database.prepare(`
        INSERT INTO children (
          id, name, birth_month, birth_year, color, created_by, updated_by,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        childId,
        input.child.name,
        input.child.birthMonth,
        input.child.birthYear,
        input.child.color,
        user.id,
        user.id,
        timestamp,
        timestamp
      );
      recordBootstrapAudit(database, user.id, "child_created", {
        childId
      }, timestamp);
    }

    upsertSetting(database, "defaultResponsiblePartyId", carePartyId, user.id, timestamp);
    if (input.installationLabel) {
      upsertSetting(database, "setup.installationLabel", input.installationLabel, user.id, timestamp);
    }

    const completed = recordSetupComplete(database, user, timestamp);
    return {
      ...completed,
      created: {
        carePartyId,
        ...(childId ? { childId } : {})
      }
    };
  })();
}
