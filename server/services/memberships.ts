import { randomUUID } from "node:crypto";
import {
  legacyRoleForWorkspaceRole,
  permissionsForRole,
  workspacePermissionsForRole,
  workspaceRoleForLegacyRole,
  type AuthRole,
  type RequestUser,
  type WorkspacePermission,
  type WorkspaceRole
} from "../auth.js";
import type { DatabaseExecutor } from "../db/runtime.js";

export interface MembershipResolution {
  user: RequestUser;
  membershipRole?: WorkspaceRole;
  membershipState?: "active" | "revoked" | "none";
  workspaceAccess?: boolean;
}

export type MembershipResolutionPolicy = "strict" | "legacy-pre-owner";

function isWorkspaceRole(value: string): value is WorkspaceRole {
  return value === "admin" || value === "editor" || value === "scheduler" || value === "viewer";
}

async function ownerId(database: DatabaseExecutor): Promise<string | undefined> {
  const row = await database.selectFrom("settings")
    .select("value_json")
    .where("key", "=", "setup.ownerUserId")
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!row) return undefined;
  try {
    const value = JSON.parse(row.value_json) as unknown;
    return typeof value === "string" && value.trim() ? value : undefined;
  } catch {
    return undefined;
  }
}

async function latestMembershipForUser(userId: string, database: DatabaseExecutor) {
  return database.selectFrom("app_memberships")
    .select(["id", "role", "deleted_at"])
    .where("user_id", "=", userId)
    .orderBy("updated_at", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
}

export async function membershipRoleForUser(
  userId: string,
  database: DatabaseExecutor
): Promise<WorkspaceRole | undefined> {
  const row = await latestMembershipForUser(userId, database);
  return row && !row.deleted_at && isWorkspaceRole(row.role) ? row.role : undefined;
}

export async function hasWorkspaceAccess(
  userId: string,
  database: DatabaseExecutor,
  policy: MembershipResolutionPolicy = "strict"
): Promise<boolean> {
  return (await workspacePermissionsForUser(userId, database, policy)).length > 0;
}

export async function workspacePermissionsForUser(
  userId: string,
  database: DatabaseExecutor,
  policy: MembershipResolutionPolicy = "strict"
): Promise<WorkspacePermission[]> {
  const membership = await latestMembershipForUser(userId, database);
  if (membership?.deleted_at) return [];
  const owner = await ownerId(database);
  if (membership && isWorkspaceRole(membership.role)) {
    return workspacePermissionsForRole(membership.role, owner === userId);
  }
  if (owner || policy === "strict") return [];
  const user = await database.selectFrom("app_users")
    .select("role")
    .where("id", "=", userId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!user || !["admin", "parent", "readonly"].includes(user.role)) return [];
  const role = workspaceRoleForLegacyRole(user.role as AuthRole);
  return workspacePermissionsForRole(role, role === "admin");
}

export async function userHasWorkspacePermission(
  userId: string,
  permission: WorkspacePermission,
  database: DatabaseExecutor,
  policy: MembershipResolutionPolicy = "strict"
): Promise<boolean> {
  return (await workspacePermissionsForUser(userId, database, policy)).includes(permission);
}

export async function applyMembershipRole(
  user: RequestUser,
  database: DatabaseExecutor,
  policy: MembershipResolutionPolicy = "strict"
): Promise<MembershipResolution> {
  const membership = await latestMembershipForUser(user.id, database);
  const owner = await ownerId(database);
  const isOwner = owner === user.id;
  if (membership?.deleted_at) {
    return {
      membershipState: "revoked",
      workspaceAccess: false,
      user: { ...user, permissions: [], workspacePermissions: [], workspaceAccess: false, isOwner: false }
    };
  }
  const membershipRole = membership && isWorkspaceRole(membership.role) ? membership.role : undefined;
  if (!membershipRole && (owner || policy === "strict")) {
    return {
      membershipState: "none",
      workspaceAccess: false,
      user: { ...user, permissions: [], workspacePermissions: [], workspaceAccess: false, isOwner: false }
    };
  }
  const workspaceRole = membershipRole ?? workspaceRoleForLegacyRole(user.role);
  const legacyRole = legacyRoleForWorkspaceRole(workspaceRole);
  const legacyAdminFallback = !owner && workspaceRole === "admin";
  return {
    ...(membershipRole ? { membershipRole } : {}),
    membershipState: membershipRole ? "active" : "none",
    workspaceAccess: true,
    user: {
      ...user,
      role: legacyRole,
      permissions: permissionsForRole(legacyRole),
      workspaceRole,
      workspacePermissions: workspacePermissionsForRole(workspaceRole, isOwner || legacyAdminFallback),
      workspaceAccess: true,
      isOwner
    }
  };
}

export function applyLegacyPreOwnerMembershipRole(
  user: RequestUser,
  database: DatabaseExecutor
): Promise<MembershipResolution> {
  return applyMembershipRole(user, database, "legacy-pre-owner");
}

export async function setMembershipRole(
  userId: string,
  role: WorkspaceRole,
  actorId: string,
  database: DatabaseExecutor,
  timestamp = new Date().toISOString()
): Promise<void> {
  const existing = await latestMembershipForUser(userId, database);
  if (existing && !existing.deleted_at) {
    await database.updateTable("app_memberships")
      .set({ role, updated_by: actorId, updated_at: timestamp })
      .where("id", "=", existing.id)
      .execute();
    return;
  }
  await database.insertInto("app_memberships").values({
    id: randomUUID(),
    user_id: userId,
    role,
    created_by: actorId,
    updated_by: actorId,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null
  }).execute();
}

export async function clearMembershipRole(
  userId: string,
  actorId: string,
  database: DatabaseExecutor,
  timestamp = new Date().toISOString()
): Promise<WorkspaceRole | undefined> {
  const existing = await latestMembershipForUser(userId, database);
  if (!existing || existing.deleted_at || !isWorkspaceRole(existing.role)) return undefined;
  await database.updateTable("app_memberships")
    .set({ deleted_at: timestamp, updated_by: actorId, updated_at: timestamp })
    .where("id", "=", existing.id)
    .execute();
  return existing.role;
}
