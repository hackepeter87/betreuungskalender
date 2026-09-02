import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { config as appConfig } from "../config.js";
import {
  clearSessionCookie,
  cookieValue,
  serializeSessionCookie
} from "../cookies.js";
import {
  RecoveryAdminError,
  RecoveryAdminStore
} from "../services/recoveryAdmin.js";
import { publicLegalLinksHtml } from "./legal.js";

type RecoveryRouteConfig = Pick<
  typeof appConfig,
  | "nodeEnv"
  | "recoveryAdminEnabled"
  | "recoveryAdminUsername"
  | "recoveryAdminInitialPasswordFile"
  | "recoveryAdminInitialPassword"
  | "recoveryAdminSessionCookieName"
  | "recoveryAdminSessionTtlSeconds"
  | "rateLimitSensitiveMax"
  | "rateLimitWindowMs"
>;

interface RecoveryAdminRoutesOptions {
  config: RecoveryRouteConfig;
  store?: RecoveryAdminStore;
}

interface RecoveryCredentialsBody {
  username?: string;
  password?: string;
  newPassword?: string;
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: "not_found",
    message: "Ressource nicht gefunden."
  });
}

function wantsHtml(request: FastifyRequest): boolean {
  const accept = request.headers.accept ?? "";
  const contentType = request.headers["content-type"] ?? "";
  return accept.includes("text/html") || String(contentType).includes("application/x-www-form-urlencoded");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loginPage(username: string, message = ""): string {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Recovery admin</title>
</head>
<body>
  <main>
    <h1>Recovery admin</h1>
    <p>Notfallzugang fuer Betreiber. Nicht fuer den normalen Login verwenden.</p>
    ${message ? `<p role="alert">${escapeHtml(message)}</p>` : ""}
    <form method="post" action="/auth/recovery/login">
      <label>Benutzername <input name="username" autocomplete="username" value="${escapeHtml(username)}" required></label>
      <label>Passwort <input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit">Anmelden</button>
    </form>
    ${publicLegalLinksHtml()}
  </main>
</body>
</html>`;
}

function changePasswordPage(message = ""): string {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Recovery admin password</title>
</head>
<body>
  <main>
    <h1>Recovery-Passwort setzen</h1>
    <p>Nach dem ersten Login muss ein neues Passwort gesetzt werden. Das Bootstrap-Secret wird danach ignoriert.</p>
    ${message ? `<p role="alert">${escapeHtml(message)}</p>` : ""}
    <form method="post" action="/auth/recovery/change-password">
      <label>Neues Passwort <input name="newPassword" type="password" autocomplete="new-password" minlength="12" required></label>
      <button type="submit">Passwort speichern</button>
    </form>
    ${publicLegalLinksHtml()}
  </main>
</body>
</html>`;
}

function credentials(body: unknown): RecoveryCredentialsBody {
  if (!body || typeof body !== "object") return {};
  const record = body as Record<string, unknown>;
  return {
    username: typeof record.username === "string" ? record.username : undefined,
    password: typeof record.password === "string" ? record.password : undefined,
    newPassword: typeof record.newPassword === "string" ? record.newPassword : undefined
  };
}

function normalizedError(error: unknown): RecoveryAdminError {
  if (error instanceof RecoveryAdminError) return error;
  return new RecoveryAdminError(
    "recovery_request_failed",
    500,
    "Recovery-Anfrage fehlgeschlagen."
  );
}

export async function recoveryAdminRoutes(
  app: FastifyInstance,
  options: RecoveryAdminRoutesOptions
): Promise<void> {
  const secureCookie = options.config.nodeEnv === "production";
  const store = options.store ?? new RecoveryAdminStore({
    enabled: options.config.recoveryAdminEnabled,
    username: options.config.recoveryAdminUsername,
    initialPasswordFile: options.config.recoveryAdminInitialPasswordFile,
    initialPassword: options.config.recoveryAdminInitialPassword,
    sessionTtlSeconds: options.config.recoveryAdminSessionTtlSeconds
  }, app.persistence);
  const authRateLimit = {
    config: {
      rateLimit: {
        max: options.config.rateLimitSensitiveMax,
        timeWindow: options.config.rateLimitWindowMs
      }
    }
  };

  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, payload, done) => {
      const params = new URLSearchParams(String(payload));
      done(null, Object.fromEntries(params));
    }
  );

  app.get("/auth/recovery", authRateLimit, async (_request, reply) => {
    if (!options.config.recoveryAdminEnabled) return notFound(reply);
    return reply.type("text/html").send(loginPage(options.config.recoveryAdminUsername));
  });

  app.post("/auth/recovery/login", authRateLimit, async (request, reply) => {
    if (!options.config.recoveryAdminEnabled) return notFound(reply);
    try {
      const body = credentials(request.body);
      const login = await store.login(body.username ?? "", body.password ?? "");
      const cookie = serializeSessionCookie({
        name: options.config.recoveryAdminSessionCookieName,
        value: login.token,
        maxAgeSeconds: options.config.recoveryAdminSessionTtlSeconds,
        secure: secureCookie
      });
      if (wantsHtml(request)) {
        return reply
          .header("set-cookie", cookie)
          .redirect(login.session.passwordChangeRequired ? "/auth/recovery/change-password" : "/");
      }
      return reply.header("set-cookie", cookie).send({
        authenticated: !login.session.passwordChangeRequired,
        passwordChangeRequired: login.session.passwordChangeRequired,
        ...(login.session.passwordChangeRequired
          ? { changePasswordUrl: "/auth/recovery/change-password" }
          : login.user
            ? {
                user: {
                  id: login.user.id,
                  displayName: login.user.displayName,
                  role: login.user.role
                }
              }
            : {})
      });
    } catch (error) {
      const normalized = normalizedError(error);
      request.log.warn(
        { code: normalized.code, statusCode: normalized.statusCode, requestId: request.id },
        "recovery admin login rejected"
      );
      if (wantsHtml(request)) {
        return reply
          .code(normalized.statusCode)
          .type("text/html")
          .send(loginPage(options.config.recoveryAdminUsername, normalized.message));
      }
      return reply.code(normalized.statusCode).send({
        error: normalized.code,
        message: normalized.message
      });
    }
  });

  app.get("/auth/recovery/change-password", authRateLimit, async (request, reply) => {
    if (!options.config.recoveryAdminEnabled) return notFound(reply);
    const session = await store.findSessionByToken(
      cookieValue(request.headers.cookie, options.config.recoveryAdminSessionCookieName)
    );
    if (!session) return reply.redirect("/auth/recovery");
    return reply.type("text/html").send(changePasswordPage());
  });

  app.post("/auth/recovery/change-password", authRateLimit, async (request, reply) => {
    if (!options.config.recoveryAdminEnabled) return notFound(reply);
    try {
      const body = credentials(request.body);
      const changed = await store.changePassword(
        cookieValue(request.headers.cookie, options.config.recoveryAdminSessionCookieName),
        body.newPassword ?? ""
      );
      if (wantsHtml(request)) return reply.redirect("/");
      return reply.send({
        authenticated: true,
        passwordChangeRequired: false,
        user: {
          id: changed.user.id,
          displayName: changed.user.displayName,
          role: changed.user.role
        }
      });
    } catch (error) {
      const normalized = normalizedError(error);
      request.log.warn(
        { code: normalized.code, statusCode: normalized.statusCode, requestId: request.id },
        "recovery admin password change rejected"
      );
      if (wantsHtml(request)) {
        return reply
          .code(normalized.statusCode)
          .type("text/html")
          .send(changePasswordPage(normalized.message));
      }
      return reply.code(normalized.statusCode).send({
        error: normalized.code,
        message: normalized.message
      });
    }
  });

  app.get("/auth/recovery/logout", authRateLimit, async (request, reply) => {
    if (!options.config.recoveryAdminEnabled) return notFound(reply);
    await store.revokeByToken(
      cookieValue(request.headers.cookie, options.config.recoveryAdminSessionCookieName)
    );
    return reply
      .header("set-cookie", clearSessionCookie(options.config.recoveryAdminSessionCookieName, secureCookie))
      .redirect("/");
  });

  app.post("/auth/recovery/logout", authRateLimit, async (request, reply) => {
    if (!options.config.recoveryAdminEnabled) return notFound(reply);
    await store.revokeByToken(
      cookieValue(request.headers.cookie, options.config.recoveryAdminSessionCookieName)
    );
    return reply
      .header("set-cookie", clearSessionCookie(options.config.recoveryAdminSessionCookieName, secureCookie))
      .send({
        authenticated: false,
        loggedOut: true
      });
  });
}
