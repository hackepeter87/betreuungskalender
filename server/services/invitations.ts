import type Database from "better-sqlite3";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { RequestUser, WorkspaceRole } from "../auth.js";
import { db } from "../db/connection.js";
import { setMembershipRole } from "./memberships.js";

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

interface InvitationRow {
  id: string;
  token_hash: string;
  email_hint: string | null;
  role: WorkspaceRole;
  expires_at: string;
  accepted_user_id: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  data_transfer_actor_id: string | null;
}

export class InvitationError extends Error {
  constructor(
    public readonly code:
      | "invalid_invitation"
      | "invitation_expired"
      | "invitation_revoked"
      | "invitation_already_accepted"
      | "unknown_user",
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export function invitationTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function mapInvitation(row: InvitationRow): InvitationSummary {
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

function selectInvitationByToken(
  token: string,
  database: Database.Database
): InvitationRow | undefined {
  return database.prepare(`
    SELECT id, token_hash, email_hint, role, expires_at, accepted_user_id,
      accepted_at, revoked_at, created_at, updated_at, data_transfer_actor_id
    FROM app_invitations
    WHERE token_hash = ?
      AND deleted_at IS NULL
  `).get(invitationTokenHash(token)) as InvitationRow | undefined;
}

function selectInvitationByHash(
  hash: string,
  database: Database.Database
): InvitationRow | undefined {
  if (!/^[0-9a-f]{64}$/.test(hash)) return undefined;
  return database.prepare(`
    SELECT id, token_hash, email_hint, role, expires_at, accepted_user_id,
      accepted_at, revoked_at, created_at, updated_at, data_transfer_actor_id
    FROM app_invitations
    WHERE token_hash = ?
      AND deleted_at IS NULL
  `).get(hash) as InvitationRow | undefined;
}

function selectInvitationById(
  id: string,
  database: Database.Database
): InvitationRow | undefined {
  return database.prepare(`
    SELECT id, token_hash, email_hint, role, expires_at, accepted_user_id,
      accepted_at, revoked_at, created_at, updated_at, data_transfer_actor_id
    FROM app_invitations
    WHERE id = ?
      AND deleted_at IS NULL
  `).get(id) as InvitationRow | undefined;
}

function assertKnownUser(userId: string, database: Database.Database): void {
  const row = database.prepare(`
    SELECT id
    FROM app_users
    WHERE id = ? AND deleted_at IS NULL
  `).get(userId) as { id: string } | undefined;
  if (!row) {
    throw new InvitationError(
      "unknown_user",
      400,
      "Der angemeldete Nutzer ist noch nicht als App-Nutzer bekannt."
    );
  }
}

function normalizeEmailHint(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || undefined;
}

export function createInvitation(
  input: {
    role: WorkspaceRole;
    expiresAt: string;
    actorId: string;
    emailHint?: string;
    token?: string;
    timestamp?: string;
    dataTransferActorId?: string;
  },
  database: Database.Database = db
): CreatedInvitation {
  const token = input.token ?? randomBytes(32).toString("base64url");
  const timestamp = input.timestamp ?? new Date().toISOString();
  const id = randomUUID();
  database.prepare(`
    INSERT INTO app_invitations (
      id, token_hash, email_hint, role, expires_at,
      created_by, updated_by, created_at, updated_at, data_transfer_actor_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    invitationTokenHash(token),
    normalizeEmailHint(input.emailHint) ?? null,
    input.role,
    input.expiresAt,
    input.actorId,
    input.actorId,
    timestamp,
    timestamp,
    input.dataTransferActorId ?? null
  );
  const invitation = selectInvitationById(id, database);
  if (!invitation) {
    throw new InvitationError(
      "invalid_invitation",
      500,
      "Die Einladung konnte nicht erstellt werden."
    );
  }
  return {
    token,
    invitation: mapInvitation(invitation)
  };
}

export function acceptInvitation(
  token: string,
  user: RequestUser,
  timestamp = new Date().toISOString(),
  database: Database.Database = db
): InvitationSummary {
  return database.transaction(() => {
    assertKnownUser(user.id, database);
    const invitation = selectInvitationByToken(token, database);
    return acceptSelectedInvitation(invitation, user, timestamp, database);
  })();
}

function acceptSelectedInvitation(
  invitation: InvitationRow | undefined,
  user: RequestUser,
  timestamp: string,
  database: Database.Database
): InvitationSummary {
    if (!invitation) {
      throw new InvitationError(
        "invalid_invitation",
        404,
        "Die Einladung ist ungültig."
      );
    }
    if (invitation.revoked_at) {
      throw new InvitationError(
        "invitation_revoked",
        410,
        "Die Einladung wurde widerrufen."
      );
    }
    if (invitation.accepted_at) {
      throw new InvitationError(
        "invitation_already_accepted",
        409,
        "Die Einladung wurde bereits angenommen."
      );
    }
    if (Date.parse(invitation.expires_at) <= Date.parse(timestamp)) {
      throw new InvitationError(
        "invitation_expired",
        410,
        "Die Einladung ist abgelaufen."
      );
    }

    setMembershipRole(user.id, invitation.role, user.id, timestamp, database);
    if (invitation.data_transfer_actor_id) {
      database.prepare(`
        UPDATE data_transfer_actors
        SET mapped_user_id = ?, updated_by = ?, updated_at = ?
        WHERE id = ?
      `).run(user.id, user.id, timestamp, invitation.data_transfer_actor_id);
      const assignments = database.prepare(`
        SELECT target_care_party_id AS carePartyId
        FROM data_transfer_actor_care_parties
        WHERE actor_id = ? AND target_care_party_id IS NOT NULL
      `).all(invitation.data_transfer_actor_id) as Array<{ carePartyId: string }>;
      const insertAssignment = database.prepare(`
        INSERT INTO app_user_care_party_assignments (
          id, user_id, care_party_id, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
      `);
      for (const assignment of assignments) {
        insertAssignment.run(
          randomUUID(), user.id, assignment.carePartyId, user.id, user.id, timestamp, timestamp
        );
      }
    }
    database.prepare(`
      UPDATE app_invitations
      SET accepted_user_id = ?,
          accepted_at = ?,
          updated_by = ?,
          updated_at = ?
      WHERE id = ?
    `).run(user.id, timestamp, user.id, timestamp, invitation.id);

    const accepted = selectInvitationById(invitation.id, database);
    if (!accepted) {
      throw new InvitationError(
        "invalid_invitation",
        500,
        "Die Einladung konnte nicht aktualisiert werden."
      );
    }
    return mapInvitation(accepted);
}

export function prepareInvitationLogin(
  token: string,
  timestamp = new Date().toISOString(),
  database: Database.Database = db
): string {
  const hash = invitationTokenHash(token.trim());
  const invitation = selectInvitationByHash(hash, database);
  if (!invitation) {
    throw new InvitationError("invalid_invitation", 404, "Die Einladung ist ungültig.");
  }
  if (invitation.revoked_at) {
    throw new InvitationError("invitation_revoked", 410, "Die Einladung wurde widerrufen.");
  }
  if (invitation.accepted_at) {
    throw new InvitationError(
      "invitation_already_accepted",
      409,
      "Die Einladung wurde bereits angenommen."
    );
  }
  if (Date.parse(invitation.expires_at) <= Date.parse(timestamp)) {
    throw new InvitationError("invitation_expired", 410, "Die Einladung ist abgelaufen.");
  }
  return hash;
}

export function acceptInvitationByHash(
  hash: string,
  user: RequestUser,
  timestamp = new Date().toISOString(),
  database: Database.Database = db
): InvitationSummary {
  return database.transaction(() => {
    assertKnownUser(user.id, database);
    return acceptSelectedInvitation(
      selectInvitationByHash(hash, database),
      user,
      timestamp,
      database
    );
  })();
}

export function revokeInvitation(
  id: string,
  actorId: string,
  timestamp = new Date().toISOString(),
  database: Database.Database = db
): InvitationSummary | undefined {
  database.prepare(`
    UPDATE app_invitations
    SET revoked_at = ?,
        updated_by = ?,
        updated_at = ?
    WHERE id = ?
      AND accepted_at IS NULL
      AND revoked_at IS NULL
      AND deleted_at IS NULL
  `).run(timestamp, actorId, timestamp, id);
  const invitation = selectInvitationById(id, database);
  return invitation ? mapInvitation(invitation) : undefined;
}

export function listInvitations(
  database: Database.Database = db
): InvitationSummary[] {
  const rows = database.prepare(`
    SELECT id, token_hash, email_hint, role, expires_at, accepted_user_id,
      accepted_at, revoked_at, created_at, updated_at, data_transfer_actor_id
    FROM app_invitations
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC, id DESC
  `).all() as InvitationRow[];
  return rows.map(mapInvitation);
}
