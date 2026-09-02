import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { RequestUser, WorkspaceRole } from "../auth.js";
import type { DatabaseExecutor, PersistenceRuntime } from "../db/runtime.js";
import { setMembershipRole } from "./memberships.js";
import { upsertAuthenticatedUser } from "./users.js";

export interface InvitationSummary {
  id: string;
  role: WorkspaceRole;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  emailHint?: string;
  acceptedUserId?: string;
  acceptedAt?: string;
  revokedAt?: string;
}

export interface CreatedInvitation {
  invitation: InvitationSummary;
  token: string;
}

type InvitationRow = {
  id: string;
  token_hash: string;
  email_hint: string | null;
  role: string;
  expires_at: string;
  accepted_user_id: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  data_transfer_actor_id: string | null;
};

export class InvitationError extends Error {
  constructor(
    public readonly code:
      | "invalid_invitation"
      | "invitation_expired"
      | "invitation_revoked"
      | "invitation_already_accepted",
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export function invitationTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function isWorkspaceRole(role: string): role is WorkspaceRole {
  return role === "admin" || role === "editor" || role === "scheduler" || role === "viewer";
}

function mapInvitation(row: InvitationRow): InvitationSummary {
  if (!isWorkspaceRole(row.role)) {
    throw new InvitationError("invalid_invitation", 500, "Die Einladung enthält eine ungültige Rolle.");
  }
  return {
    id: row.id,
    role: row.role,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.email_hint ? { emailHint: row.email_hint } : {}),
    ...(row.accepted_user_id ? { acceptedUserId: row.accepted_user_id } : {}),
    ...(row.accepted_at ? { acceptedAt: row.accepted_at } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {})
  };
}

const invitationColumns = [
  "id", "token_hash", "email_hint", "role", "expires_at", "accepted_user_id",
  "accepted_at", "revoked_at", "created_at", "updated_at", "data_transfer_actor_id"
] as const;

async function selectInvitationByHash(hash: string, database: DatabaseExecutor) {
  if (!/^[0-9a-f]{64}$/.test(hash)) return undefined;
  return database.selectFrom("app_invitations")
    .select(invitationColumns)
    .where("token_hash", "=", hash)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
}

async function selectInvitationById(id: string, database: DatabaseExecutor) {
  return database.selectFrom("app_invitations")
    .select(invitationColumns)
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
}

function normalizeEmailHint(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase() || undefined;
}

export async function createInvitation(
  input: {
    role: WorkspaceRole;
    expiresAt: string;
    actorId: string;
    emailHint?: string;
    token?: string;
    timestamp?: string;
    dataTransferActorId?: string;
  },
  database: DatabaseExecutor
): Promise<CreatedInvitation> {
  const token = input.token ?? randomBytes(32).toString("base64url");
  const timestamp = input.timestamp ?? new Date().toISOString();
  const id = randomUUID();
  await database.insertInto("app_invitations").values({
    id,
    token_hash: invitationTokenHash(token),
    email_hint: normalizeEmailHint(input.emailHint) ?? null,
    role: input.role,
    expires_at: input.expiresAt,
    accepted_user_id: null,
    accepted_at: null,
    revoked_at: null,
    created_by: input.actorId,
    updated_by: input.actorId,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
    data_transfer_actor_id: input.dataTransferActorId ?? null
  }).execute();
  const invitation = await selectInvitationById(id, database);
  if (!invitation) {
    throw new InvitationError("invalid_invitation", 500, "Die Einladung konnte nicht erstellt werden.");
  }
  return { token, invitation: mapInvitation(invitation) };
}

function assertInvitationUsable(
  invitation: InvitationRow | undefined,
  timestamp: string
): asserts invitation is InvitationRow {
  if (!invitation) throw new InvitationError("invalid_invitation", 404, "Die Einladung ist ungültig.");
  if (invitation.revoked_at) {
    throw new InvitationError("invitation_revoked", 410, "Die Einladung wurde widerrufen.");
  }
  if (invitation.accepted_at) {
    throw new InvitationError("invitation_already_accepted", 409, "Die Einladung wurde bereits angenommen.");
  }
  if (Date.parse(invitation.expires_at) <= Date.parse(timestamp)) {
    throw new InvitationError("invitation_expired", 410, "Die Einladung ist abgelaufen.");
  }
}

async function acceptSelectedInvitation(
  invitation: InvitationRow | undefined,
  user: RequestUser,
  timestamp: string,
  database: DatabaseExecutor
): Promise<InvitationSummary> {
  assertInvitationUsable(invitation, timestamp);
  if (!isWorkspaceRole(invitation.role)) {
    throw new InvitationError("invalid_invitation", 500, "Die Einladung enthält eine ungültige Rolle.");
  }
  await upsertAuthenticatedUser(user, database, timestamp);
  await setMembershipRole(user.id, invitation.role, user.id, database, timestamp);
  if (invitation.data_transfer_actor_id) {
    await database.updateTable("data_transfer_actors")
      .set({ mapped_user_id: user.id, updated_by: user.id, updated_at: timestamp })
      .where("id", "=", invitation.data_transfer_actor_id)
      .execute();
    const assignments = await database.selectFrom("data_transfer_actor_care_parties")
      .select("target_care_party_id")
      .where("actor_id", "=", invitation.data_transfer_actor_id)
      .where("target_care_party_id", "is not", null)
      .execute();
    for (const assignment of assignments) {
      if (!assignment.target_care_party_id) continue;
      await database.insertInto("app_user_care_party_assignments").values({
        id: randomUUID(),
        user_id: user.id,
        care_party_id: assignment.target_care_party_id,
        created_by: user.id,
        updated_by: user.id,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null
      }).onConflict((conflict) => conflict.doNothing()).execute();
    }
  }
  const update = await database.updateTable("app_invitations")
    .set({
      accepted_user_id: user.id,
      accepted_at: timestamp,
      updated_by: user.id,
      updated_at: timestamp
    })
    .where("id", "=", invitation.id)
    .where("accepted_at", "is", null)
    .where("revoked_at", "is", null)
    .executeTakeFirst();
  if (Number(update.numUpdatedRows) !== 1) {
    throw new InvitationError(
      "invitation_already_accepted",
      409,
      "Die Einladung wurde bereits angenommen."
    );
  }
  const accepted = await selectInvitationById(invitation.id, database);
  if (!accepted) {
    throw new InvitationError("invalid_invitation", 500, "Die Einladung konnte nicht aktualisiert werden.");
  }
  return mapInvitation(accepted);
}

export async function acceptInvitation(
  token: string,
  user: RequestUser,
  persistence: PersistenceRuntime,
  timestamp = new Date().toISOString()
): Promise<InvitationSummary> {
  return persistence.transaction(async (database) => {
    return acceptSelectedInvitation(
      await selectInvitationByHash(invitationTokenHash(token), database),
      user,
      timestamp,
      database
    );
  });
}

export async function prepareInvitationLogin(
  token: string,
  database: DatabaseExecutor,
  timestamp = new Date().toISOString()
): Promise<string> {
  const hash = invitationTokenHash(token.trim());
  assertInvitationUsable(await selectInvitationByHash(hash, database), timestamp);
  return hash;
}

export async function acceptInvitationByHash(
  hash: string,
  user: RequestUser,
  persistence: PersistenceRuntime,
  timestamp = new Date().toISOString()
): Promise<InvitationSummary> {
  return persistence.transaction((database) =>
    acceptInvitationByHashInTransaction(hash, user, database, timestamp));
}

export async function acceptInvitationByHashInTransaction(
  hash: string,
  user: RequestUser,
  database: DatabaseExecutor,
  timestamp = new Date().toISOString()
): Promise<InvitationSummary> {
  return acceptSelectedInvitation(
    await selectInvitationByHash(hash, database),
    user,
    timestamp,
    database
  );
}

export async function revokeInvitation(
  id: string,
  actorId: string,
  database: DatabaseExecutor,
  timestamp = new Date().toISOString()
): Promise<InvitationSummary | undefined> {
  await database.updateTable("app_invitations")
    .set({ revoked_at: timestamp, updated_by: actorId, updated_at: timestamp })
    .where("id", "=", id)
    .where("accepted_at", "is", null)
    .where("revoked_at", "is", null)
    .where("deleted_at", "is", null)
    .execute();
  const invitation = await selectInvitationById(id, database);
  return invitation ? mapInvitation(invitation) : undefined;
}

export async function listInvitations(database: DatabaseExecutor): Promise<InvitationSummary[]> {
  const rows = await database.selectFrom("app_invitations")
    .select(invitationColumns)
    .where("deleted_at", "is", null)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  return rows.map(mapInvitation);
}
