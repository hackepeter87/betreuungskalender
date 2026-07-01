import { createHash } from "node:crypto";

export const proxyIdentityHeaders = [
  "x-auth-request-email",
  "x-forwarded-email",
  "x-auth-request-user",
  "x-forwarded-user",
  "x-auth-request-preferred-username",
  "x-forwarded-preferred-username",
  "x-auth-request-groups",
  "x-forwarded-groups"
] as const;

export type AuthRole = "admin" | "parent" | "readonly";
export type AuthPermission = "read" | "write" | "admin";

export interface RequestUser {
  id: string;
  externalSubject: string;
  email?: string;
  displayName: string;
  groups: string[];
  role: AuthRole;
  permissions: AuthPermission[];
}

export interface AuthenticatedClaims {
  subject: string;
  email?: string;
  displayName?: string;
  groups: string[];
}

export interface SessionInfo {
  authRequired: boolean;
  authenticated: boolean;
  user?: {
    id: string;
    displayName: string;
    role: AuthRole;
    email?: string;
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

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  configuredName: string
): string | undefined {
  return firstHeader(headers[configuredName.toLowerCase()])?.trim();
}

function splitGroups(value: string | undefined): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(/[,\n;]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function stableUserId(subject: string): string {
  return `user_${createHash("sha256").update(subject).digest("hex").slice(0, 24)}`;
}

export function permissionsForRole(role: AuthRole): AuthPermission[] {
  if (role === "admin") return ["read", "write", "admin"];
  if (role === "parent") return ["read", "write"];
  return ["read"];
}

function localDevUser(): RequestUser {
  return {
    id: "local-dev",
    externalSubject: "local-dev",
    displayName: "local-dev",
    groups: [],
    role: "admin",
    permissions: permissionsForRole("admin")
  };
}

export function roleFromGroups(
  groups: string[],
  options: {
    adminGroup: string;
    parentGroup: string;
    readonlyGroup: string;
    requireRoleClaim: boolean;
  }
): AuthRole | undefined {
  const groupSet = new Set(groups);
  if (groupSet.has(options.adminGroup)) return "admin";
  if (groupSet.has(options.parentGroup)) return "parent";
  if (groupSet.has(options.readonlyGroup)) return "readonly";
  return options.requireRoleClaim ? undefined : "parent";
}

export function userFromClaims(
  claims: AuthenticatedClaims,
  options: {
    adminGroup: string;
    parentGroup: string;
    readonlyGroup: string;
    requireRoleClaim: boolean;
  }
): { authenticated: boolean; user?: RequestUser; reason?: "missing_role" } {
  const role = roleFromGroups(claims.groups, options);
  if (!role) return { authenticated: false, reason: "missing_role" };
  const displayName = claims.displayName ?? claims.email ?? claims.subject;
  return {
    authenticated: true,
    user: {
      id: stableUserId(claims.subject),
      externalSubject: claims.subject,
      ...(claims.email ? { email: claims.email } : {}),
      displayName: displayNameForIdentity(displayName),
      groups: claims.groups,
      role,
      permissions: permissionsForRole(role)
    }
  };
}

export function resolveRequestUser(
  headers: Record<string, string | string[] | undefined>,
  options: {
    requireAuth: boolean;
    trustProxyAuth: boolean;
    userIdHeader: string;
    emailHeader: string;
    displayNameHeader: string;
    groupsHeader: string;
    adminGroup: string;
    parentGroup: string;
    readonlyGroup: string;
    requireRoleClaim: boolean;
  }
): { authenticated: boolean; user?: RequestUser; reason?: "missing_identity" | "missing_role" } {
  if (!options.trustProxyAuth) {
    if (options.requireAuth) return { authenticated: false, reason: "missing_identity" };
    return { authenticated: true, user: localDevUser() };
  }

  const subject = headerValue(headers, options.userIdHeader) ?? requestIdentity(headers);
  if (!subject) {
    if (!options.requireAuth) return { authenticated: true, user: localDevUser() };
    return { authenticated: false, reason: "missing_identity" };
  }

  const email = headerValue(headers, options.emailHeader);
  const displayName = headerValue(headers, options.displayNameHeader) ?? email ?? subject;
  const groups = splitGroups(headerValue(headers, options.groupsHeader));
  const role = roleFromGroups(groups, options);
  if (!role) return { authenticated: false, reason: "missing_role" };

  return {
    authenticated: true,
    user: {
      id: stableUserId(subject),
      externalSubject: subject,
      email,
      displayName: displayNameForIdentity(displayName),
      groups,
      role,
      permissions: permissionsForRole(role)
    }
  };
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
    oidcUserIdHeader?: string;
    oidcEmailHeader?: string;
    oidcDisplayNameHeader?: string;
    oidcGroupsHeader?: string;
    oidcAdminGroup?: string;
    oidcParentGroup?: string;
    oidcReadonlyGroup?: string;
    oidcRequireRoleClaim?: boolean;
  }
): SessionInfo {
  if (!options.trustProxyAuth) {
    return {
      authRequired: options.requireAuth,
      authenticated: false
    };
  }
  const auth = resolveRequestUser(headers, {
    requireAuth: options.requireAuth,
    trustProxyAuth: options.trustProxyAuth,
    userIdHeader: options.oidcUserIdHeader ?? "x-auth-request-user",
    emailHeader: options.oidcEmailHeader ?? "x-auth-request-email",
    displayNameHeader: options.oidcDisplayNameHeader ?? "x-auth-request-preferred-username",
    groupsHeader: options.oidcGroupsHeader ?? "x-auth-request-groups",
    adminGroup: options.oidcAdminGroup ?? "/betreuungskalender/admins",
    parentGroup: options.oidcParentGroup ?? "/betreuungskalender/parents",
    readonlyGroup: options.oidcReadonlyGroup ?? "/betreuungskalender/readers",
    requireRoleClaim: options.oidcRequireRoleClaim ?? false
  });
  return {
    authRequired: options.requireAuth,
    authenticated: auth.authenticated,
    ...(auth.user
      ? {
          user: {
            id: auth.user.id,
            displayName: auth.user.displayName,
            role: auth.user.role,
            ...(auth.user.email ? { email: auth.user.email } : {})
          }
        }
      : {}),
    ...(options.authLogoutUrl ? { logoutUrl: options.authLogoutUrl } : {})
  };
}

export function requiredPermissionForRequest(
  method: string,
  url: string
): AuthPermission {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === "GET" || normalizedMethod === "HEAD" || normalizedMethod === "OPTIONS") {
    return "read";
  }
  if (
    url.startsWith("/api/app-data") ||
    url.startsWith("/api/demo-data") ||
    url.startsWith("/api/migration/")
  ) {
    return "admin";
  }
  return "write";
}

export function hasPermission(user: RequestUser, permission: AuthPermission): boolean {
  return user.permissions.includes(permission);
}
