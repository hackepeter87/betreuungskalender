export const proxyIdentityHeaders = [
  "x-auth-request-email",
  "x-forwarded-email",
  "x-auth-request-user",
  "x-forwarded-user"
] as const;

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
