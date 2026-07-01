import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { sessionInfo } from "./auth.js";
import { createApiAuthHook } from "./authHook.js";
import { config } from "./config.js";
import { cookieValue } from "./cookies.js";
import { db } from "./db/connection.js";
import { runMigrations } from "./db/migrate.js";
import { sanitizeRequestUrl } from "./logging.js";
import { auditRoutes } from "./routes/audit.js";
import { appDataRoutes } from "./routes/appData.js";
import { careEntryRoutes } from "./routes/careEntries.js";
import { childrenRoutes } from "./routes/children.js";
import { contactPatternRoutes } from "./routes/contactPatterns.js";
import { holidayRoutes } from "./routes/holidays.js";
import { monthClosingRoutes } from "./routes/monthClosings.js";
import { migrationRoutes } from "./routes/migration.js";
import { nativeOidcRoutes } from "./routes/nativeOidc.js";
import { installRateLimitPolicy } from "./rateLimitPolicy.js";
import { settingsRoutes } from "./routes/settings.js";
import { unavailablePeriodRoutes } from "./routes/unavailablePeriods.js";
import { externalCalendarRoutes } from "./routes/externalCalendars.js";
import { calendarFeedRoutes } from "./routes/calendarFeeds.js";
import { OidcSessionStore } from "./services/oidcSessions.js";
import { findAuthenticatedUserBySubject } from "./services/users.js";

runMigrations();

const nativeOidcSessions = new OidcSessionStore();

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
  trustProxy: config.trustProxyAuth
});

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
  nativeSessions: nativeOidcSessions
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
  if (config.authMode === "native-oidc") {
    const nativeSession = nativeOidcSessions.findByToken(
      cookieValue(request.headers.cookie, config.sessionCookieName)
    );
    const nativeUser = nativeSession
      ? findAuthenticatedUserBySubject(nativeSession.externalSubject)
      : undefined;
    return {
      authRequired: config.requireAuth,
      authenticated: Boolean(nativeSession && nativeUser),
      ...(nativeUser
        ? {
            user: {
              id: nativeUser.id,
              displayName: nativeUser.displayName,
              role: nativeUser.role,
              ...(nativeUser.email ? { email: nativeUser.email } : {})
            },
            logoutUrl: "/auth/logout"
          }
        : { loginUrl: "/auth/login" })
    };
  }
  return sessionInfo(request.headers, config);
});

await app.register(nativeOidcRoutes, { config, sessions: nativeOidcSessions });
await app.register(childrenRoutes);
await app.register(careEntryRoutes);
await app.register(holidayRoutes);
await app.register(contactPatternRoutes);
await app.register(settingsRoutes);
await app.register(unavailablePeriodRoutes);
await app.register(externalCalendarRoutes);
await app.register(calendarFeedRoutes);
await app.register(monthClosingRoutes);
await app.register(migrationRoutes);
await app.register(auditRoutes);
await app.register(appDataRoutes);

const frontendRoot = resolve(process.cwd(), "dist");
if (existsSync(frontendRoot)) {
  await app.register(fastifyStatic, {
    root: frontendRoot,
    prefix: "/"
  });

  app.setNotFoundHandler((request, reply) => {
    if (
      request.method === "GET" &&
      !request.url.startsWith("/api/") &&
      !request.url.includes(".")
    ) {
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
