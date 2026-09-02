import { sql } from "kysely";
import { permissionsForRole, type AuthRole, type RequestUser } from "../auth.js";
import type { DatabaseExecutor } from "../db/runtime.js";
import { applyMembershipRole, type MembershipResolutionPolicy } from "./memberships.js";
import { isLocalDevelopmentIdentity } from "./localDevelopmentIdentity.js";

function parseGroups(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function isAuthRole(value: string): value is AuthRole {
  return value === "admin" || value === "parent" || value === "readonly";
}

export async function upsertAuthenticatedUser(
  user: RequestUser,
  database: DatabaseExecutor,
  timestamp = new Date().toISOString()
): Promise<void> {
  await database.insertInto("app_users").values({
    id: user.id,
    external_subject: user.externalSubject,
    email: user.email ?? null,
    display_name: user.displayName,
    role: user.role,
    groups_json: JSON.stringify(user.groups),
    last_seen_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null
  }).onConflict((conflict) => conflict.column("external_subject").doUpdateSet({
    email: user.email ?? null,
    display_name: user.displayName,
    role: user.role,
    groups_json: JSON.stringify(user.groups),
    last_seen_at: timestamp,
    updated_at: timestamp,
    deleted_at: null
  })).execute();
}

export async function findAuthenticatedUserBySubject(
  externalSubject: string,
  database: DatabaseExecutor,
  policy: MembershipResolutionPolicy = "strict"
): Promise<RequestUser | undefined> {
  const row = await database.selectFrom("app_users")
    .select(["id", "external_subject", "email", "display_name", "role", "groups_json"])
    .where("external_subject", "=", externalSubject)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!row || !isAuthRole(row.role)) return undefined;
  return (await applyMembershipRole({
    id: row.id,
    externalSubject: row.external_subject,
    ...(row.email ? { email: row.email } : {}),
    displayName: row.display_name,
    groups: parseGroups(row.groups_json),
    role: row.role,
    permissions: permissionsForRole(row.role)
  }, database, policy)).user;
}

export async function listAppUsers(
  database: DatabaseExecutor,
  options: { includeLocalDevelopmentIdentity?: boolean } = {
    includeLocalDevelopmentIdentity: true
  }
) {
  const rows = await database.selectFrom("app_users")
    .select(["id", "external_subject", "email", "display_name", "role", "last_seen_at"])
    .where("deleted_at", "is", null)
    .orderBy(sql`lower(display_name)`)
    .orderBy("id")
    .execute();
  return rows
    .filter((row) => options.includeLocalDevelopmentIdentity || !isLocalDevelopmentIdentity({
      id: row.id,
      externalSubject: row.external_subject,
      displayName: row.display_name
    }))
    .filter((row): row is typeof row & { role: AuthRole } => isAuthRole(row.role))
    .map((row) => ({
      id: row.id,
      displayName: row.display_name,
      role: row.role,
      ...(row.email ? { email: row.email } : {}),
      lastSeenAt: row.last_seen_at
    }));
}
