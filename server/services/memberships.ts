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
import type { PersistenceExecutor } from "../db/runtime.js";

export interface MembershipResolution {
  user: RequestUser;
  membershipRole?: WorkspaceRole;
  membershipState?: "active" | "revoked" | "none";
  workspaceAccess?: boolean;
}

export type MembershipResolutionPolicy = "strict" | "legacy-pre-owner";

interface MembershipRow {
  role: string;
  deleted_at: string | null;
}

function isWorkspaceRole(value: string): value is WorkspaceRole {
  return value === "admin" || value === "editor" || value === "scheduler" || value === "viewer";
}

async function ownerId(database: PersistenceExecutor): Promise<string | undefined> {
  const row = await database.one<{ valueJson: string }>(`
    SELECT value_json AS valueJson
    FROM settings
    WHERE key = 'setup.ownerUserId' AND deleted_at IS NULL
  `);
  if (!row) return undefined;
  try {
    const value = JSON.parse(row.valueJson) as unknown;
    return typeof value === "string" && value.trim() ? value : undefined;
  } catch {
    return undefined;
  }
}

async function latestMembershipForUser(
  userId: string,
  database: PersistenceExecutor
): Promise<MembershipRow | undefined> {
  return database.one<MembershipRow>(`
    SELECT role, deleted_at
    FROM app_memberships
    WHERE user_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `, [userId]);
}

export async function membershipRoleForUser(
  userId: string,
  database: PersistenceExecutor
): Promise<WorkspaceRole | undefined> {
  const row = await latestMembershipForUser(userId, database);
  return row && !row.deleted_at && isWorkspaceRole(row.role) ? row.role : undefined;
}

export async function hasWorkspaceAccess(
  userId: string,
  database: PersistenceExecutor,
  policy: MembershipResolutionPolicy = "strict"
): Promise<boolean> {
  return (await workspacePermissionsForUser(userId, database, policy)).length > 0;
}

export async function workspacePermissionsForUser(
  userId: string,
  database: PersistenceExecutor,
  policy: MembershipResolutionPolicy = "strict"
): Promise<WorkspacePermission[]> {
  const membership = await latestMembershipForUser(userId, database);
  if (membership?.deleted_at) return [];
  const owner = await ownerId(database);
  if (membership && isWorkspaceRole(membership.role)) {
    return workspacePermissionsForRole(membership.role, owner === userId);
  }
  if (owner || policy === "strict") return [];
  const user = await database.one<{ role: AuthRole }>(`
    SELECT role
    FROM app_users
    WHERE id = ? AND deleted_at IS NULL
  `, [userId]);
  if (!user || !["admin", "parent", "readonly"].includes(user.role)) return [];
  const role = workspaceRoleForLegacyRole(user.role);
  return workspacePermissionsForRole(role, role === "admin");
}

export async function userHasWorkspacePermission(
  userId: string,
  permission: WorkspacePermission,
  database: PersistenceExecutor,
  policy: MembershipResolutionPolicy = "strict"
): Promise<boolean> {
  return (await workspacePermissionsForUser(userId, database, policy)).includes(permission);
}

export async function applyMembershipRole(
  user: RequestUser,
  database: PersistenceExecutor,
  policy: MembershipResolutionPolicy = "strict"
): Promise<MembershipResolution> {
  const membership = await latestMembershipForUser(user.id, database);
  const owner = await ownerId(database);
  const isOwner = owner === user.id;
  if (membership?.deleted_at) {
    return {
      membershipState: "revoked",
      workspaceAccess: false,
      user: {
        ...user,
        permissions: [],
        workspacePermissions: [],
        workspaceAccess: false,
        isOwner: false
      }
    };
  }
  const membershipRole = membership && isWorkspaceRole(membership.role)
    ? membership.role
    : undefined;
  if (!membershipRole && (owner || policy === "strict")) {
    return {
      membershipState: "none",
      workspaceAccess: false,
      user: {
        ...user,
        permissions: [],
        workspacePermissions: [],
        workspaceAccess: false,
        isOwner: false
      }
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

export async function applyLegacyPreOwnerMembershipRole(
  user: RequestUser,
  database: PersistenceExecutor
): Promise<MembershipResolution> {
  return applyMembershipRole(user, database, "legacy-pre-owner");
}

export async function setMembershipRole(
  userId: string,
  role: WorkspaceRole,
  actorId: string,
  database: PersistenceExecutor,
  timestamp = new Date().toISOString()
): Promise<void> {
  const existing = await database.one<{ id: string }>(`
    SELECT id
    FROM app_memberships
    WHERE user_id = ? AND deleted_at IS NULL
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `, [userId]);

  if (existing) {
    await database.run(`
      UPDATE app_memberships
      SET role = ?,
          updated_by = ?,
          updated_at = ?
      WHERE id = ?
    `, [role, actorId, timestamp, existing.id]);
    return;
  }

  await database.run(`
    INSERT INTO app_memberships (
      id, user_id, role, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [randomUUID(), userId, role, actorId, actorId, timestamp, timestamp]);
}

export async function clearMembershipRole(
  userId: string,
  actorId: string,
  database: PersistenceExecutor,
  timestamp = new Date().toISOString()
): Promise<WorkspaceRole | undefined> {
  const existing = await database.one<{ id: string; role: WorkspaceRole }>(`
    SELECT id, role
    FROM app_memberships
    WHERE user_id = ? AND deleted_at IS NULL
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `, [userId]);

  if (!existing) return undefined;

  await database.run(`
    UPDATE app_memberships
    SET deleted_at = ?,
        updated_by = ?,
        updated_at = ?
    WHERE id = ?
  `, [timestamp, actorId, timestamp, existing.id]);

  return existing.role;
}
