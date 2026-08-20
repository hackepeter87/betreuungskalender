import type { RequestUser } from "../auth.js";

interface ResolvedIdentity {
  authenticated: boolean;
  reason?: string;
  user?: RequestUser;
}

export function isNativeOwnerSetupUser(
  user: RequestUser | undefined
): user is RequestUser {
  return Boolean(user?.workspaceAccess && user.isOwner);
}

export function isTrustedProxySetupAdmin(
  identity: ResolvedIdentity
): identity is ResolvedIdentity & { user: RequestUser } {
  return Boolean(
    identity.authenticated &&
    identity.user?.role === "admin" &&
    identity.reason !== "missing_role"
  );
}
