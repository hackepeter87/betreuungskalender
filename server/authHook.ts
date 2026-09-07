import type { preHandlerAsyncHookHandler } from "fastify";
import {
  hasWorkspacePermission,
  workspacePermissionsForRole,
  type RequestUser,
  resolveRequestUser
} from "./auth.js";
import type { config as appConfig } from "./config.js";
import { cookieValue } from "./cookies.js";
import type { DatabaseExecutor } from "./db/runtime.js";
import { type OidcSessionRecord } from "./services/oidcSessions.js";
import { isTrustedProxyAddress } from "./trustedProxy.js";
import { findAuthenticatedUserBySubject, upsertAuthenticatedUser } from "./services/users.js";
import {
  applyLegacyPreOwnerMembershipRole,
  type MembershipResolutionPolicy,
  type MembershipResolution
} from "./services/memberships.js";
import { isPreAuthenticationApiRoute } from "./apiRoutePolicy.js";
import { canAdministerMembers } from "./services/memberManagement.js";

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
  database?: DatabaseExecutor;
  nativeSessions?: {
    findByToken(token: string | undefined): Awaitable<OidcSessionRecord | undefined>;
  };
  findUserByExternalSubject?: (externalSubject: string) => Awaitable<RequestUser | undefined>;
  findRecoveryUserByToken?: (token: string | undefined) => Awaitable<RequestUser | undefined>;
  upsertAuthenticatedUser?: (user: RequestUser) => Awaitable<void>;
  applyMembershipRole?: (
    user: RequestUser,
    policy?: MembershipResolutionPolicy
  ) => Awaitable<MembershipResolution>;
  canPerformOwnerOperation?: (user: RequestUser) => Awaitable<boolean>;
}

type Awaitable<T> = T | Promise<T>;

function httpError(code: string, statusCode: number, message: string): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(message), { code, statusCode });
}

function requiredWorkspacePermission(request: Parameters<preHandlerAsyncHookHandler>[0]) {
  const permission = request.routeOptions?.config?.permission;
  if (!permission) {
    throw httpError(
      "forbidden",
      403,
      "Für diese Aktion fehlt die erforderliche Berechtigung."
    );
  }
  return permission;
}

function assertWorkspacePermission(user: RequestUser, request: Parameters<preHandlerAsyncHookHandler>[0]): void {
  const permission = requiredWorkspacePermission(request);
  if (!hasWorkspacePermission(user, permission)) {
    throw httpError(
      "forbidden",
      403,
      "Für diese Aktion fehlt die erforderliche Berechtigung."
    );
  }
}

function requestPath(request: Parameters<preHandlerAsyncHookHandler>[0]): string {
  const registeredRoute = request.routeOptions?.url;
  if (registeredRoute) return registeredRoute;
  try {
    return new URL(request.url, "http://localhost").pathname;
  } catch {
    return request.url.split("?")[0] ?? request.url;
  }
}

function isProtectedApiRequest(request: Parameters<preHandlerAsyncHookHandler>[0]): boolean {
  const path = requestPath(request);
  return path.startsWith("/api/") && !isPreAuthenticationApiRoute(request.method, path);
}

export function createApiAuthHook(
  config: AuthConfig,
  rateLimitFirst?: preHandlerAsyncHookHandler,
  options: NativeAuthOptions = {}
): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    if (rateLimitFirst && request.routeOptions.config.rateLimit !== false) {
      await rateLimitFirst.call(reply.server, request, reply);
    }
    if (!isProtectedApiRequest(request)) return;
    const requiredDatabase = (): DatabaseExecutor => {
      if (!options.database) throw new Error("Authentication persistence is not configured.");
      return options.database;
    };
    const assertRequestPermission = async (user: RequestUser): Promise<void> => {
      assertWorkspacePermission(user, request);
      if (
        requiredWorkspacePermission(request) === "admin:destructive" &&
        !user.isOwner &&
        !(await (options.canPerformOwnerOperation ?? ((actor) =>
          canAdministerMembers(actor, requiredDatabase())))(user))
      ) {
        throw httpError(
          "forbidden",
          403,
          "Für diese Aktion fehlt die erforderliche Berechtigung."
        );
      }
    };
    const recoveryUser = config.recoveryAdminEnabled
      ? await options.findRecoveryUserByToken?.(
          cookieValue(request.headers.cookie, config.recoveryAdminSessionCookieName)
        )
      : undefined;
    if (recoveryUser) {
      const privilegedRecoveryUser: RequestUser = {
        ...recoveryUser,
        workspaceRole: "admin",
        workspaceAccess: true,
        workspacePermissions: workspacePermissionsForRole("admin", true),
        isOwner: true
      };
      await assertRequestPermission(privilegedRecoveryUser);
      request.user = privilegedRecoveryUser;
      request.userEmail = recoveryUser.id;
      return;
    }
    if (config.authMode === "native-oidc") {
      const sessions = options.nativeSessions;
      const session: OidcSessionRecord | undefined = await sessions?.findByToken(
        cookieValue(request.headers.cookie, config.sessionCookieName)
      );
      const user = session
        ? await (options.findUserByExternalSubject ?? ((externalSubject) =>
            findAuthenticatedUserBySubject(externalSubject, requiredDatabase())))(
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
      await assertRequestPermission(user);
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
    await (options.upsertAuthenticatedUser ?? ((user) =>
      upsertAuthenticatedUser(user, requiredDatabase())))(auth.user);
    const membership = options.applyMembershipRole
      ? await options.applyMembershipRole(auth.user, "legacy-pre-owner")
      : await applyLegacyPreOwnerMembershipRole(auth.user, requiredDatabase());
    if (auth.reason === "missing_role" && !membership.membershipRole) {
      throw httpError(
        "authorization_required",
        403,
        "Keine passende Berechtigung in den OIDC-Claims gefunden."
      );
    }
    const user = membership.user;
    await assertRequestPermission(user);
    request.user = user;
    request.userEmail = user.id;
  };
}
