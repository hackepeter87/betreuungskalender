import type { RequestUser } from "../auth.js";
import type { PersistenceExecutor, PersistenceRuntime } from "../db/runtime.js";
import type { ApiCarePartyKind, ApiSetupChildInput } from "../../shared/api.js";
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

async function assertKnownUser(userId: string, database: PersistenceExecutor): Promise<void> {
  const row = await database.one<{ id: string }>(`
    SELECT id
    FROM app_users
    WHERE id = ? AND deleted_at IS NULL
  `, [userId]);
  if (!row) {
    throw new SetupBootstrapError(
      "unknown_user",
      400,
      "Der angemeldete Nutzer ist noch nicht als App-Nutzer bekannt."
    );
  }
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

async function recordBootstrapAudit(
  database: PersistenceExecutor,
  actorId: string,
  fieldName: string,
  value: unknown,
  timestamp: string
): Promise<void> {
  await database.run(`
    INSERT INTO audit_log (
      timestamp, user_email, entity_type, entity_id, action, field_name,
      old_value, new_value, created_at, updated_at
    ) VALUES (?, ?, 'setup', 'installation', 'updated', ?, NULL, ?, ?, ?)
  `, [timestamp, actorId, fieldName, JSON.stringify(value), timestamp, timestamp]);
}

async function recordSetupComplete(
  database: PersistenceExecutor,
  user: RequestUser,
  timestamp: string
): Promise<{
  setup: Awaited<ReturnType<typeof publicSetupState>>;
  completedAt: string;
  owner: { id: string; displayName: string; role: "admin"; email?: string };
}> {
  await setMembershipRole(user.id, "admin", user.id, database, timestamp);
  await upsertSetting(database, "setup.ownerUserId", user.id, user.id, timestamp);
  await upsertSetting(database, "setup.completedAt", timestamp, user.id, timestamp);
  await upsertSetting(database, "setup.completedBy", user.id, user.id, timestamp);
  await recordBootstrapAudit(database, user.id, "owner_bootstrap", {
    userId: user.id,
    role: "admin"
  }, timestamp);
  await recordBootstrapAudit(database, user.id, "setup_completed", {
    completedAt: timestamp,
    completedBy: user.id
  }, timestamp);

  return {
    setup: await publicSetupState(database),
    completedAt: timestamp,
    owner: {
      id: user.id,
      displayName: user.displayName,
      role: "admin" as const,
      ...(user.email ? { email: user.email } : {})
    }
  };
}

export interface FirstUseSetupInput {
  installationLabel?: string;
  careParty: {
    name: string;
    kind: ApiCarePartyKind;
  };
  secondaryCareParty?: {
    name: string;
    kind: ApiCarePartyKind;
  };
  primaryCareParty?: "primary" | "secondary";
  defaultCareParty: "primary" | "secondary";
  children?: ApiSetupChildInput[];
}

async function createCareParty(
  database: PersistenceExecutor,
  userId: string,
  timestamp: string,
  careParty: { name: string; kind: ApiCarePartyKind },
  auditFieldName: "care_party_created" | "secondary_care_party_created"
): Promise<string> {
  const carePartyId = makeId("party");
  await database.run(`
    INSERT INTO care_parties (
      id, name, kind, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    carePartyId,
    careParty.name,
    careParty.kind,
    userId,
    userId,
    timestamp,
    timestamp
  ]);
  await recordBootstrapAudit(database, userId, auditFieldName, {
    carePartyId,
    kind: careParty.kind
  }, timestamp);
  return carePartyId;
}

export async function completeFirstUseSetup(
  user: RequestUser,
  input: FirstUseSetupInput,
  database: PersistenceRuntime,
  timestamp = new Date().toISOString()
) {
  return database.transaction(async (transaction) => {
    const setup = await buildSetupState(transaction);
    if (setup.complete) {
      throw new SetupBootstrapError(
        "setup_already_complete",
        409,
        "Die Installation wurde bereits eingerichtet."
      );
    }

    await assertKnownUser(user.id, transaction);

    const carePartyId = await createCareParty(
      transaction,
      user.id,
      timestamp,
      input.careParty,
      "care_party_created"
    );
    const secondaryCarePartyId = input.secondaryCareParty
      ? await createCareParty(
        transaction,
        user.id,
        timestamp,
        input.secondaryCareParty,
        "secondary_care_party_created"
      )
      : undefined;
    const primaryCarePartyId = input.primaryCareParty === "secondary" && secondaryCarePartyId
      ? secondaryCarePartyId
      : carePartyId;
    const defaultCarePartyId = input.defaultCareParty === "secondary" && secondaryCarePartyId
      ? secondaryCarePartyId
      : carePartyId;

    const childIds: string[] = [];
    for (const child of input.children ?? []) {
      const childId = makeId("child");
      await transaction.run(`
        INSERT INTO children (
          id, name, birth_month, birth_year, color, created_by, updated_by,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        childId,
        child.name,
        child.birthMonth,
        child.birthYear,
        child.color,
        user.id,
        user.id,
        timestamp,
        timestamp
      ]);
      await recordBootstrapAudit(transaction, user.id, "child_created", {
        childId
      }, timestamp);
      childIds.push(childId);
    }

    await upsertSetting(transaction, "primaryCarePartyId", primaryCarePartyId, user.id, timestamp);
    await upsertSetting(transaction, "defaultResponsiblePartyId", defaultCarePartyId, user.id, timestamp);
    if (input.installationLabel) {
      await upsertSetting(
        transaction,
        "setup.installationLabel",
        input.installationLabel,
        user.id,
        timestamp
      );
    }

    const completed = await recordSetupComplete(transaction, user, timestamp);
    return {
      ...completed,
      created: {
        carePartyId,
        ...(secondaryCarePartyId ? { secondaryCarePartyId } : {}),
        primaryCarePartyId,
        defaultCarePartyId,
        childIds,
        ...(childIds[0] ? { childId: childIds[0] } : {})
      }
    };
  });
}
