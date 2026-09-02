import { sql } from "kysely";
import {
  workspacePermissionsForRole,
  workspaceRoleForLegacyRole,
  type AuthRole,
  type RequestUser,
  type WorkspaceRole
} from "../auth.js";
import type { DatabaseExecutor, PersistenceRuntime } from "../db/runtime.js";
import { isLocalDevelopmentIdentity } from "./localDevelopmentIdentity.js";
import { clearMembershipRole, setMembershipRole } from "./memberships.js";

export interface AppMember {
  id: string;
  displayName: string;
  claimRole: AuthRole;
  effectiveRole: WorkspaceRole;
  membershipRole?: WorkspaceRole;
  email?: string;
  lastSeenAt?: string;
  owner: boolean;
  workspaceAccess: boolean;
}

export class MemberManagementError extends Error {
  constructor(
    public readonly code:
      | "member_admin_required"
      | "self_role_change_rejected"
      | "self_remove_rejected"
      | "unknown_user",
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

function parseSettingString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "string" && parsed.trim() ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isAuthRole(value: string): value is AuthRole {
  return value === "admin" || value === "parent" || value === "readonly";
}

function isWorkspaceRole(value: string): value is WorkspaceRole {
  return value === "admin" || value === "editor" || value === "scheduler" || value === "viewer";
}

export async function installationOwnerId(database: DatabaseExecutor): Promise<string | undefined> {
  const row = await database.selectFrom("settings")
    .select("value_json")
    .where("key", "=", "setup.ownerUserId")
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  return parseSettingString(row?.value_json);
}

export async function canAdministerMembers(
  actor: RequestUser | undefined,
  database: DatabaseExecutor
): Promise<boolean> {
  if (!actor) return false;
  const ownerId = await installationOwnerId(database);
  return ownerId ? actor.id === ownerId : actor.role === "admin";
}

export async function assertCanAdministerMembers(
  actor: RequestUser | undefined,
  database: DatabaseExecutor
): Promise<void> {
  if (!(await canAdministerMembers(actor, database))) {
    throw new MemberManagementError(
      "member_admin_required",
      403,
      "Nur der Owner der Installation kann Mitglieder verwalten."
    );
  }
}

export async function listMembers(
  database: DatabaseExecutor,
  options: { includeLocalDevelopmentIdentity?: boolean } = {
    includeLocalDevelopmentIdentity: true
  }
): Promise<AppMember[]> {
  const [ownerId, users, memberships] = await Promise.all([
    installationOwnerId(database),
    database.selectFrom("app_users")
      .select(["id", "external_subject", "email", "display_name", "role", "last_seen_at"])
      .where("deleted_at", "is", null)
      .orderBy(sql`lower(display_name)`)
      .orderBy("id")
      .execute(),
    database.selectFrom("app_memberships")
      .select(["user_id", "role", "deleted_at"])
      .orderBy("updated_at", "desc")
      .orderBy("id", "desc")
      .execute()
  ]);
  const latestMembership = new Map<string, { role: string; deletedAt: string | null }>();
  for (const membership of memberships) {
    if (!latestMembership.has(membership.user_id)) {
      latestMembership.set(membership.user_id, {
        role: membership.role,
        deletedAt: membership.deleted_at
      });
    }
  }
  return users
    .filter((user) => isAuthRole(user.role))
    .filter((user) => options.includeLocalDevelopmentIdentity || !isLocalDevelopmentIdentity({
      id: user.id,
      externalSubject: user.external_subject,
      displayName: user.display_name
    }))
    .map((user) => {
      const membership = latestMembership.get(user.id);
      const membershipRole = membership && isWorkspaceRole(membership.role)
        ? membership.role
        : undefined;
      const workspaceAccess = Boolean(membershipRole && !membership?.deletedAt);
      return {
        id: user.id,
        displayName: user.display_name,
        claimRole: user.role as AuthRole,
        effectiveRole: membershipRole ?? workspaceRoleForLegacyRole(user.role as AuthRole),
        ...(workspaceAccess && membershipRole ? { membershipRole } : {}),
        ...(user.email ? { email: user.email } : {}),
        ...(user.last_seen_at ? { lastSeenAt: user.last_seen_at } : {}),
        owner: Boolean(ownerId && user.id === ownerId),
        workspaceAccess: ownerId ? workspaceAccess : true
      };
    });
}

async function memberById(userId: string, database: DatabaseExecutor): Promise<AppMember | undefined> {
  return (await listMembers(database)).find((member) => member.id === userId);
}

async function recordMemberAudit(
  database: DatabaseExecutor,
  actorId: string,
  targetUserId: string,
  fieldName: string,
  oldValue: unknown,
  newValue: unknown,
  timestamp: string
): Promise<void> {
  await database.insertInto("audit_log").values({
    timestamp,
    user_email: actorId,
    entity_type: "app_member",
    entity_id: targetUserId,
    action: "updated",
    field_name: fieldName,
    old_value: oldValue === undefined ? null : JSON.stringify(oldValue),
    new_value: JSON.stringify(newValue),
    metadata_json: null,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null
  }).execute();
}

export async function updateMemberRole(
  actor: RequestUser,
  targetUserId: string,
  role: WorkspaceRole,
  persistence: PersistenceRuntime,
  timestamp = new Date().toISOString()
): Promise<AppMember> {
  return persistence.transaction(async (database) => {
    await assertCanAdministerMembers(actor, database);
    if (actor.id === targetUserId) {
      throw new MemberManagementError(
        "self_role_change_rejected",
        400,
        "Die eigene Rolle kann nicht über die Mitgliederverwaltung geändert werden."
      );
    }
    const before = await memberById(targetUserId, database);
    if (!before) throw new MemberManagementError("unknown_user", 404, "Mitglied nicht gefunden.");
    await setMembershipRole(targetUserId, role, actor.id, database, timestamp);
    const permissions = workspacePermissionsForRole(role, false);
    if (!permissions.includes("feeds:manage-own")) {
      await database.updateTable("calendar_feed_tokens")
        .set({ revoked_at: timestamp })
        .where("user_id", "=", targetUserId)
        .where("revoked_at", "is", null)
        .execute();
    }
    if (!permissions.includes("appointments:confirm")) {
      await database.updateTable("care_confirmation_requests")
        .set({ deleted_at: timestamp, updated_at: timestamp })
        .where("user_id", "=", targetUserId)
        .where("deleted_at", "is", null)
        .where("answered_at", "is", null)
        .execute();
    }
    await recordMemberAudit(
      database,
      actor.id,
      targetUserId,
      "membershipRole",
      before.membershipRole,
      role,
      timestamp
    );
    const after = await memberById(targetUserId, database);
    if (!after) throw new MemberManagementError("unknown_user", 404, "Mitglied nicht gefunden.");
    return after;
  });
}

export async function removeMember(
  actor: RequestUser,
  targetUserId: string,
  persistence: PersistenceRuntime,
  timestamp = new Date().toISOString()
): Promise<AppMember> {
  return persistence.transaction(async (database) => {
    await assertCanAdministerMembers(actor, database);
    if (actor.id === targetUserId) {
      throw new MemberManagementError(
        "self_remove_rejected",
        400,
        "Die eigene Mitgliedschaft kann nicht über die Mitgliederverwaltung entfernt werden."
      );
    }
    const before = await memberById(targetUserId, database);
    if (!before) throw new MemberManagementError("unknown_user", 404, "Mitglied nicht gefunden.");
    const removedRole = await clearMembershipRole(targetUserId, actor.id, database, timestamp);
    await database.updateTable("calendar_feed_tokens")
      .set({ revoked_at: timestamp })
      .where("user_id", "=", targetUserId)
      .where("revoked_at", "is", null)
      .execute();
    await database.updateTable("push_subscriptions")
      .set({ deleted_at: timestamp, updated_at: timestamp })
      .where("user_id", "=", targetUserId)
      .where("deleted_at", "is", null)
      .execute();
    await database.updateTable("care_confirmation_requests")
      .set({ deleted_at: timestamp, updated_at: timestamp })
      .where("user_id", "=", targetUserId)
      .where("deleted_at", "is", null)
      .execute();
    await recordMemberAudit(
      database,
      actor.id,
      targetUserId,
      "membershipRole",
      removedRole ?? before.membershipRole,
      null,
      timestamp
    );
    const after = await memberById(targetUserId, database);
    if (!after) throw new MemberManagementError("unknown_user", 404, "Mitglied nicht gefunden.");
    return after;
  });
}
