import type Database from "better-sqlite3";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AuthRole, RequestUser } from "../auth.js";
import { db } from "../db/connection.js";
import { setMembershipRole } from "./memberships.js";

export interface InvitationSummary {
  id: string;
  role: AuthRole;
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
  role: AuthRole;
  expires_at: string;
  accepted_user_id: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
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

function tokenHash(token: string): string {
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
      accepted_at, revoked_at, created_at, updated_at
    FROM app_invitations
    WHERE token_hash = ?
      AND deleted_at IS NULL
  `).get(tokenHash(token)) as InvitationRow | undefined;
}

function selectInvitationById(
  id: string,
  database: Database.Database
): InvitationRow | undefined {
  return database.prepare(`
    SELECT id, token_hash, email_hint, role, expires_at, accepted_user_id,
      accepted_at, revoked_at, created_at, updated_at
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
    role: AuthRole;
    expiresAt: string;
    actorId: string;
    emailHint?: string;
    token?: string;
    timestamp?: string;
  },
  database: Database.Database = db
): CreatedInvitation {
  const token = input.token ?? randomBytes(32).toString("base64url");
  const timestamp = input.timestamp ?? new Date().toISOString();
  const id = randomUUID();
  database.prepare(`
    INSERT INTO app_invitations (
      id, token_hash, email_hint, role, expires_at,
      created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    tokenHash(token),
    normalizeEmailHint(input.emailHint) ?? null,
    input.role,
    input.expiresAt,
    input.actorId,
    input.actorId,
    timestamp,
    timestamp
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
      accepted_at, revoked_at, created_at, updated_at
    FROM app_invitations
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC, id DESC
  `).all() as InvitationRow[];
  return rows.map(mapInvitation);
}
