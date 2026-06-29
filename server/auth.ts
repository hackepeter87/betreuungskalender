export const proxyIdentityHeaders = [
  "x-auth-request-email",
  "x-forwarded-email",
  "x-auth-request-user",
  "x-forwarded-user"
] as const;

export interface SessionInfo {
  authRequired: boolean;
  authenticated: boolean;
  user?: {
    displayName: string;
  };
  logoutUrl?: string;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function requestIdentity(
  headers: Record<string, string | string[] | undefined>
): string | undefined {
  return proxyIdentityHeaders
    .map((name) => firstHeader(headers[name])?.trim())
    .find(Boolean);
}

export function resolveRequestIdentity(
  headers: Record<string, string | string[] | undefined>,
  options: { requireAuth: boolean; trustProxyAuth: boolean }
): { authenticated: boolean; identity: string } {
  const identity = options.trustProxyAuth
    ? requestIdentity(headers)
    : undefined;

  if (options.requireAuth && !identity) {
    return { authenticated: false, identity: "" };
  }

  return {
    authenticated: true,
    identity: identity ?? "local-dev"
  };
}

export function displayNameForIdentity(identity: string): string {
  const normalized = identity
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  const compact = normalized.includes("@")
    ? normalized.split("@")[0] ?? normalized
    : normalized;
  return compact.slice(0, 48) || "authenticated-user";
}

export function sessionInfo(
  headers: Record<string, string | string[] | undefined>,
  options: {
    requireAuth: boolean;
    trustProxyAuth: boolean;
    authLogoutUrl?: string;
  }
): SessionInfo {
  const identity = options.trustProxyAuth
    ? requestIdentity(headers)
    : undefined;
  const authenticated = Boolean(identity);
  return {
    authRequired: options.requireAuth,
    authenticated,
    ...(authenticated && identity
      ? { user: { displayName: displayNameForIdentity(identity) } }
      : {}),
    ...(options.authLogoutUrl ? { logoutUrl: options.authLogoutUrl } : {})
  };
}
