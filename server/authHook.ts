import type { preHandlerAsyncHookHandler } from "fastify";
import {
  hasPermission,
  requiredPermissionForRequest,
  resolveRequestUser
} from "./auth.js";
import type { config as appConfig } from "./config.js";
import { upsertAuthenticatedUser } from "./services/users.js";

type AuthConfig = Pick<
  typeof appConfig,
  | "requireAuth"
  | "trustProxyAuth"
  | "oidcUserIdHeader"
  | "oidcEmailHeader"
  | "oidcDisplayNameHeader"
  | "oidcGroupsHeader"
  | "oidcAdminGroup"
  | "oidcParentGroup"
  | "oidcReadonlyGroup"
  | "oidcRequireRoleClaim"
>;

function httpError(code: string, statusCode: number, message: string): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(message), { code, statusCode });
}

export function createApiAuthHook(
  config: AuthConfig,
  rateLimitFirst?: preHandlerAsyncHookHandler
): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    if (rateLimitFirst) await rateLimitFirst.call(reply.server, request, reply);
    if (
      !request.url.startsWith("/api/") ||
      request.url === "/api/health" ||
      request.url === "/api/ready"
    ) return;
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
      requireRoleClaim: config.oidcRequireRoleClaim
    });
    if (!auth.authenticated || !auth.user) {
      const missingRole = auth.reason === "missing_role";
      throw httpError(
        missingRole ? "authorization_required" : "authentication_required",
        missingRole ? 403 : 401,
        missingRole
          ? "Keine passende Berechtigung in den OIDC-Claims gefunden."
          : "Authentifizierung erforderlich."
      );
    }
    const requiredPermission = requiredPermissionForRequest(request.method, request.url);
    if (!hasPermission(auth.user, requiredPermission)) {
      throw httpError(
        "forbidden",
        403,
        "Für diese Aktion fehlt die erforderliche Berechtigung."
      );
    }
    upsertAuthenticatedUser(auth.user);
    request.user = auth.user;
    request.userEmail = auth.user.id;
  };
}
