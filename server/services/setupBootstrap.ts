import type { ApiCarePartyKind, ApiSetupChildInput } from "../../shared/api.js";
import type { RequestUser } from "../auth.js";
import type { DatabaseExecutor, PersistenceRuntime } from "../db/runtime.js";
import { makeId } from "./common.js";
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

async function assertKnownUser(userId: string, database: DatabaseExecutor): Promise<void> {
  const row = await database.selectFrom("app_users").select("id")
    .where("id", "=", userId).where("deleted_at", "is", null).executeTakeFirst();
  if (!row) {
    throw new SetupBootstrapError(
      "unknown_user",
      400,
      "Der angemeldete Nutzer ist noch nicht als App-Nutzer bekannt."
    );
  }
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

async function recordBootstrapAudit(
  database: DatabaseExecutor,
  actorId: string,
  fieldName: string,
  value: unknown,
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
    new_value: JSON.stringify(value),
    metadata_json: null,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null
  }).execute();
}

async function recordSetupComplete(
  database: DatabaseExecutor,
  user: RequestUser,
  timestamp: string
) {
  await setMembershipRole(user.id, "admin", user.id, database, timestamp);
  await upsertSetting(database, "setup.ownerUserId", user.id, user.id, timestamp);
  await upsertSetting(database, "setup.completedAt", timestamp, user.id, timestamp);
  await upsertSetting(database, "setup.completedBy", user.id, user.id, timestamp);
  await recordBootstrapAudit(database, user.id, "owner_bootstrap", { userId: user.id, role: "admin" }, timestamp);
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
  careParty: { name: string; kind: ApiCarePartyKind };
  secondaryCareParty?: { name: string; kind: ApiCarePartyKind };
  primaryCareParty?: "primary" | "secondary";
  defaultCareParty: "primary" | "secondary";
  children?: ApiSetupChildInput[];
}

async function createCareParty(
  database: DatabaseExecutor,
  userId: string,
  timestamp: string,
  careParty: { name: string; kind: ApiCarePartyKind },
  auditFieldName: "care_party_created" | "secondary_care_party_created"
): Promise<string> {
  const carePartyId = makeId("party");
  await database.insertInto("care_parties").values({
    id: carePartyId,
    name: careParty.name,
    kind: careParty.kind,
    created_by: userId,
    updated_by: userId,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null
  }).execute();
  await recordBootstrapAudit(database, userId, auditFieldName, {
    carePartyId,
    kind: careParty.kind
  }, timestamp);
  return carePartyId;
}

export async function completeFirstUseSetup(
  user: RequestUser,
  input: FirstUseSetupInput,
  persistence: PersistenceRuntime,
  timestamp = new Date().toISOString()
) {
  return persistence.transaction(async (database) => {
    if ((await buildSetupState(database)).complete) {
      throw new SetupBootstrapError(
        "setup_already_complete",
        409,
        "Die Installation wurde bereits eingerichtet."
      );
    }
    await assertKnownUser(user.id, database);
    const carePartyId = await createCareParty(
      database, user.id, timestamp, input.careParty, "care_party_created"
    );
    const secondaryCarePartyId = input.secondaryCareParty
      ? await createCareParty(
        database,
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
      await database.insertInto("children").values({
        id: childId,
        name: child.name,
        birth_month: child.birthMonth,
        birth_year: child.birthYear,
        color: child.color,
        created_by: user.id,
        updated_by: user.id,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null
      }).execute();
      await recordBootstrapAudit(database, user.id, "child_created", { childId }, timestamp);
      childIds.push(childId);
    }
    await upsertSetting(database, "primaryCarePartyId", primaryCarePartyId, user.id, timestamp);
    await upsertSetting(database, "defaultResponsiblePartyId", defaultCarePartyId, user.id, timestamp);
    if (input.installationLabel) {
      await upsertSetting(database, "setup.installationLabel", input.installationLabel, user.id, timestamp);
    }
    const completed = await recordSetupComplete(database, user, timestamp);
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
