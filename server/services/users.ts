import { db } from "../db/connection.js";
import { permissionsForRole, type AuthRole, type RequestUser } from "../auth.js";
import type Database from "better-sqlite3";

interface AppUserRow {
  id: string;
  external_subject: string;
  email: string | null;
  display_name: string;
  role: string;
  groups_json: string;
  last_seen_at?: string;
}

function parseGroups(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function isAuthRole(value: string): value is AuthRole {
  return value === "admin" || value === "parent" || value === "readonly";
}

export function upsertAuthenticatedUser(
  user: RequestUser,
  timestamp = new Date().toISOString(),
  database: Database.Database = db
): void {
  database.prepare(`
    INSERT INTO app_users (
      id, external_subject, email, display_name, role, groups_json,
      last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(external_subject) DO UPDATE SET
      email = excluded.email,
      display_name = excluded.display_name,
      role = excluded.role,
      groups_json = excluded.groups_json,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `).run(
    user.id,
    user.externalSubject,
    user.email ?? null,
    user.displayName,
    user.role,
    JSON.stringify(user.groups),
    timestamp,
    timestamp,
    timestamp
  );
}

export function findAuthenticatedUserBySubject(
  externalSubject: string,
  database: Database.Database = db
): RequestUser | undefined {
  const row = database.prepare(`
    SELECT id, external_subject, email, display_name, role, groups_json
    FROM app_users
    WHERE external_subject = ?
      AND deleted_at IS NULL
  `).get(externalSubject) as AppUserRow | undefined;
  if (!row || !isAuthRole(row.role)) return undefined;
  return {
    id: row.id,
    externalSubject: row.external_subject,
    ...(row.email ? { email: row.email } : {}),
    displayName: row.display_name,
    groups: parseGroups(row.groups_json),
    role: row.role,
    permissions: permissionsForRole(row.role)
  };
}

export function listAppUsers(database: Database.Database = db) {
  const rows = database.prepare(`
    SELECT id, email, display_name, role, last_seen_at
    FROM app_users
    WHERE deleted_at IS NULL
    ORDER BY display_name COLLATE NOCASE, id
  `).all() as Array<{
    id: string;
    email: string | null;
    display_name: string;
    role: AuthRole;
    last_seen_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    ...(row.email ? { email: row.email } : {}),
    lastSeenAt: row.last_seen_at
  }));
}
