import type { FastifyInstance, FastifyReply } from "fastify";
import { userFromClaims, type RequestUser } from "../auth.js";
import type { config as appConfig } from "../config.js";
import {
  clearSessionCookie,
  cookieValue,
  serializeSessionCookie
} from "../cookies.js";
import { NativeOidcError, NativeOidcService } from "../nativeOidc.js";
import {
  applyMembershipRole,
  type MembershipResolution
} from "../services/memberships.js";
import { OidcSessionStore } from "../services/oidcSessions.js";
import {
  OwnerSetupTokenError,
  OwnerSetupTokenStore
} from "../services/ownerSetupTokens.js";
import { buildSetupState } from "../services/setupState.js";
import { upsertAuthenticatedUser } from "../services/users.js";
import {
  acceptInvitationByHash,
  InvitationError,
  prepareInvitationLogin
} from "../services/invitations.js";

type NativeOidcRouteConfig = Pick<
  typeof appConfig,
  | "authMode"
  | "oidcIssuerUrl"
  | "oidcClientId"
  | "oidcClientSecret"
  | "oidcRedirectUri"
  | "oidcPostLogoutRedirectUri"
  | "oidcScopes"
  | "oidcGroupsClaim"
  | "oidcLoginStateTtlSeconds"
  | "oidcAdminGroup"
  | "oidcParentGroup"
  | "oidcReadonlyGroup"
  | "oidcRequireRoleClaim"
  | "sessionCookieName"
  | "sessionTtlSeconds"
  | "nodeEnv"
  | "rateLimitSensitiveMax"
  | "rateLimitWindowMs"
> & Partial<Pick<typeof appConfig, "ownerSetupTokenFile" | "ownerSetupTokenTtlSeconds">>;

interface NativeOidcRoutesOptions {
  config: NativeOidcRouteConfig;
  service?: Pick<
    NativeOidcService,
    "createLoginRedirect" | "createLogoutRedirect" | "validateCallback"
  >;
  sessions?: OidcSessionStore;
  upsertUser?: (user: RequestUser) => void;
  applyMembershipRole?: (user: RequestUser) => MembershipResolution;
  isSetupRequired?: () => boolean;
  ownerSetupTokens?: Pick<OwnerSetupTokenStore, "begin" | "consumeAndClaim">;
  invitationFlow?: {
    begin(token: string): string;
    accept(tokenHash: string, user: RequestUser): void;
  };
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: "not_found",
    message: "Ressource nicht gefunden."
  });
}

function sanitizedError(error: unknown): NativeOidcError {
  if (error instanceof NativeOidcError) return error;
  if (error instanceof OwnerSetupTokenError) {
    return new NativeOidcError(error.code, error.statusCode, error.message);
  }
  if (error instanceof InvitationError) {
    return new NativeOidcError(error.code, error.statusCode, error.message);
  }
  return new NativeOidcError(
    "native_oidc_request_failed",
    500,
    "Native OIDC request failed."
  );
}

export async function nativeOidcRoutes(
  app: FastifyInstance,
  options: NativeOidcRoutesOptions
): Promise<void> {
  const secureCookie = options.config.nodeEnv === "production";
  const authRateLimit = {
    config: {
      rateLimit: {
        max: options.config.rateLimitSensitiveMax,
        timeWindow: options.config.rateLimitWindowMs
      }
    }
  };
  const service = options.service ?? new NativeOidcService({
    config: {
      issuerUrl: options.config.oidcIssuerUrl,
      clientId: options.config.oidcClientId,
      clientSecret: options.config.oidcClientSecret,
      redirectUri: options.config.oidcRedirectUri,
      postLogoutRedirectUri: options.config.oidcPostLogoutRedirectUri,
      scopes: options.config.oidcScopes,
      groupsClaim: options.config.oidcGroupsClaim,
      loginStateTtlSeconds: options.config.oidcLoginStateTtlSeconds
    }
  });
  const sessions = options.sessions ?? new OidcSessionStore();
  const upsertUser = options.upsertUser ?? upsertAuthenticatedUser;
  const resolveMembership = options.applyMembershipRole ?? applyMembershipRole;
  const isSetupRequired = options.isSetupRequired ?? (() => buildSetupState().required);
  const ownerSetupTokens = options.ownerSetupTokens ?? new OwnerSetupTokenStore({
    tokenFile: options.config.ownerSetupTokenFile ?? "/run/secrets/owner-setup-token",
    ttlSeconds: options.config.ownerSetupTokenTtlSeconds ?? 86_400
  });
  const invitationFlow = options.invitationFlow ?? {
    begin: (token: string) => prepareInvitationLogin(token),
    accept: (tokenHash: string, user: RequestUser) => {
      acceptInvitationByHash(tokenHash, user);
    }
  };

  const providerLogoutUrl = async (
    log: FastifyInstance["log"]
  ): Promise<string | undefined> => {
    try {
      return (await service.createLogoutRedirect()).href;
    } catch (error) {
      const normalized = sanitizedError(error);
      log.warn(
        { code: normalized.code, statusCode: normalized.statusCode },
        "native oidc provider logout unavailable"
      );
      return undefined;
    }
  };

  app.get("/auth/login", authRateLimit, async (_request, reply) => {
    if (options.config.authMode !== "native-oidc") return notFound(reply);
    try {
      const redirectUrl = await service.createLoginRedirect();
      return reply.redirect(redirectUrl.href);
    } catch (error) {
      const normalized = sanitizedError(error);
      return reply.code(normalized.statusCode).send({
        error: normalized.code,
        message: normalized.message
      });
    }
  });

  app.get<{ Querystring: { token?: string } }>("/setup", authRateLimit, async (request, reply) => {
    if (options.config.authMode !== "native-oidc") return notFound(reply);
    try {
      const token = request.query.token?.trim();
      if (!token) {
        throw new NativeOidcError(
          "owner_setup_invalid",
          400,
          "Der Owner-Setup-Link ist ungültig."
        );
      }
      const tokenHash = ownerSetupTokens.begin(token);
      const redirectUrl = await service.createLoginRedirect({ type: "owner_setup", tokenHash });
      return reply.redirect(redirectUrl.href);
    } catch (error) {
      const normalized = sanitizedError(error);
      return reply.code(normalized.statusCode).send({
        error: normalized.code,
        message: normalized.message
      });
    }
  });

  app.get<{ Querystring: { token?: string } }>("/invite", authRateLimit, async (request, reply) => {
    if (options.config.authMode !== "native-oidc") return notFound(reply);
    try {
      const token = request.query.token?.trim();
      if (!token) {
        throw new NativeOidcError("invalid_invitation", 400, "Die Einladung ist ungültig.");
      }
      const tokenHash = invitationFlow.begin(token);
      const redirectUrl = await service.createLoginRedirect({ type: "invitation", tokenHash });
      return reply.redirect(redirectUrl.href);
    } catch (error) {
      const normalized = sanitizedError(error);
      return reply.code(normalized.statusCode).send({
        error: normalized.code,
        message: normalized.message
      });
    }
  });

  app.get("/auth/callback", authRateLimit, async (request, reply) => {
    if (options.config.authMode !== "native-oidc") return notFound(reply);
    try {
      const claims = await service.validateCallback(request.url);
      const auth = userFromClaims(claims, {
        adminGroup: options.config.oidcAdminGroup,
        parentGroup: options.config.oidcParentGroup,
        readonlyGroup: options.config.oidcReadonlyGroup,
        requireRoleClaim: options.config.oidcRequireRoleClaim,
        fallbackRoleOnMissing: "readonly"
      });
      if (!auth.user) {
        throw new NativeOidcError(
          "authorization_required",
          403,
          "Keine passende Berechtigung in den OIDC-Claims gefunden."
        );
      }
      upsertUser(auth.user);
      if (claims.loginContext.type === "owner_setup") {
        ownerSetupTokens.consumeAndClaim(claims.loginContext.tokenHash, auth.user);
      } else if (claims.loginContext.type === "invitation") {
        invitationFlow.accept(claims.loginContext.tokenHash, auth.user);
      }
      const membership = resolveMembership(auth.user);
      if (auth.reason === "missing_role" && !membership.membershipRole && !isSetupRequired()) {
        throw new NativeOidcError(
          "authorization_required",
          403,
          "Keine passende Berechtigung in den OIDC-Claims gefunden."
        );
      }
      const session = sessions.create(membership.user.externalSubject, options.config.sessionTtlSeconds);
      return reply
        .header("set-cookie", serializeSessionCookie({
          name: options.config.sessionCookieName,
          value: session.token,
          maxAgeSeconds: options.config.sessionTtlSeconds,
          secure: secureCookie
        }))
        .redirect("/");
    } catch (error) {
      const normalized = sanitizedError(error);
      request.log.warn(
        { code: normalized.code, statusCode: normalized.statusCode, requestId: request.id },
        "native oidc callback rejected"
      );
      return reply.code(normalized.statusCode).send({
        error: normalized.code,
        message: normalized.message
      });
    }
  });

  app.get("/auth/logout", authRateLimit, async (request, reply) => {
    if (options.config.authMode !== "native-oidc") return notFound(reply);
    sessions.revokeByToken(
      cookieValue(request.headers.cookie, options.config.sessionCookieName)
    );
    const redirectUrl = await providerLogoutUrl(request.log);
    return reply
      .header("set-cookie", clearSessionCookie(options.config.sessionCookieName, secureCookie))
      .redirect(redirectUrl ?? "/");
  });

  app.post("/auth/logout", authRateLimit, async (request, reply) => {
    if (options.config.authMode !== "native-oidc") return notFound(reply);
    sessions.revokeByToken(
      cookieValue(request.headers.cookie, options.config.sessionCookieName)
    );
    const redirectUrl = await providerLogoutUrl(request.log);
    return reply
      .header("set-cookie", clearSessionCookie(options.config.sessionCookieName, secureCookie))
      .send({
        authenticated: false,
        loggedOut: true,
        ...(redirectUrl ? { logoutRedirectUrl: redirectUrl } : {})
      });
  });
}
