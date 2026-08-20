import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyRequest } from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { resolveRequestUser, sessionInfo, workspacePermissionsForRole, type RequestUser } from "./auth.js";
import { createApiAuthHook } from "./authHook.js";
import { config } from "./config.js";
import { cookieValue } from "./cookies.js";
import { db } from "./db/connection.js";
import { runMigrations } from "./db/migrate.js";
import { sanitizeRequestUrl } from "./logging.js";
import { isTrustedProxyAddress } from "./trustedProxy.js";
import { auditRoutes } from "./routes/audit.js";
import { appDataRoutes } from "./routes/appData.js";
import { careConfirmationRoutes } from "./routes/careConfirmations.js";
import { appUserRoutes } from "./routes/appUsers.js";
import { careEntryRoutes } from "./routes/careEntries.js";
import { carePartyRoutes } from "./routes/careParties.js";
import { childrenRoutes } from "./routes/children.js";
import { contactPatternRoutes } from "./routes/contactPatterns.js";
import { contactRuleRoutes } from "./routes/contactRules.js";
import { demoDataRoutes } from "./routes/demoData.js";
import { holidayRoutes } from "./routes/holidays.js";
import { instanceReadinessRoutes } from "./routes/instanceReadiness.js";
import { invitationRoutes } from "./routes/invitations.js";
import { setupRoutes } from "./routes/setup.js";
import { monthClosingRoutes } from "./routes/monthClosings.js";
import { migrationRoutes } from "./routes/migration.js";
import { nativeOidcRoutes } from "./routes/nativeOidc.js";
import { recoveryAdminRoutes } from "./routes/recoveryAdmin.js";
import { installRateLimitPolicy } from "./rateLimitPolicy.js";
import { settingsRoutes } from "./routes/settings.js";
import { unavailablePeriodRoutes } from "./routes/unavailablePeriods.js";
import { externalCalendarRoutes } from "./routes/externalCalendars.js";
import { calendarFeedRoutes } from "./routes/calendarFeeds.js";
import { OidcSessionStore } from "./services/oidcSessions.js";
import { RecoveryAdminStore } from "./services/recoveryAdmin.js";
import { applyLegacyPreOwnerMembershipRole } from "./services/memberships.js";
import { publicSetupState } from "./services/setupState.js";
import { findAuthenticatedUserBySubject, upsertAuthenticatedUser } from "./services/users.js";
import { runCareConfirmationSweep } from "./services/careConfirmations.js";

runMigrations();

const nativeOidcSessions = new OidcSessionStore();
const recoveryAdmin = new RecoveryAdminStore({
  enabled: config.recoveryAdminEnabled,
  username: config.recoveryAdminUsername,
  initialPasswordFile: config.recoveryAdminInitialPasswordFile,
  initialPassword: config.recoveryAdminInitialPassword,
  sessionTtlSeconds: config.recoveryAdminSessionTtlSeconds
});
recoveryAdmin.ensureConfigured();

const app = Fastify({
  logger: {
    level: config.logLevel,
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: sanitizeRequestUrl(request.url),
          hostname: request.hostname,
          remoteAddress: request.ip
        };
      }
    },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-auth-request-email",
        "req.headers.x-forwarded-email",
        "req.headers.x-auth-request-user",
        "req.headers.x-forwarded-user"
      ],
      censor: "[redacted]"
    }
  },
  trustProxy: config.trustProxyAuth && config.trustedProxyRules.length > 0
    ? (address) => isTrustedProxyAddress(address, config.trustedProxyRules)
    : config.trustProxyAuth
});

function workspaceSession(user: RequestUser) {
  return {
    workspaceAccess: user.workspaceAccess ?? true,
    ...(user.workspaceRole ? { workspaceRole: user.workspaceRole } : {}),
    isOwner: Boolean(user.isOwner),
    permissions: user.workspacePermissions ?? []
  };
}

await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", "data:", "blob:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      workerSrc: ["'self'", "blob:"]
    }
  },
  crossOriginEmbedderPolicy: false,
  frameguard: { action: "deny" },
  referrerPolicy: { policy: "no-referrer" }
});

await app.register(cors, {
  origin(origin, callback) {
    if (!origin || origin === config.allowedOrigin) {
      callback(null, true);
      return;
    }
    callback(new Error("origin_not_allowed"), false);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "content-type",
    "x-auth-request-email",
    "x-forwarded-email",
    "x-auth-request-user",
    "x-forwarded-user",
    "x-auth-request-preferred-username",
    "x-forwarded-preferred-username",
    "x-auth-request-groups",
    "x-forwarded-groups"
  ]
});

installRateLimitPolicy(app, {
  defaultMax: config.rateLimitMax,
  writeMax: config.rateLimitWriteMax,
  sensitiveMax: config.rateLimitSensitiveMax,
  exportMax: config.rateLimitExportMax,
  timeWindowMs: config.rateLimitWindowMs
});

await app.register(rateLimit, {
  global: true,
  max: config.rateLimitMax,
  timeWindow: config.rateLimitWindowMs,
  errorResponseBuilder: (_request, context) => Object.assign(
    new Error("Zu viele Anfragen. Bitte später erneut versuchen."),
    { code: "rate_limit_exceeded", statusCode: context.statusCode }
  )
});

app.decorateRequest("userEmail", "local-dev");
app.decorateRequest("user", undefined);

const apiAuthHook = createApiAuthHook(config, app.rateLimit(), {
  nativeSessions: nativeOidcSessions,
  findRecoveryUserByToken: (token) => recoveryAdmin.findUserByToken(token)
});
// codeql[js/missing-rate-limiting]: createApiAuthHook receives app.rateLimit() and runs that Fastify rate-limit preHandler before authorization.
app.addHook("preHandler", apiAuthHook);

app.setErrorHandler((error, request, reply) => {
  const normalized = error as Error & { code?: string; statusCode?: number };
  const originDenied = normalized.message === "origin_not_allowed";
  const statusCode = originDenied ? 403 : normalized.statusCode ?? 500;
  if (config.nodeEnv === "development") {
    request.log.error(normalized);
  } else if (statusCode < 500) {
    request.log.warn(
      {
        code: normalized.code ?? (originDenied ? "origin_not_allowed" : "request_error"),
        statusCode,
        requestId: request.id
      },
      "request rejected"
    );
  } else {
    request.log.error(
      {
        code: normalized.code ?? "unknown",
        statusCode,
        requestId: request.id
      },
      "request failed"
    );
  }
  const code = normalized.code ?? "";
  if (code === "rate_limit_exceeded") {
    return reply.code(429).send({
      error: "rate_limit_exceeded",
      message: "Zu viele Anfragen. Bitte später erneut versuchen."
    });
  }
  if (code.startsWith("SQLITE_CONSTRAINT")) {
    return reply.code(400).send({
      error: "constraint_violation",
      message: "Die Eingabe verletzt eine Datenbankregel."
    });
  }
  if (originDenied) {
    return reply.code(403).send({
      error: "origin_not_allowed",
      message: "Diese Herkunft ist nicht zugelassen."
    });
  }
  if (["authentication_required", "authorization_required", "forbidden"].includes(code)) {
    return reply.code(statusCode).send({
      error: code,
      message: normalized.message
    });
  }
  return reply.code(statusCode).send({
    error: statusCode < 500 ? "request_error" : "internal_error",
    message: statusCode < 500 ? normalized.message : "Interner Serverfehler."
  });
});

function databaseReachable(): boolean {
  try {
    const result = db.prepare("SELECT 1 AS ok").get() as { ok: number };
    return result.ok === 1;
  } catch {
    return false;
  }
}

const readLimit = {
  config: { rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};

function requestPath(request: FastifyRequest): string {
  try {
    return new URL(request.url, "http://localhost").pathname;
  } catch {
    return request.url.split("?")[0] ?? request.url;
  }
}

function isSpaFallbackRequest(request: FastifyRequest): boolean {
  const path = requestPath(request);
  return (
    request.method === "GET" &&
    !path.startsWith("/api/") &&
    !path.startsWith("/auth/") &&
    !path.includes(".")
  );
}

function hasNativeOidcBrowserSession(request: FastifyRequest): boolean {
  const recoveryUser = recoveryAdmin.findUserByToken(
    cookieValue(request.headers.cookie, config.recoveryAdminSessionCookieName)
  );
  if (recoveryUser) return true;
  const nativeSession = nativeOidcSessions.findByToken(
    cookieValue(request.headers.cookie, config.sessionCookieName)
  );
  const user = nativeSession
    ? findAuthenticatedUserBySubject(nativeSession.externalSubject)
    : undefined;
  return Boolean(user?.workspaceAccess);
}

function requiresNativeOidcBrowserLogin(request: FastifyRequest): boolean {
  return (
    config.authMode === "native-oidc" &&
    config.requireAuth &&
    isSpaFallbackRequest(request) &&
    !hasNativeOidcBrowserSession(request)
  );
}

app.get("/api/health", readLimit, async (_request, reply) => {
  const reachable = databaseReachable();
  return reply.code(reachable ? 200 : 503).send({
    status: reachable ? "ok" : "error",
    version: config.version,
    databaseReachable: reachable,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/ready", readLimit, async (_request, reply) => {
  const reachable = databaseReachable();
  const migrationCount = reachable
    ? (db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as {
        count: number;
      }).count
    : 0;
  return reply.code(reachable && migrationCount > 0 ? 200 : 503).send({
    status: reachable && migrationCount > 0 ? "ready" : "not_ready",
    databaseReachable: reachable,
    migrationsApplied: migrationCount > 0,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/session", readLimit, async (request) => {
  const setup = publicSetupState();
  const recoveryUser = recoveryAdmin.findUserByToken(
    cookieValue(request.headers.cookie, config.recoveryAdminSessionCookieName)
  );
  if (recoveryUser) {
    const privilegedRecoveryUser: RequestUser = {
      ...recoveryUser,
      workspaceRole: "admin",
      workspaceAccess: true,
      workspacePermissions: workspacePermissionsForRole("admin", true),
      isOwner: true
    };
    return {
      authRequired: config.requireAuth,
      authenticated: true,
      setup,
      ...workspaceSession(privilegedRecoveryUser),
      user: {
        id: recoveryUser.id,
        displayName: recoveryUser.displayName,
        role: recoveryUser.role,
        ...(recoveryUser.email ? { email: recoveryUser.email } : {})
      },
      logoutUrl: "/auth/recovery/logout",
      ...(config.demoDatasetsEnabled ? { demoDatasetsEnabled: true } : {})
    };
  }
  if (config.authMode === "native-oidc") {
    const nativeSession = nativeOidcSessions.findByToken(
      cookieValue(request.headers.cookie, config.sessionCookieName)
    );
    const resolvedNativeUser = nativeSession
      ? findAuthenticatedUserBySubject(nativeSession.externalSubject)
      : undefined;
    const nativeUser = resolvedNativeUser?.workspaceAccess
      ? resolvedNativeUser
      : undefined;
    return {
      authRequired: config.requireAuth,
      authenticated: Boolean(nativeSession && nativeUser),
      setup,
      ...(nativeUser
        ? {
            ...workspaceSession(nativeUser),
            user: {
              id: nativeUser.id,
              displayName: nativeUser.displayName,
              role: nativeUser.role,
              ...(nativeUser.email ? { email: nativeUser.email } : {})
            },
            logoutUrl: "/auth/logout",
            ...(config.demoDatasetsEnabled ? { demoDatasetsEnabled: true } : {})
          }
        : {
            loginUrl: "/auth/login",
            ...(config.demoDatasetsEnabled ? { demoDatasetsEnabled: true } : {})
          })
    };
  }
  if (
    config.trustProxyAuth &&
    !isTrustedProxyAddress(request.raw.socket.remoteAddress, config.trustedProxyRules)
  ) {
    return {
      authRequired: config.requireAuth,
      authenticated: false,
      setup,
      ...(config.demoDatasetsEnabled ? { demoDatasetsEnabled: true } : {})
    };
  }
  if (config.trustProxyAuth) {
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
    if (auth.authenticated && auth.user) {
      upsertAuthenticatedUser(auth.user);
      const membership = applyLegacyPreOwnerMembershipRole(auth.user);
      if (auth.reason !== "missing_role" || membership.membershipRole) {
        return {
          authRequired: config.requireAuth,
          authenticated: true,
          setup,
          ...workspaceSession(membership.user),
          user: {
            id: membership.user.id,
            displayName: membership.user.displayName,
            role: membership.user.role,
            ...(membership.user.email ? { email: membership.user.email } : {})
          },
          ...(config.authLogoutUrl ? { logoutUrl: config.authLogoutUrl } : {}),
          ...(config.demoDatasetsEnabled ? { demoDatasetsEnabled: true } : {})
        };
      }
    }
  }
  return {
    ...sessionInfo(request.headers, config),
    setup,
    ...(config.demoDatasetsEnabled ? { demoDatasetsEnabled: true } : {})
  };
});

await app.register(recoveryAdminRoutes, { config, store: recoveryAdmin });
await app.register(nativeOidcRoutes, { config, sessions: nativeOidcSessions });
await app.register(childrenRoutes);
await app.register(carePartyRoutes);
await app.register(careEntryRoutes);
await app.register(careConfirmationRoutes);
await app.register(holidayRoutes);
await app.register(contactPatternRoutes);
await app.register(contactRuleRoutes);
await app.register(settingsRoutes);
await app.register(instanceReadinessRoutes);
await app.register(invitationRoutes);
await app.register(setupRoutes, { nativeSessions: nativeOidcSessions });
await app.register(unavailablePeriodRoutes);
await app.register(externalCalendarRoutes);
await app.register(calendarFeedRoutes);
await app.register(monthClosingRoutes);
await app.register(migrationRoutes);
await app.register(auditRoutes);
await app.register(appUserRoutes);
await app.register(appDataRoutes);
await app.register(demoDataRoutes);

const confirmationSweep = setInterval(() => {
  void runCareConfirmationSweep().catch((error) => {
    app.log.warn({ error }, "care confirmation sweep failed");
  });
}, 15 * 60 * 1000);
confirmationSweep.unref();
void runCareConfirmationSweep().catch((error) => {
  app.log.warn({ error }, "initial care confirmation sweep failed");
});

const frontendRoot = resolve(process.cwd(), "dist");
if (existsSync(frontendRoot)) {
  app.addHook("preHandler", async (request, reply) => {
    if (requiresNativeOidcBrowserLogin(request)) {
      return reply.redirect("/auth/login");
    }
  });

  await app.register(fastifyStatic, {
    root: frontendRoot,
    prefix: "/"
  });

  app.setNotFoundHandler((request, reply) => {
    if (isSpaFallbackRequest(request)) {
      if (requiresNativeOidcBrowserLogin(request)) {
        return reply.redirect("/auth/login");
      }
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({
      error: "not_found",
      message: "Ressource nicht gefunden."
    });
  });
}

const shutdown = async () => {
  await app.close();
  db.close();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
