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
  invitationAcceptInputSchema,
  invitationInputSchema
} from "../validation/schemas.js";

const readLimit = {
  config: { rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};

function ensureAdmin(request: { user?: { role: string } }, reply: { code: (status: number) => { send: (payload: unknown) => unknown } }) {
  if (request.user?.role === "admin") return undefined;
  return reply.code(403).send({
    error: "forbidden",
    message: "Für diese Aktion fehlt die erforderliche Berechtigung."
  });
}

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

export async function invitationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/invitations", readLimit, async (request, reply) => {
    const denied = ensureAdmin(request, reply);
    if (denied) return denied;
    return listInvitations();
  });

  app.post("/api/invitations", writeLimit, async (request, reply) => {
    const denied = ensureAdmin(request, reply);
    if (denied) return denied;
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
    return reply.code(201).send(created);
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
    const denied = ensureAdmin(request, reply);
    if (denied) return denied;
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
