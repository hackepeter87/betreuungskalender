import type { FastifyInstance, FastifyRequest } from "fastify";
import { cookieValue } from "../cookies.js";
import { config } from "../config.js";
import { resolveRequestUser, type RequestUser } from "../auth.js";
import { isTrustedProxyAddress } from "../trustedProxy.js";
import { bootstrapInstallationOwner, completeFirstUseSetup, SetupBootstrapError } from "../services/setupBootstrap.js";
import { findAuthenticatedUserBySubject, upsertAuthenticatedUser } from "../services/users.js";
import type { OidcSessionStore } from "../services/oidcSessions.js";
import { setupFirstUseInputSchema } from "../validation/schemas.js";

const writeLimit = {
  config: { rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};

interface SetupRouteOptions {
  nativeSessions: Pick<OidcSessionStore, "findByToken">;
}

function setupUserFromNativeSession(
  request: FastifyRequest,
  sessions: Pick<OidcSessionStore, "findByToken">
): RequestUser | undefined {
  const session = sessions.findByToken(cookieValue(request.headers.cookie, config.sessionCookieName));
  return session ? findAuthenticatedUserBySubject(session.externalSubject) : undefined;
}

function setupUserFromTrustedProxy(request: FastifyRequest): RequestUser | undefined {
  if (!isTrustedProxyAddress(request.raw.socket.remoteAddress, config.trustedProxyRules)) {
    throw Object.assign(new Error("Die Proxy-Authentifizierung ist von dieser Netzwerkadresse nicht zugelassen."), {
      code: "untrusted_proxy",
      statusCode: 403
    });
  }
  const auth = resolveRequestUser(request.headers, {
    requireAuth: config.requireAuth,
    trustProxyAuth: config.trustProxyAuth,
    userIdHeader: config.oidcUserIdHeader,
    emailHeader: config.oidcEmailHeader,
    displayNameHeader: config.oidcDisplayNameHeader,
    groupsHeader: config.oidcGroupsHeader,
    adminGroup: config.oidcAdminGroup,
    parentGroup: config.oidcParentGroup,
    readonlyGroup: config.oidcReadonlyGroup,
    requireRoleClaim: config.oidcRequireRoleClaim,
    fallbackRoleOnMissing: "readonly"
  });
  if (!auth.authenticated || !auth.user) return undefined;
  upsertAuthenticatedUser(auth.user);
  return auth.user;
}

function setupUserFromLocalMode(request: FastifyRequest): RequestUser | undefined {
  const auth = resolveRequestUser(request.headers, {
    requireAuth: config.requireAuth,
    trustProxyAuth: false,
    userIdHeader: config.oidcUserIdHeader,
    emailHeader: config.oidcEmailHeader,
    displayNameHeader: config.oidcDisplayNameHeader,
    groupsHeader: config.oidcGroupsHeader,
    adminGroup: config.oidcAdminGroup,
    parentGroup: config.oidcParentGroup,
    readonlyGroup: config.oidcReadonlyGroup,
    requireRoleClaim: config.oidcRequireRoleClaim,
    fallbackRoleOnMissing: "readonly"
  });
  return auth.user;
}

function setupUser(
  request: FastifyRequest,
  sessions: Pick<OidcSessionStore, "findByToken">
): RequestUser | undefined {
  if (config.authMode === "native-oidc") return setupUserFromNativeSession(request, sessions);
  if (config.trustProxyAuth) return setupUserFromTrustedProxy(request);
  return setupUserFromLocalMode(request);
}

function normalizeSetupError(error: unknown) {
  if (error instanceof SetupBootstrapError) {
    return {
      statusCode: error.statusCode,
      error: error.code,
      message: error.message
    };
  }
  if (error && typeof error === "object" && "statusCode" in error && "code" in error) {
    const typed = error as { statusCode: number; code: string; message: string };
    return {
      statusCode: typed.statusCode,
      error: typed.code,
      message: typed.message
    };
  }
  return {
    statusCode: 500,
    error: "setup_failed",
    message: "Die Einrichtung konnte nicht abgeschlossen werden."
  };
}

export async function setupRoutes(
  app: FastifyInstance,
  options: SetupRouteOptions
): Promise<void> {
  app.post("/api/setup/owner-bootstrap", writeLimit, async (request, reply) => {
    const body = request.body as { confirm?: unknown } | undefined;
    if (body?.confirm !== true) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Die Einrichtung muss ausdrücklich bestätigt werden."
      });
    }

    const user = setupUser(request, options.nativeSessions);
    if (!user) {
      return reply.code(401).send({
        error: "authentication_required",
        message: "Authentifizierung erforderlich."
      });
    }

    try {
      return bootstrapInstallationOwner(user);
    } catch (error) {
      const normalized = normalizeSetupError(error);
      return reply.code(normalized.statusCode).send({
        error: normalized.error,
        message: normalized.message
      });
    }
  });

  app.post("/api/setup/first-use", writeLimit, async (request, reply) => {
    const parsed = setupFirstUseInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        issues: parsed.error.issues
      });
    }

    const user = setupUser(request, options.nativeSessions);
    if (!user) {
      return reply.code(401).send({
        error: "authentication_required",
        message: "Authentifizierung erforderlich."
      });
    }

    try {
      return completeFirstUseSetup(user, parsed.data);
    } catch (error) {
      const normalized = normalizeSetupError(error);
      return reply.code(normalized.statusCode).send({
        error: normalized.error,
        message: normalized.message
      });
    }
  });
}
