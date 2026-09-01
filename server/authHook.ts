import type { preHandlerAsyncHookHandler } from "fastify";
import {
  hasWorkspacePermission,
  workspacePermissionsForRole,
  type RequestUser,
  resolveRequestUser
} from "./auth.js";
import type { config as appConfig } from "./config.js";
import { cookieValue } from "./cookies.js";
import type { PersistenceExecutor } from "./db/runtime.js";
import type { OidcSessionRecord } from "./services/oidcSessions.js";
import { isTrustedProxyAddress } from "./trustedProxy.js";
import { findAuthenticatedUserBySubject, upsertAuthenticatedUser } from "./services/users.js";
import {
  applyLegacyPreOwnerMembershipRole,
  type MembershipResolutionPolicy,
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
  persistence?: PersistenceExecutor;
  nativeSessions?: {
    findByToken(token: string | undefined): Awaitable<OidcSessionRecord | undefined>;
  };
  findUserByExternalSubject?: (
    externalSubject: string
  ) => Awaitable<RequestUser | undefined>;
  findRecoveryUserByToken?: (
    token: string | undefined
  ) => Awaitable<RequestUser | undefined>;
  upsertAuthenticatedUser?: (user: RequestUser) => Awaitable<void>;
  applyMembershipRole?: (
    user: RequestUser,
    policy?: MembershipResolutionPolicy
  ) => Awaitable<MembershipResolution>;
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
  if (!hasWorkspacePermission(user, requiredWorkspacePermission(request))) {
    throw httpError(
      "forbidden",
      403,
      "Für diese Aktion fehlt die erforderliche Berechtigung."
    );
  }
}

export function createApiAuthHook(
  config: AuthConfig,
  rateLimitFirst?: preHandlerAsyncHookHandler,
  options?: NativeAuthOptions
): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    if (rateLimitFirst) await rateLimitFirst.call(reply.server, request, reply);
    if (
      !request.url.startsWith("/api/") ||
      request.url === "/api/health" ||
      request.url === "/api/ready" ||
      request.url === "/api/session" ||
      request.url === "/api/setup/first-use"
    ) return;
    const nativeAuth: Partial<NativeAuthOptions> = options ?? {};
    const requiredPersistence = (): PersistenceExecutor => {
      if (!nativeAuth.persistence) {
        throw new Error("Authentication persistence is not configured.");
      }
      return nativeAuth.persistence;
    };
    const recoveryUser = config.recoveryAdminEnabled
      ? await nativeAuth.findRecoveryUserByToken?.(
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
      assertWorkspacePermission(privilegedRecoveryUser, request);
      request.user = privilegedRecoveryUser;
      request.userEmail = recoveryUser.id;
      return;
    }
    if (config.authMode === "native-oidc") {
      const sessions = nativeAuth.nativeSessions;
      const session: OidcSessionRecord | undefined = await sessions?.findByToken(
        cookieValue(request.headers.cookie, config.sessionCookieName)
      );
      const user = session
        ? await (nativeAuth.findUserByExternalSubject ?? ((externalSubject) =>
            findAuthenticatedUserBySubject(externalSubject, requiredPersistence())))(
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
      assertWorkspacePermission(user, request);
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
    await (nativeAuth.upsertAuthenticatedUser ?? ((user) =>
      upsertAuthenticatedUser(user, requiredPersistence())))(auth.user);
    const membership = nativeAuth.applyMembershipRole
      ? await nativeAuth.applyMembershipRole(auth.user, "legacy-pre-owner")
      : await applyLegacyPreOwnerMembershipRole(auth.user, requiredPersistence());
    if (auth.reason === "missing_role" && !membership.membershipRole) {
      throw httpError(
        "authorization_required",
        403,
        "Keine passende Berechtigung in den OIDC-Claims gefunden."
      );
    }
    const user = membership.user;
    assertWorkspacePermission(user, request);
    request.user = user;
    request.userEmail = user.id;
  };
}
