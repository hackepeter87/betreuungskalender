import type Database from "better-sqlite3";
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
import { db } from "../db/connection.js";

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

function ownerId(database: Database.Database): string | undefined {
  const row = database.prepare(`
    SELECT value_json AS valueJson
    FROM settings
    WHERE key = 'setup.ownerUserId' AND deleted_at IS NULL
  `).get() as { valueJson: string } | undefined;
  if (!row) return undefined;
  try {
    const value = JSON.parse(row.valueJson) as unknown;
    return typeof value === "string" && value.trim() ? value : undefined;
  } catch {
    return undefined;
  }
}

function latestMembershipForUser(
  userId: string,
  database: Database.Database
): MembershipRow | undefined {
  return database.prepare(`
    SELECT role, deleted_at
    FROM app_memberships
    WHERE user_id = ?
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(userId) as MembershipRow | undefined;
}

export function membershipRoleForUser(
  userId: string,
  database: Database.Database = db
): WorkspaceRole | undefined {
  const row = latestMembershipForUser(userId, database);
  return row && !row.deleted_at && isWorkspaceRole(row.role) ? row.role : undefined;
}

export function hasWorkspaceAccess(
  userId: string,
  database: Database.Database = db,
  policy: MembershipResolutionPolicy = "strict"
): boolean {
  return workspacePermissionsForUser(userId, database, policy).length > 0;
}

export function workspacePermissionsForUser(
  userId: string,
  database: Database.Database = db,
  policy: MembershipResolutionPolicy = "strict"
): WorkspacePermission[] {
  const membership = latestMembershipForUser(userId, database);
  if (membership?.deleted_at) return [];
  const owner = ownerId(database);
  if (membership && isWorkspaceRole(membership.role)) {
    return workspacePermissionsForRole(membership.role, owner === userId);
  }
  if (owner || policy === "strict") return [];
  const user = database.prepare(`
    SELECT role
    FROM app_users
    WHERE id = ? AND deleted_at IS NULL
  `).get(userId) as { role: AuthRole } | undefined;
  if (!user || !["admin", "parent", "readonly"].includes(user.role)) return [];
  const role = workspaceRoleForLegacyRole(user.role);
  return workspacePermissionsForRole(role, role === "admin");
}

export function userHasWorkspacePermission(
  userId: string,
  permission: WorkspacePermission,
  database: Database.Database = db,
  policy: MembershipResolutionPolicy = "strict"
): boolean {
  return workspacePermissionsForUser(userId, database, policy).includes(permission);
}

export function applyMembershipRole(
  user: RequestUser,
  database: Database.Database = db,
  policy: MembershipResolutionPolicy = "strict"
): MembershipResolution {
  const membership = latestMembershipForUser(user.id, database);
  const owner = ownerId(database);
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

export function applyLegacyPreOwnerMembershipRole(
  user: RequestUser,
  database: Database.Database = db
): MembershipResolution {
  return applyMembershipRole(user, database, "legacy-pre-owner");
}

export function setMembershipRole(
  userId: string,
  role: WorkspaceRole,
  actorId: string,
  timestamp = new Date().toISOString(),
  database: Database.Database = db
): void {
  const existing = database.prepare(`
    SELECT id
    FROM app_memberships
    WHERE user_id = ? AND deleted_at IS NULL
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(userId) as { id: string } | undefined;

  if (existing) {
    database.prepare(`
      UPDATE app_memberships
      SET role = ?,
          updated_by = ?,
          updated_at = ?
      WHERE id = ?
    `).run(role, actorId, timestamp, existing.id);
    return;
  }

  database.prepare(`
    INSERT INTO app_memberships (
      id, user_id, role, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), userId, role, actorId, actorId, timestamp, timestamp);
}

export function clearMembershipRole(
  userId: string,
  actorId: string,
  timestamp = new Date().toISOString(),
  database: Database.Database = db
): WorkspaceRole | undefined {
  const existing = database.prepare(`
    SELECT id, role
    FROM app_memberships
    WHERE user_id = ? AND deleted_at IS NULL
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(userId) as { id: string; role: WorkspaceRole } | undefined;

  if (!existing) return undefined;

  database.prepare(`
    UPDATE app_memberships
    SET deleted_at = ?,
        updated_by = ?,
        updated_at = ?
    WHERE id = ?
  `).run(timestamp, actorId, timestamp, existing.id);

  return existing.role;
}
