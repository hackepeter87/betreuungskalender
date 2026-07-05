import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import {
  acceptInvitation,
  createInvitation,
  InvitationError,
  listInvitations,
  revokeInvitation
} from "../services/invitations.js";
import {
  assertCanAdministerMembers,
  MemberManagementError
} from "../services/memberManagement.js";
import {
  InvitationEmailError,
  sendInvitationEmail
} from "../services/invitationEmail.js";
import {
  invitationAcceptInputSchema,
  invitationInputSchema
} from "../validation/schemas.js";

const readLimit = {
  config: { rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};

function normalizeInvitationError(error: unknown) {
  if (error instanceof InvitationError) {
    return {
      statusCode: error.statusCode,
      error: error.code,
      message: error.message
    };
  }
  return {
    statusCode: 500,
    error: "invitation_failed",
    message: "Die Einladung konnte nicht verarbeitet werden."
  };
}

function normalizeMemberError(error: unknown) {
  if (error instanceof MemberManagementError) {
    return {
      statusCode: error.statusCode,
      error: error.code,
      message: error.message
    };
  }
  return {
    statusCode: 500,
    error: "member_admin_failed",
    message: "Mitgliederverwaltung konnte nicht geprüft werden."
  };
}

function normalizeInvitationEmailError(error: unknown): string {
  if (error instanceof InvitationEmailError) return error.message;
  return "Einladungs-E-Mail konnte nicht gesendet werden.";
}

export async function invitationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/invitations", readLimit, async (request, reply) => {
    try {
      assertCanAdministerMembers(request.user);
    } catch (error) {
      const normalized = normalizeMemberError(error);
      return reply.code(normalized.statusCode).send({
        error: normalized.error,
        message: normalized.message
      });
    }
    return listInvitations();
  });

  app.post("/api/invitations", writeLimit, async (request, reply) => {
    try {
      assertCanAdministerMembers(request.user);
    } catch (error) {
      const normalized = normalizeMemberError(error);
      return reply.code(normalized.statusCode).send({
        error: normalized.error,
        message: normalized.message
      });
    }
    const parsed = invitationInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        issues: parsed.error.issues
      });
    }
    const created = createInvitation({
      ...parsed.data,
      actorId: request.userEmail
    });
    if (!parsed.data.sendEmail) {
      return reply.code(201).send({
        ...created,
        emailDelivery: { status: "not_requested" }
      });
    }
    try {
      await sendInvitationEmail({
        to: parsed.data.emailHint,
        token: created.token,
        role: created.invitation.role,
        expiresAt: created.invitation.expiresAt
      });
      return reply.code(201).send({
        ...created,
        emailDelivery: { status: "sent" }
      });
    } catch (error) {
      return reply.code(201).send({
        ...created,
        emailDelivery: {
          status: "failed",
          message: normalizeInvitationEmailError(error)
        }
      });
    }
  });

  app.post("/api/invitations/accept", writeLimit, async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({
        error: "authentication_required",
        message: "Authentifizierung erforderlich."
      });
    }
    const parsed = invitationAcceptInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        issues: parsed.error.issues
      });
    }
    try {
      return acceptInvitation(parsed.data.token, request.user);
    } catch (error) {
      const normalized = normalizeInvitationError(error);
      return reply.code(normalized.statusCode).send({
        error: normalized.error,
        message: normalized.message
      });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/invitations/:id", writeLimit, async (request, reply) => {
    try {
      assertCanAdministerMembers(request.user);
    } catch (error) {
      const normalized = normalizeMemberError(error);
      return reply.code(normalized.statusCode).send({
        error: normalized.error,
        message: normalized.message
      });
    }
    const invitation = revokeInvitation(request.params.id, request.userEmail);
    if (!invitation) {
      return reply.code(404).send({
        error: "not_found",
        message: "Einladung nicht gefunden."
      });
    }
    return invitation;
  });
}
