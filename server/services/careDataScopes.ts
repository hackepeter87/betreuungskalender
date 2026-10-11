import { randomUUID } from "node:crypto";
import type { WorkspaceRole } from "../auth.js";
import type { DatabaseExecutor } from "../db/runtime.js";

export type CareDataScope =
  | { type: "all" }
  | { type: "selected"; carePartyIds: string[] };

export class CareDataScopeError extends Error {
  readonly code = "invalid_care_data_scope";
  readonly statusCode = 400;

  constructor() {
    super("Der Datenzugriff enthält eine ungültige betreuende Person.");
    this.name = "CareDataScopeError";
  }
}

function uniqueSorted(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}

export function normalizeCareDataScope(
  role: WorkspaceRole,
  scope: CareDataScope
): CareDataScope {
  if (role === "admin" || scope.type === "all") return { type: "all" };
  return { type: "selected", carePartyIds: uniqueSorted(scope.carePartyIds) };
}

export async function defaultCareDataScope(
  role: WorkspaceRole,
  database: DatabaseExecutor
): Promise<CareDataScope> {
  if (role === "admin") return { type: "all" };
  const activeAssignment = await database.selectFrom("app_user_care_party_assignments")
    .select("id")
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  return activeAssignment ? { type: "selected", carePartyIds: [] } : { type: "all" };
}

export async function assertActiveCareParties(
  scope: CareDataScope,
  database: DatabaseExecutor
): Promise<void> {
  if (scope.type === "all") return;
  const ids = uniqueSorted(scope.carePartyIds);
  if (ids.length === 0) return;
  const rows = await database.selectFrom("care_parties")
    .select("id")
    .where("id", "in", ids)
    .where("deleted_at", "is", null)
    .execute();
  if (rows.length !== ids.length) throw new CareDataScopeError();
}

export async function membershipCareDataScope(
  userId: string,
  database: DatabaseExecutor
): Promise<CareDataScope | undefined> {
  const membership = await database.selectFrom("app_memberships")
    .select(["care_scope_type", "deleted_at"])
    .where("user_id", "=", userId)
    .orderBy("updated_at", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
  if (!membership || membership.deleted_at) return undefined;
  if (membership.care_scope_type === "all") return { type: "all" };
  const rows = await database.selectFrom("app_user_care_party_assignments")
    .select("care_party_id")
    .where("user_id", "=", userId)
    .where("deleted_at", "is", null)
    .orderBy("care_party_id")
    .execute();
  return { type: "selected", carePartyIds: rows.map(({ care_party_id }) => care_party_id) };
}

export async function invitationCareDataScope(
  invitationId: string,
  database: DatabaseExecutor
): Promise<CareDataScope> {
  const invitation = await database.selectFrom("app_invitations")
    .select("care_scope_type")
    .where("id", "=", invitationId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (invitation?.care_scope_type === "all") return { type: "all" };
  const rows = await database.selectFrom("app_invitation_care_party_assignments")
    .select("care_party_id")
    .where("invitation_id", "=", invitationId)
    .where("deleted_at", "is", null)
    .orderBy("care_party_id")
    .execute();
  return { type: "selected", carePartyIds: rows.map(({ care_party_id }) => care_party_id) };
}

export async function syncMemberCareDataScope(
  userId: string,
  scope: CareDataScope,
  actorId: string,
  database: DatabaseExecutor,
  timestamp: string
): Promise<void> {
  const selected = new Set(scope.type === "selected" ? uniqueSorted(scope.carePartyIds) : []);
  const existing = await database.selectFrom("app_user_care_party_assignments")
    .select(["id", "care_party_id", "deleted_at"])
    .where("user_id", "=", userId)
    .execute();
  const active = new Map(existing.filter((row) => !row.deleted_at).map((row) => [row.care_party_id, row]));
  const deleted = new Map(existing.filter((row) => row.deleted_at).map((row) => [row.care_party_id, row]));
  for (const [carePartyId, row] of active) {
    if (selected.delete(carePartyId)) continue;
    await database.updateTable("app_user_care_party_assignments")
      .set({ deleted_at: timestamp, updated_by: actorId, updated_at: timestamp })
      .where("id", "=", row.id)
      .execute();
  }
  for (const carePartyId of [...selected]) {
    const row = deleted.get(carePartyId);
    if (row) {
      await database.updateTable("app_user_care_party_assignments")
        .set({ deleted_at: null, updated_by: actorId, updated_at: timestamp })
        .where("id", "=", row.id)
        .execute();
      selected.delete(carePartyId);
    }
  }
  for (const carePartyId of selected) {
    await database.insertInto("app_user_care_party_assignments").values({
      id: randomUUID(),
      user_id: userId,
      care_party_id: carePartyId,
      created_by: actorId,
      updated_by: actorId,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null
    }).execute();
  }
}

export async function syncInvitationCareDataScope(
  invitationId: string,
  scope: CareDataScope,
  actorId: string,
  database: DatabaseExecutor,
  timestamp: string
): Promise<void> {
  const selected = new Set(scope.type === "selected" ? uniqueSorted(scope.carePartyIds) : []);
  const existing = await database.selectFrom("app_invitation_care_party_assignments")
    .select(["id", "care_party_id", "deleted_at"])
    .where("invitation_id", "=", invitationId)
    .execute();
  const active = new Map(existing.filter((row) => !row.deleted_at).map((row) => [row.care_party_id, row]));
  const deleted = new Map(existing.filter((row) => row.deleted_at).map((row) => [row.care_party_id, row]));
  for (const [carePartyId, row] of active) {
    if (selected.delete(carePartyId)) continue;
    await database.updateTable("app_invitation_care_party_assignments")
      .set({ deleted_at: timestamp, updated_by: actorId, updated_at: timestamp })
      .where("id", "=", row.id)
      .execute();
  }
  for (const carePartyId of [...selected]) {
    const row = deleted.get(carePartyId);
    if (row) {
      await database.updateTable("app_invitation_care_party_assignments")
        .set({ deleted_at: null, updated_by: actorId, updated_at: timestamp })
        .where("id", "=", row.id)
        .execute();
      selected.delete(carePartyId);
    }
  }
  for (const carePartyId of selected) {
    await database.insertInto("app_invitation_care_party_assignments").values({
      id: randomUUID(),
      invitation_id: invitationId,
      care_party_id: carePartyId,
      created_by: actorId,
      updated_by: actorId,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null
    }).execute();
  }
}
