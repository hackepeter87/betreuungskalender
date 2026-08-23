import type Database from "better-sqlite3";
import {
  workspacePermissionsForRole,
  workspaceRoleForLegacyRole,
  type AuthRole,
  type RequestUser,
  type WorkspaceRole
} from "../auth.js";
import { db } from "../db/connection.js";
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

interface MemberRow {
  id: string;
  external_subject: string;
  email: string | null;
  display_name: string;
  claim_role: AuthRole;
  membership_role: WorkspaceRole | null;
  membership_deleted_at: string | null;
  last_seen_at: string | null;
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

export function installationOwnerId(
  database: Database.Database = db
): string | undefined {
  const row = database.prepare(`
    SELECT value_json AS valueJson
    FROM settings
    WHERE key = 'setup.ownerUserId'
      AND deleted_at IS NULL
  `).get() as { valueJson: string } | undefined;
  return parseSettingString(row?.valueJson);
}

export function canAdministerMembers(
  actor: RequestUser | undefined,
  database: Database.Database = db
): boolean {
  if (!actor) return false;
  const ownerId = installationOwnerId(database);
  if (ownerId) return actor.id === ownerId;
  return actor.role === "admin";
}

export function assertCanAdministerMembers(
  actor: RequestUser | undefined,
  database: Database.Database = db
): asserts actor is RequestUser {
  if (!canAdministerMembers(actor, database)) {
    throw new MemberManagementError(
      "member_admin_required",
      403,
      "Nur der Owner der Installation kann Mitglieder verwalten."
    );
  }
}

export function listMembers(
  database: Database.Database = db,
  options: { includeLocalDevelopmentIdentity?: boolean } = {
    includeLocalDevelopmentIdentity: true
  }
): AppMember[] {
  const ownerId = installationOwnerId(database);
  const rows = database.prepare(`
    SELECT users.id,
      users.external_subject,
      users.email,
      users.display_name,
      users.role AS claim_role,
      users.last_seen_at,
      memberships.role AS membership_role,
      memberships.deleted_at AS membership_deleted_at
    FROM app_users users
    LEFT JOIN app_memberships memberships
      ON memberships.id = (
        SELECT latest.id
        FROM app_memberships latest
        WHERE latest.user_id = users.id
        ORDER BY latest.updated_at DESC, latest.id DESC
        LIMIT 1
      )
    WHERE users.deleted_at IS NULL
    ORDER BY users.display_name COLLATE NOCASE, users.id
  `).all() as MemberRow[];
  return rows.filter((row) =>
    options.includeLocalDevelopmentIdentity || !isLocalDevelopmentIdentity({
      id: row.id,
      externalSubject: row.external_subject,
      displayName: row.display_name
    })
  ).map((row) => {
    const workspaceAccess = row.membership_role !== null && row.membership_deleted_at === null;
    return ({
    id: row.id,
    displayName: row.display_name,
    claimRole: row.claim_role,
    effectiveRole: row.membership_role ?? workspaceRoleForLegacyRole(row.claim_role),
    ...(workspaceAccess && row.membership_role ? { membershipRole: row.membership_role } : {}),
    ...(row.email ? { email: row.email } : {}),
    ...(row.last_seen_at ? { lastSeenAt: row.last_seen_at } : {}),
    owner: Boolean(ownerId && row.id === ownerId),
    workspaceAccess: ownerId ? workspaceAccess : true
  });
  });
}

function memberById(
  userId: string,
  database: Database.Database
): AppMember | undefined {
  return listMembers(database).find((member) => member.id === userId);
}

function recordMemberAudit(
  database: Database.Database,
  actorId: string,
  targetUserId: string,
  fieldName: string,
  oldValue: unknown,
  newValue: unknown,
  timestamp: string
): void {
  database.prepare(`
    INSERT INTO audit_log (
      timestamp, user_email, entity_type, entity_id, action, field_name,
      old_value, new_value, created_at, updated_at
    ) VALUES (?, ?, 'app_member', ?, 'updated', ?, ?, ?, ?, ?)
  `).run(
    timestamp,
    actorId,
    targetUserId,
    fieldName,
    oldValue === undefined ? null : JSON.stringify(oldValue),
    JSON.stringify(newValue),
    timestamp,
    timestamp
  );
}

export function updateMemberRole(
  actor: RequestUser,
  targetUserId: string,
  role: WorkspaceRole,
  timestamp = new Date().toISOString(),
  database: Database.Database = db
): AppMember {
  return database.transaction(() => {
    assertCanAdministerMembers(actor, database);
    if (actor.id === targetUserId) {
      throw new MemberManagementError(
        "self_role_change_rejected",
        400,
        "Die eigene Rolle kann nicht über die Mitgliederverwaltung geändert werden."
      );
    }
    const before = memberById(targetUserId, database);
    if (!before) {
      throw new MemberManagementError(
        "unknown_user",
        404,
        "Mitglied nicht gefunden."
      );
    }
    setMembershipRole(targetUserId, role, actor.id, timestamp, database);
    const permissions = workspacePermissionsForRole(role, false);
    if (!permissions.includes("feeds:manage-own")) {
      database.prepare(`
        UPDATE calendar_feed_tokens
        SET revoked_at = COALESCE(revoked_at, ?)
        WHERE user_id = ? AND revoked_at IS NULL
      `).run(timestamp, targetUserId);
    }
    if (!permissions.includes("appointments:confirm")) {
      database.prepare(`
        UPDATE care_confirmation_requests
        SET deleted_at = ?, updated_at = ?
        WHERE user_id = ? AND deleted_at IS NULL AND answered_at IS NULL
      `).run(timestamp, timestamp, targetUserId);
    }
    recordMemberAudit(
      database,
      actor.id,
      targetUserId,
      "membershipRole",
      before.membershipRole,
      role,
      timestamp
    );
    const after = memberById(targetUserId, database);
    if (!after) {
      throw new MemberManagementError(
        "unknown_user",
        404,
        "Mitglied nicht gefunden."
      );
    }
    return after;
  })();
}

export function removeMember(
  actor: RequestUser,
  targetUserId: string,
  timestamp = new Date().toISOString(),
  database: Database.Database = db
): AppMember {
  return database.transaction(() => {
    assertCanAdministerMembers(actor, database);
    if (actor.id === targetUserId) {
      throw new MemberManagementError(
        "self_remove_rejected",
        400,
        "Die eigene Mitgliedschaft kann nicht über die Mitgliederverwaltung entfernt werden."
      );
    }
    const before = memberById(targetUserId, database);
    if (!before) {
      throw new MemberManagementError(
        "unknown_user",
        404,
        "Mitglied nicht gefunden."
      );
    }
    const removedRole = clearMembershipRole(targetUserId, actor.id, timestamp, database);
    database.prepare(`
      UPDATE calendar_feed_tokens
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE user_id = ? AND revoked_at IS NULL
    `).run(timestamp, targetUserId);
    database.prepare(`
      UPDATE push_subscriptions
      SET deleted_at = ?, updated_at = ?
      WHERE user_id = ? AND deleted_at IS NULL
    `).run(timestamp, timestamp, targetUserId);
    database.prepare(`
      UPDATE care_confirmation_requests
      SET deleted_at = ?, updated_at = ?
      WHERE user_id = ? AND deleted_at IS NULL
    `).run(timestamp, timestamp, targetUserId);
    recordMemberAudit(
      database,
      actor.id,
      targetUserId,
      "membershipRole",
      removedRole ?? before.membershipRole,
      null,
      timestamp
    );
    const after = memberById(targetUserId, database);
    if (!after) {
      throw new MemberManagementError(
        "unknown_user",
        404,
        "Mitglied nicht gefunden."
      );
    }
    return after;
  })();
}
