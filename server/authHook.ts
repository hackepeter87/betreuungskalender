import type { preHandlerAsyncHookHandler } from "fastify";
import {
  hasPermission,
  type RequestUser,
  requiredPermissionForRequest,
  resolveRequestUser
} from "./auth.js";
import type { config as appConfig } from "./config.js";
import { cookieValue } from "./cookies.js";
import { type OidcSessionRecord, type OidcSessionStore } from "./services/oidcSessions.js";
import { isTrustedProxyAddress } from "./trustedProxy.js";
import { findAuthenticatedUserBySubject, upsertAuthenticatedUser } from "./services/users.js";
import {
  applyMembershipRole,
  type MembershipResolution
} from "./services/memberships.js";

type AuthConfig = Pick<
  typeof appConfig,
  | "authMode"
  | "requireAuth"
  | "trustProxyAuth"
  | "trustedProxyRules"
  | "oidcUserIdHeader"
  | "oidcEmailHeader"
  | "oidcDisplayNameHeader"
  | "oidcGroupsHeader"
  | "oidcAdminGroup"
  | "oidcParentGroup"
  | "oidcReadonlyGroup"
  | "oidcRequireRoleClaim"
  | "sessionCookieName"
  | "recoveryAdminEnabled"
  | "recoveryAdminSessionCookieName"
>;

interface NativeAuthOptions {
  nativeSessions?: Pick<OidcSessionStore, "findByToken">;
  findUserByExternalSubject?: (externalSubject: string) => RequestUser | undefined;
  findRecoveryUserByToken?: (token: string | undefined) => RequestUser | undefined;
  upsertAuthenticatedUser?: (user: RequestUser) => void;
  applyMembershipRole?: (user: RequestUser) => MembershipResolution;
}

function httpError(code: string, statusCode: number, message: string): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(message), { code, statusCode });
}

export function createApiAuthHook(
  config: AuthConfig,
  rateLimitFirst?: preHandlerAsyncHookHandler,
  options: NativeAuthOptions = {}
): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    if (rateLimitFirst) await rateLimitFirst.call(reply.server, request, reply);
    if (
      !request.url.startsWith("/api/") ||
      request.url === "/api/health" ||
      request.url === "/api/ready" ||
      request.url === "/api/session"
    ) return;
    const recoveryUser = config.recoveryAdminEnabled
      ? options.findRecoveryUserByToken?.(
          cookieValue(request.headers.cookie, config.recoveryAdminSessionCookieName)
        )
      : undefined;
    if (recoveryUser) {
      const requiredPermission = requiredPermissionForRequest(request.method, request.url);
      if (!hasPermission(recoveryUser, requiredPermission)) {
        throw httpError(
          "forbidden",
          403,
          "Für diese Aktion fehlt die erforderliche Berechtigung."
        );
      }
      request.user = recoveryUser;
      request.userEmail = recoveryUser.id;
      return;
    }
    if (config.authMode === "native-oidc") {
      const sessions = options.nativeSessions;
      const session: OidcSessionRecord | undefined = sessions?.findByToken(
        cookieValue(request.headers.cookie, config.sessionCookieName)
      );
      const user = session
        ? (options.findUserByExternalSubject ?? findAuthenticatedUserBySubject)(
            session.externalSubject
          )
        : undefined;
      if (!session || !user) {
        throw httpError(
          "authentication_required",
          401,
          "Authentifizierung erforderlich."
        );
      }
      const requiredPermission = requiredPermissionForRequest(request.method, request.url);
      if (!hasPermission(user, requiredPermission)) {
        throw httpError(
          "forbidden",
          403,
          "Für diese Aktion fehlt die erforderliche Berechtigung."
        );
      }
      request.user = user;
      request.userEmail = user.id;
      return;
    }
    if (
      config.trustProxyAuth &&
      !isTrustedProxyAddress(request.raw.socket.remoteAddress, config.trustedProxyRules)
    ) {
      throw httpError(
        "untrusted_proxy",
        403,
        "Die Proxy-Authentifizierung ist von dieser Netzwerkadresse nicht zugelassen."
      );
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
    (options.upsertAuthenticatedUser ?? upsertAuthenticatedUser)(auth.user);
    const membership = (options.applyMembershipRole ?? applyMembershipRole)(auth.user);
    if (auth.reason === "missing_role" && !membership.membershipRole) {
      throw httpError(
        "authorization_required",
        403,
        "Keine passende Berechtigung in den OIDC-Claims gefunden."
      );
    }
    const user = membership.user;
    const requiredPermission = requiredPermissionForRequest(request.method, request.url);
    if (!hasPermission(user, requiredPermission)) {
      throw httpError(
        "forbidden",
        403,
        "Für diese Aktion fehlt die erforderliche Berechtigung."
      );
    }
    request.user = user;
    request.userEmail = user.id;
  };
}
