import type { FastifyInstance, FastifyReply } from "fastify";
import { userFromClaims, type RequestUser } from "../auth.js";
import type { config as appConfig } from "../config.js";
import {
  clearSessionCookie,
  cookieValue,
  serializeSessionCookie
} from "../cookies.js";
import { NativeOidcError, NativeOidcService } from "../nativeOidc.js";
import type { DatabaseExecutor, PersistenceRuntime } from "../db/runtime.js";
import {
  applyMembershipRole,
  type MembershipResolution
} from "../services/memberships.js";
import { OidcSessionStore, type OidcSessionRecord } from "../services/oidcSessions.js";
import { OidcLoginStateStore } from "../services/oidcLoginStates.js";
import {
  OwnerSetupTokenError,
  OwnerSetupTokenStore
} from "../services/ownerSetupTokens.js";
import { upsertAuthenticatedUser } from "../services/users.js";
import {
  acceptInvitationByHashInTransaction,
  InvitationError,
  prepareInvitationLogin
} from "../services/invitations.js";
import { publicLegalLinksHtml } from "./legal.js";

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
> & Partial<Pick<
  typeof appConfig,
  "ownerSetupTokenFile" | "ownerSetupTokenTtlSeconds" | "oidcDisplayNameClaim"
>>;

interface NativeOidcRoutesOptions {
  config: NativeOidcRouteConfig;
  persistence: PersistenceRuntime;
  service?: Pick<
    NativeOidcService,
    "createLoginRedirect" | "createLogoutRedirect" | "validateCallback"
  >;
  sessions?: {
    create(
      externalSubject: string,
      ttlSeconds: number,
      now?: Date,
      database?: DatabaseExecutor
    ): Awaitable<{ token: string; session: OidcSessionRecord }>;
    revokeByToken(token: string | undefined): Awaitable<boolean>;
  };
  upsertUser?: (user: RequestUser) => Awaitable<void>;
  applyMembershipRole?: (
    user: RequestUser,
    database?: DatabaseExecutor
  ) => Awaitable<MembershipResolution>;
  ownerSetupTokens?: {
    begin(token: string): Awaitable<string>;
    consumeAndClaim(
      tokenHash: string,
      user: RequestUser,
      now?: Date,
      database?: DatabaseExecutor
    ): Awaitable<void>;
  };
  invitationFlow?: {
    begin(token: string): Awaitable<string>;
    accept(
      tokenHash: string,
      user: RequestUser,
      database?: DatabaseExecutor
    ): Awaitable<void>;
  };
}

type Awaitable<T> = T | Promise<T>;

function notFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: "not_found",
    message: "Ressource nicht gefunden."
  });
}

function preventOnboardingCache(reply: FastifyReply): FastifyReply {
  return reply
    .header("cache-control", "no-store, max-age=0")
    .header("pragma", "no-cache")
    .header("expires", "0");
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

type OnboardingFlow = "owner_setup" | "invitation";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

function onboardingPage(input: {
  flow: OnboardingFlow;
  token?: string;
  error?: NativeOidcError;
}): string {
  const ownerSetup = input.flow === "owner_setup";
  const title = input.error
    ? ownerSetup ? "Einrichtung nicht möglich" : "Einladung nicht verfügbar"
    : ownerSetup ? "Installation einrichten" : "Einladung annehmen";
  const description = input.error?.message ?? (ownerSetup
    ? "Melde dich an, um diese Installation als verantwortliche Person einzurichten."
    : "Melde dich an, um der Installation mit der vorgesehenen Rolle beizutreten.");
  const action = ownerSetup ? "/setup/continue" : "/invite/continue";
  const continueUrl = input.token
    ? `${action}?token=${encodeURIComponent(input.token)}`
    : undefined;
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Betreuungskalender</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #14213d; background: #f4f7f8; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    main { width: min(100%, 560px); background: #fff; border: 1px solid #d8e0e7; border-radius: 8px; padding: 32px; box-shadow: 0 10px 30px rgba(20, 33, 61, .08); }
    .mark { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 8px; background: #e3f3f1; color: #087f7a; font-size: 24px; font-weight: 700; }
    h1 { margin: 20px 0 8px; font-size: clamp(1.65rem, 5vw, 2.15rem); line-height: 1.15; }
    p { margin: 0; color: #5b677d; line-height: 1.6; }
    a { margin-top: 28px; min-height: 48px; display: inline-flex; align-items: center; justify-content: center; width: 100%; padding: 12px 18px; border-radius: 6px; background: #07877f; color: #fff; font-weight: 700; text-decoration: none; }
    .hint { margin-top: 20px; font-size: .9rem; }
    .legal-links { display: flex; justify-content: center; gap: 18px; margin-top: 24px; }
    .legal-links a { margin: 0; min-height: 0; width: auto; padding: 0; background: transparent; color: #087f7a; font-size: .85rem; }
  </style>
</head>
<body>
  <main data-onboarding-state="${input.error ? "error" : "ready"}">
    <div class="mark" aria-hidden="true">${input.error ? "!" : "✓"}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    ${continueUrl ? `<a href="${escapeHtml(continueUrl)}">Weiter zur Anmeldung</a>` : ""}
    <p class="hint">${input.error ? "Bitte fordere bei Bedarf einen neuen Link an." : "Der Link ist persönlich und nur einmal verwendbar."}</p>
    ${publicLegalLinksHtml()}
  </main>
</body>
</html>`;
}

function accessDeniedPage(): string {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kein Zugriff · Betreuungskalender</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #14213d; background: #f4f7f8; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    main { width: min(100%, 560px); background: #fff; border: 1px solid #d8e0e7; border-radius: 8px; padding: 32px; box-shadow: 0 10px 30px rgba(20, 33, 61, .08); }
    .mark { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 8px; background: #fff4dc; color: #8a5b00; font-size: 24px; font-weight: 700; }
    h1 { margin: 20px 0 8px; font-size: clamp(1.65rem, 5vw, 2.15rem); line-height: 1.15; }
    p { margin: 0; color: #5b677d; line-height: 1.6; }
    a { margin-top: 28px; min-height: 48px; display: inline-flex; align-items: center; justify-content: center; width: 100%; padding: 12px 18px; border-radius: 6px; background: #07877f; color: #fff; font-weight: 700; text-decoration: none; }
    .hint { margin-top: 20px; font-size: .9rem; }
    .legal-links { display: flex; justify-content: center; gap: 18px; margin-top: 24px; }
    .legal-links a { margin: 0; min-height: 0; width: auto; padding: 0; background: transparent; color: #087f7a; font-size: .85rem; }
  </style>
</head>
<body>
  <main data-onboarding-state="access-denied">
    <div class="mark" aria-hidden="true">!</div>
    <h1>Kein Zugriff auf diese Installation</h1>
    <p>Die Anmeldung war erfolgreich, aber für diese Installation besteht keine aktive Mitgliedschaft.</p>
    <a href="/auth/logout">Abmelden</a>
    <p class="hint">Verwende einen gültigen Einladungslink oder wende dich an die verantwortliche Person.</p>
    ${publicLegalLinksHtml()}
  </main>
</body>
</html>`;
}

export async function nativeOidcRoutes(
  app: FastifyInstance,
  options: NativeOidcRoutesOptions
): Promise<void> {
  const persistence = options.persistence;
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
      displayNameClaim: options.config.oidcDisplayNameClaim ?? "preferred_username",
      loginStateTtlSeconds: options.config.oidcLoginStateTtlSeconds
    },
    loginStates: new OidcLoginStateStore(persistence)
  });
  const sessions = options.sessions ?? new OidcSessionStore(persistence.query);
  const upsertUser = options.upsertUser ?? (
    (user: RequestUser) => upsertAuthenticatedUser(user, persistence.query)
  );
  const resolveMembership = options.applyMembershipRole ?? (
    (user: RequestUser, database = persistence.query) =>
      applyMembershipRole(user, database)
  );
  const ownerSetupTokens = options.ownerSetupTokens ?? new OwnerSetupTokenStore({
    tokenFile: options.config.ownerSetupTokenFile ?? "/run/secrets/owner-setup-token",
    ttlSeconds: options.config.ownerSetupTokenTtlSeconds ?? 86_400,
    persistence
  });
  const invitationFlow = options.invitationFlow ?? {
    begin: (token: string) => prepareInvitationLogin(token, persistence.query),
    accept: (
      tokenHash: string,
      user: RequestUser,
      database = persistence.query
    ) => acceptInvitationByHashInTransaction(tokenHash, user, database)
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
    const onboardingReply = preventOnboardingCache(reply);
    if (options.config.authMode !== "native-oidc") return notFound(onboardingReply);
    try {
      const token = request.query.token?.trim();
      if (!token) {
        throw new NativeOidcError(
          "owner_setup_invalid",
          400,
          "Der Owner-Setup-Link ist ungültig."
        );
      }
      await ownerSetupTokens.begin(token);
      return onboardingReply.type("text/html; charset=utf-8").send(onboardingPage({
        flow: "owner_setup",
        token
      }));
    } catch (error) {
      const normalized = sanitizedError(error);
      return onboardingReply
        .code(normalized.statusCode)
        .type("text/html; charset=utf-8")
        .send(onboardingPage({ flow: "owner_setup", error: normalized }));
    }
  });

  app.get<{ Querystring: { token?: string } }>("/setup/continue", authRateLimit, async (request, reply) => {
    const onboardingReply = preventOnboardingCache(reply);
    if (options.config.authMode !== "native-oidc") return notFound(onboardingReply);
    try {
      const token = request.query.token?.trim();
      if (!token) {
        throw new NativeOidcError("owner_setup_invalid", 400, "Der Owner-Setup-Link ist ungültig.");
      }
      const tokenHash = await ownerSetupTokens.begin(token);
      const redirectUrl = await service.createLoginRedirect({ type: "owner_setup", tokenHash });
      return onboardingReply.redirect(redirectUrl.href);
    } catch (error) {
      const normalized = sanitizedError(error);
      return onboardingReply
        .code(normalized.statusCode)
        .type("text/html; charset=utf-8")
        .send(onboardingPage({ flow: "owner_setup", error: normalized }));
    }
  });

  app.get<{ Querystring: { token?: string } }>("/invite", authRateLimit, async (request, reply) => {
    const onboardingReply = preventOnboardingCache(reply);
    if (options.config.authMode !== "native-oidc") return notFound(onboardingReply);
    try {
      const token = request.query.token?.trim();
      if (!token) {
        throw new NativeOidcError("invalid_invitation", 400, "Die Einladung ist ungültig.");
      }
      await invitationFlow.begin(token);
      return onboardingReply.type("text/html; charset=utf-8").send(onboardingPage({
        flow: "invitation",
        token
      }));
    } catch (error) {
      const normalized = sanitizedError(error);
      return onboardingReply
        .code(normalized.statusCode)
        .type("text/html; charset=utf-8")
        .send(onboardingPage({ flow: "invitation", error: normalized }));
    }
  });

  app.get<{ Querystring: { token?: string } }>("/invite/continue", authRateLimit, async (request, reply) => {
    const onboardingReply = preventOnboardingCache(reply);
    if (options.config.authMode !== "native-oidc") return notFound(onboardingReply);
    try {
      const token = request.query.token?.trim();
      if (!token) {
        throw new NativeOidcError("invalid_invitation", 400, "Die Einladung ist ungültig.");
      }
      const tokenHash = await invitationFlow.begin(token);
      const redirectUrl = await service.createLoginRedirect({ type: "invitation", tokenHash });
      return onboardingReply.redirect(redirectUrl.href);
    } catch (error) {
      const normalized = sanitizedError(error);
      return onboardingReply
        .code(normalized.statusCode)
        .type("text/html; charset=utf-8")
        .send(onboardingPage({ flow: "invitation", error: normalized }));
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
      const user = auth.user;
      const loginContext = claims.loginContext;
      let membership: MembershipResolution;
      let session: { token: string; session: OidcSessionRecord } | undefined;
      let completionPath = "/";
      if (loginContext.type === "normal") {
        membership = await resolveMembership(user);
        if (!membership.workspaceAccess) {
          throw new NativeOidcError(
            "authorization_required",
            403,
            "Für diese Installation besteht keine aktive Mitgliedschaft."
          );
        }
        await upsertUser(user);
        membership = await resolveMembership(user);
      } else {
        const completed = await persistence.transaction(async (database) => {
          if (loginContext.type === "owner_setup") {
            await ownerSetupTokens.consumeAndClaim(
              loginContext.tokenHash,
              user,
              undefined,
              database
            );
          } else {
            await invitationFlow.accept(loginContext.tokenHash, user, database);
          }
          const resolvedMembership = await resolveMembership(user, database);
          if (!resolvedMembership.workspaceAccess) {
            throw new NativeOidcError(
              "authorization_required",
              403,
              "Für diese Installation besteht keine aktive Mitgliedschaft."
            );
          }
          const createdSession = await sessions.create(
            resolvedMembership.user.externalSubject,
            options.config.sessionTtlSeconds,
            undefined,
            database
          );
          return { membership: resolvedMembership, session: createdSession };
        });
        membership = completed.membership;
        session = completed.session;
        completionPath = loginContext.type === "owner_setup"
          ? "/?onboarding=owner-setup"
          : "/?onboarding=invitation";
      }
      if (!membership.workspaceAccess) {
        throw new NativeOidcError(
          "authorization_required",
          403,
          "Für diese Installation besteht keine aktive Mitgliedschaft."
        );
      }
      session ??= await sessions.create(
        membership.user.externalSubject,
        options.config.sessionTtlSeconds
      );
      return reply
        .header("set-cookie", serializeSessionCookie({
          name: options.config.sessionCookieName,
          value: session.token,
          maxAgeSeconds: options.config.sessionTtlSeconds,
          secure: secureCookie
        }))
        .redirect(completionPath);
    } catch (error) {
      const normalized = sanitizedError(error);
      request.log.warn(
        { code: normalized.code, statusCode: normalized.statusCode, requestId: request.id },
        "native oidc callback rejected"
      );
      if (normalized.statusCode === 403) {
        await sessions.revokeByToken(
          cookieValue(request.headers.cookie, options.config.sessionCookieName)
        );
        return preventOnboardingCache(reply)
          .header("set-cookie", clearSessionCookie(options.config.sessionCookieName, secureCookie))
          .code(403)
          .type("text/html; charset=utf-8")
          .send(accessDeniedPage());
      }
      return reply.code(normalized.statusCode).send({
        error: normalized.code,
        message: normalized.message
      });
    }
  });

  app.get("/auth/logout", authRateLimit, async (request, reply) => {
    if (options.config.authMode !== "native-oidc") return notFound(reply);
    await sessions.revokeByToken(
      cookieValue(request.headers.cookie, options.config.sessionCookieName)
    );
    const redirectUrl = await providerLogoutUrl(request.log);
    return reply
      .header("set-cookie", clearSessionCookie(options.config.sessionCookieName, secureCookie))
      .redirect(redirectUrl ?? "/");
  });

  app.post("/auth/logout", authRateLimit, async (request, reply) => {
    if (options.config.authMode !== "native-oidc") return notFound(reply);
    await sessions.revokeByToken(
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
