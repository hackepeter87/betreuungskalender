import type { FastifyInstance, FastifyReply } from "fastify";
import { config } from "../config.js";
import {
  createInvitation,
  listInvitations,
  revokeInvitation
} from "../services/invitations.js";
import {
  assertCanAdministerMembers,
  MemberManagementError
} from "../services/memberManagement.js";
import {
  InvitationEmailError,
  invitationEmailAvailable,
  invitationUrl,
  sendInvitationEmail
} from "../services/invitationEmail.js";
import { getStoredSettings } from "../services/settings.js";
import { invitationInputSchema } from "../validation/schemas.js";

const readLimit = {
  config: { permission: "members:manage" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { permission: "members:manage" as const, rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};

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

function invitationSenderName(): string | undefined {
  const value = getStoredSettings()["setup.installationLabel"];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function preventInvitationCache(reply: FastifyReply): FastifyReply {
  return reply
    .header("cache-control", "no-store, max-age=0")
    .header("pragma", "no-cache")
    .header("expires", "0");
}

export async function invitationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/invitations/capabilities", readLimit, async (request, reply) => {
    try {
      assertCanAdministerMembers(request.user);
    } catch (error) {
      const normalized = normalizeMemberError(error);
      return reply.code(normalized.statusCode).send({
        error: normalized.error,
        message: normalized.message
      });
    }
    return { emailDeliveryAvailable: invitationEmailAvailable(config) };
  });

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
    const invitationReply = preventInvitationCache(reply);
    try {
      assertCanAdministerMembers(request.user);
    } catch (error) {
      const normalized = normalizeMemberError(error);
      return invitationReply.code(normalized.statusCode).send({
        error: normalized.error,
        message: normalized.message
      });
    }
    const parsed = invitationInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return invitationReply.code(400).send({
        error: "validation_error",
        issues: parsed.error.issues
      });
    }
    const created = createInvitation({
      ...parsed.data,
      actorId: request.userEmail
    });
    const publicInvitationUrl = invitationUrl(created.token, config.invitationPublicBaseUrl);
    if (!parsed.data.sendEmail) {
      return invitationReply.code(201).send({
        ...created,
        invitationUrl: publicInvitationUrl,
        emailDelivery: { status: "not_requested" }
      });
    }
    try {
      await sendInvitationEmail(
        {
          to: parsed.data.emailHint,
          token: created.token,
          role: created.invitation.role,
          expiresAt: created.invitation.expiresAt
        },
        {
          ...config,
          smtpFromName: invitationSenderName()
        }
      );
      return invitationReply.code(201).send({
        ...created,
        invitationUrl: publicInvitationUrl,
        emailDelivery: { status: "sent" }
      });
    } catch (error) {
      return invitationReply.code(201).send({
        ...created,
        invitationUrl: publicInvitationUrl,
        emailDelivery: {
          status: "failed",
          message: normalizeInvitationEmailError(error)
        }
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
