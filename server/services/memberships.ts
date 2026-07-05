import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { permissionsForRole, type AuthRole, type RequestUser } from "../auth.js";
import { db } from "../db/connection.js";

export interface MembershipResolution {
  user: RequestUser;
  membershipRole?: AuthRole;
}

function isAuthRole(value: string): value is AuthRole {
  return value === "admin" || value === "parent" || value === "readonly";
}

export function membershipRoleForUser(
  userId: string,
  database: Database.Database = db
): AuthRole | undefined {
  const row = database.prepare(`
    SELECT role
    FROM app_memberships
    WHERE user_id = ?
      AND deleted_at IS NULL
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(userId) as { role: string } | undefined;
  return row && isAuthRole(row.role) ? row.role : undefined;
}

export function applyMembershipRole(
  user: RequestUser,
  database: Database.Database = db
): MembershipResolution {
  const membershipRole = membershipRoleForUser(user.id, database);
  if (!membershipRole || membershipRole === user.role) {
    return {
      user,
      ...(membershipRole ? { membershipRole } : {})
    };
  }
  return {
    membershipRole,
    user: {
      ...user,
      role: membershipRole,
      permissions: permissionsForRole(membershipRole)
    }
  };
}

export function setMembershipRole(
  userId: string,
  role: AuthRole,
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
