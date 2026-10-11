import { createHash } from "node:crypto";
import { sql } from "kysely";
import type {
  ApiMemberAccessPreview,
  ApiMemberAccessUpdateResult,
  ApiMemberCareDataScope
} from "../../shared/api.js";
import {
  workspacePermissionsForRole,
  workspaceRoleForLegacyRole,
  type AuthRole,
  type RequestUser,
  type WorkspaceRole
} from "../auth.js";
import type {
  DatabaseDriver,
  DatabaseExecutor,
  PersistenceRuntime
} from "../db/runtime.js";
import { isLocalDevelopmentIdentity } from "./localDevelopmentIdentity.js";
import {
  clearMembershipRole,
  setMembershipAccess
} from "./memberships.js";
import { revokeOidcSessionsByExternalSubject } from "./oidcSessions.js";
import {
  assertActiveCareParties,
  defaultCareDataScope,
  membershipCareDataScope,
  normalizeCareDataScope,
  type CareDataScope
} from "./careDataScopes.js";
import {
  grantedCapabilityCodes,
  memberAccessRoleModelVersion,
  memberAccessState
} from "./memberAccessModel.js";

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
  careDataScope?: ApiMemberCareDataScope;
}

export class MemberManagementError extends Error {
  constructor(
    public readonly code:
      | "member_admin_required"
      | "self_role_change_rejected"
      | "self_remove_rejected"
      | "member_access_preview_changed"
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
  const [ownerId, users, memberships, assignments] = await Promise.all([
    installationOwnerId(database),
    database.selectFrom("app_users")
      .select(["id", "external_subject", "email", "display_name", "role", "last_seen_at"])
      .where("deleted_at", "is", null)
      .orderBy(sql`lower(display_name)`)
      .orderBy("id")
      .execute(),
    database.selectFrom("app_memberships")
      .select(["user_id", "role", "care_scope_type", "deleted_at"])
      .orderBy("updated_at", "desc")
      .orderBy("id", "desc")
      .execute(),
    database.selectFrom("app_user_care_party_assignments")
      .select(["user_id", "care_party_id"])
      .where("deleted_at", "is", null)
      .orderBy("care_party_id")
      .execute()
  ]);
  const latestMembership = new Map<string, {
    role: string;
    careScopeType: string;
    deletedAt: string | null;
  }>();
  for (const membership of memberships) {
    if (!latestMembership.has(membership.user_id)) {
      latestMembership.set(membership.user_id, {
        role: membership.role,
        careScopeType: membership.care_scope_type,
        deletedAt: membership.deleted_at
      });
    }
  }
  const assignmentsByUser = new Map<string, string[]>();
  for (const assignment of assignments) {
    const current = assignmentsByUser.get(assignment.user_id) ?? [];
    current.push(assignment.care_party_id);
    assignmentsByUser.set(assignment.user_id, current);
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
        workspaceAccess: ownerId ? workspaceAccess : true,
        ...(workspaceAccess && membershipRole
          ? {
              careDataScope: normalizeCareDataScope(
                membershipRole,
                membership!.careScopeType === "all"
                  ? { type: "all" }
                  : {
                      type: "selected",
                      carePartyIds: assignmentsByUser.get(user.id) ?? []
                    }
              )
            }
          : {})
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
    const scope = (await membershipCareDataScope(targetUserId, database))
      ?? (await defaultCareDataScope(role, database));
    await setMembershipAccess(targetUserId, role, scope, actor.id, database, timestamp);
    await cleanUpMemberDeliveryState(targetUserId, role, false, database, timestamp);
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

interface ActiveCareParty {
  id: string;
  name: string;
  updatedAt: string;
}

interface MemberAccessSnapshot {
  membershipId?: string;
  membershipUpdatedAt?: string;
  role?: WorkspaceRole;
  scope?: CareDataScope;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function accessStateEqual(
  left: Pick<ReturnType<typeof memberAccessState>, "role" | "careDataScope"> | undefined,
  right: Pick<ReturnType<typeof memberAccessState>, "role" | "careDataScope">
): boolean {
  if (!left || left.role !== right.role || left.careDataScope.type !== right.careDataScope.type) {
    return false;
  }
  if (left.careDataScope.type === "all" || right.careDataScope.type === "all") return true;
  return JSON.stringify(sortedUnique(left.careDataScope.carePartyIds)) ===
    JSON.stringify(sortedUnique(right.careDataScope.carePartyIds));
}

function visibleCarePartyIds(
  scope: CareDataScope,
  activeCarePartyIds: string[]
): string[] {
  return scope.type === "all" ? activeCarePartyIds : sortedUnique(scope.carePartyIds);
}

function difference<T extends string>(left: T[], right: T[]): T[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

async function activeCareParties(database: DatabaseExecutor): Promise<ActiveCareParty[]> {
  return database.selectFrom("care_parties")
    .select(["id", "name", "updated_at as updatedAt"])
    .where("deleted_at", "is", null)
    .orderBy("id")
    .execute();
}

async function memberAccessSnapshot(
  userId: string,
  database: DatabaseExecutor
): Promise<MemberAccessSnapshot> {
  const user = await database.selectFrom("app_users")
    .select("id")
    .where("id", "=", userId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!user) throw new MemberManagementError("unknown_user", 404, "Mitglied nicht gefunden.");
  const membership = await database.selectFrom("app_memberships")
    .select(["id", "role", "updated_at", "deleted_at"])
    .where("user_id", "=", userId)
    .orderBy("updated_at", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
  if (!membership || membership.deleted_at || !isWorkspaceRole(membership.role)) return {};
  return {
    membershipId: membership.id,
    membershipUpdatedAt: membership.updated_at,
    role: membership.role,
    scope: (await membershipCareDataScope(userId, database)) ?? { type: "selected", carePartyIds: [] }
  };
}

function memberAccessFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function lockPostgresMemberAccessBasis(
  driver: DatabaseDriver,
  database: DatabaseExecutor,
  target: "member" | "invitation"
): Promise<void> {
  if (driver !== "postgres") return;
  if (target === "invitation") {
    await sql.raw("LOCK TABLE care_parties, settings IN SHARE ROW EXCLUSIVE MODE")
      .execute(database);
    return;
  }
  await sql.raw(`LOCK TABLE
    care_parties, settings, app_users, app_memberships, app_user_care_party_assignments
    IN SHARE ROW EXCLUSIVE MODE`).execute(database);
}

function buildPreview(
  target: ApiMemberAccessPreview["target"],
  beforeSnapshot: MemberAccessSnapshot | undefined,
  proposedRole: WorkspaceRole,
  proposedScope: CareDataScope,
  parties: ActiveCareParty[]
): ApiMemberAccessPreview {
  const activeIds = parties.map(({ id }) => id);
  const normalizedScope = normalizeCareDataScope(proposedRole, proposedScope);
  const before = beforeSnapshot?.role && beforeSnapshot.scope
    ? memberAccessState(beforeSnapshot.role, beforeSnapshot.scope)
    : undefined;
  const after = memberAccessState(proposedRole, normalizedScope);
  const beforeCapabilities = grantedCapabilityCodes(before);
  const afterCapabilities = grantedCapabilityCodes(after);
  const beforePartyIds = before
    ? visibleCarePartyIds(before.careDataScope, activeIds)
    : [];
  const afterPartyIds = visibleCarePartyIds(after.careDataScope, activeIds);
  const fingerprint = memberAccessFingerprint({
    roleModelVersion: memberAccessRoleModelVersion,
    target,
    current: beforeSnapshot ?? null,
    proposed: { role: proposedRole, careDataScope: normalizedScope },
    activeCareParties: parties
  });
  return {
    target,
    roleModelVersion: memberAccessRoleModelVersion,
    ...(before ? { before } : {}),
    after,
    careParties: parties.map(({ id, name }) => ({ id, name })),
    changes: {
      gainedCapabilities: difference(afterCapabilities, beforeCapabilities),
      lostCapabilities: difference(beforeCapabilities, afterCapabilities),
      gainedCarePartyIds: difference(afterPartyIds, beforePartyIds),
      lostCarePartyIds: difference(beforePartyIds, afterPartyIds)
    },
    fingerprint
  };
}

async function assertMutableMember(
  actor: RequestUser,
  targetUserId: string,
  database: DatabaseExecutor
): Promise<void> {
  await assertCanAdministerMembers(actor, database);
  const ownerId = await installationOwnerId(database);
  if (actor.id === targetUserId || ownerId === targetUserId) {
    throw new MemberManagementError(
      "self_role_change_rejected",
      400,
      "Der Zugriff des Owners kann nicht über die Mitgliederverwaltung geändert werden."
    );
  }
}

export async function previewMemberAccess(
  actor: RequestUser,
  targetUserId: string,
  role: WorkspaceRole,
  scope: CareDataScope,
  database: DatabaseExecutor
): Promise<ApiMemberAccessPreview> {
  await assertMutableMember(actor, targetUserId, database);
  const normalizedScope = normalizeCareDataScope(role, scope);
  await assertActiveCareParties(normalizedScope, database);
  const [snapshot, parties] = await Promise.all([
    memberAccessSnapshot(targetUserId, database),
    activeCareParties(database)
  ]);
  return buildPreview(
    { type: "member", userId: targetUserId },
    snapshot,
    role,
    normalizedScope,
    parties
  );
}

export async function previewInvitationAccess(
  actor: RequestUser,
  role: WorkspaceRole,
  scope: CareDataScope,
  database: DatabaseExecutor
): Promise<ApiMemberAccessPreview> {
  await assertCanAdministerMembers(actor, database);
  const normalizedScope = normalizeCareDataScope(role, scope);
  await assertActiveCareParties(normalizedScope, database);
  return buildPreview(
    { type: "invitation" },
    undefined,
    role,
    normalizedScope,
    await activeCareParties(database)
  );
}

async function cleanUpMemberDeliveryState(
  userId: string,
  role: WorkspaceRole,
  accessChanged: boolean,
  database: DatabaseExecutor,
  timestamp: string
): Promise<void> {
  const nextPermissions = workspacePermissionsForRole(role, false);
  if (accessChanged || !nextPermissions.includes("feeds:manage-own")) {
    await database.updateTable("calendar_feed_tokens")
      .set({ revoked_at: timestamp })
      .where("user_id", "=", userId)
      .where("revoked_at", "is", null)
      .execute();
  }
  if (accessChanged || !nextPermissions.includes("appointments:confirm")) {
    await database.updateTable("care_confirmation_requests")
      .set({ deleted_at: timestamp, updated_at: timestamp })
      .where("user_id", "=", userId)
      .where("deleted_at", "is", null)
      .where("answered_at", "is", null)
      .execute();
  }
}

export async function updateMemberAccess(
  actor: RequestUser,
  targetUserId: string,
  role: WorkspaceRole,
  scope: CareDataScope,
  previewFingerprint: string,
  persistence: PersistenceRuntime,
  timestamp = new Date().toISOString()
): Promise<ApiMemberAccessUpdateResult> {
  return persistence.transaction(async (database) => {
    await lockPostgresMemberAccessBasis(persistence.driver, database, "member");
    const preview = await previewMemberAccess(actor, targetUserId, role, scope, database);
    if (preview.fingerprint !== previewFingerprint) {
      throw new MemberManagementError(
        "member_access_preview_changed",
        409,
        "Die Zugriffsgrundlage hat sich geändert. Bitte prüfe die Änderung erneut."
      );
    }
    const changed = !accessStateEqual(preview.before, preview.after);
    await setMembershipAccess(targetUserId, role, preview.after.careDataScope, actor.id, database, timestamp);
    if (changed) {
      await cleanUpMemberDeliveryState(targetUserId, role, true, database, timestamp);
      await recordMemberAudit(
        database,
        actor.id,
        targetUserId,
        "membershipAccess",
        preview.before ? {
          role: preview.before.role,
          careDataScope: preview.before.careDataScope
        } : null,
        { role: preview.after.role, careDataScope: preview.after.careDataScope },
        timestamp
      );
    }
    const member = await memberById(targetUserId, database);
    if (!member) throw new MemberManagementError("unknown_user", 404, "Mitglied nicht gefunden.");
    return { member, access: preview.after };
  });
}

export async function assertInvitationAccessPreview(
  actor: RequestUser,
  role: WorkspaceRole,
  scope: CareDataScope,
  previewFingerprint: string,
  database: DatabaseExecutor,
  driver: DatabaseDriver
): Promise<ApiMemberAccessPreview> {
  await lockPostgresMemberAccessBasis(driver, database, "invitation");
  const preview = await previewInvitationAccess(actor, role, scope, database);
  if (preview.fingerprint !== previewFingerprint) {
    throw new MemberManagementError(
      "member_access_preview_changed",
      409,
      "Die Zugriffsgrundlage hat sich geändert. Bitte prüfe die Einladung erneut."
    );
  }
  return preview;
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
    const targetUser = await database.selectFrom("app_users")
      .select("external_subject")
      .where("id", "=", targetUserId)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!targetUser) {
      throw new MemberManagementError("unknown_user", 404, "Mitglied nicht gefunden.");
    }
    const removedRole = await clearMembershipRole(targetUserId, actor.id, database, timestamp);
    await revokeOidcSessionsByExternalSubject(targetUser.external_subject, database, timestamp);
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
