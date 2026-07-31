import assert from "node:assert/strict";
import test from "node:test";
import { createApiAuthHook } from "./authHook.js";
import { workspacePermissionsForRole, workspaceRoleForLegacyRole, type RequestUser, type WorkspacePermission } from "./auth.js";
import type { config as appConfig } from "./config.js";

type TestAuthConfig = Pick<
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

function authConfig(overrides: Partial<TestAuthConfig> = {}): TestAuthConfig {
  return {
    authMode: "native-oidc",
    requireAuth: true,
    trustProxyAuth: false,
    trustedProxyRules: [],
    oidcUserIdHeader: "x-auth-request-user",
    oidcEmailHeader: "x-auth-request-email",
    oidcDisplayNameHeader: "x-auth-request-preferred-username",
    oidcGroupsHeader: "x-auth-request-groups",
    oidcAdminGroup: "/betreuungskalender/admins",
    oidcParentGroup: "/betreuungskalender/parents",
    oidcReadonlyGroup: "/betreuungskalender/readers",
    oidcRequireRoleClaim: true,
    sessionCookieName: "betreuungskalender_session",
    recoveryAdminEnabled: false,
    recoveryAdminSessionCookieName: "betreuungskalender_recovery",
    ...overrides
  };
}

function user(role: RequestUser["role"]): RequestUser {
  const permissions = role === "admin"
    ? ["read", "write", "admin"] as const
    : role === "parent"
      ? ["read", "write"] as const
      : ["read"] as const;
  const workspaceRole = workspaceRoleForLegacyRole(role);
  return {
    id: `user-${role}`,
    externalSubject: `subject-${role}`,
    displayName: role,
    groups: [`/betreuungskalender/${role}`],
    role,
    permissions: [...permissions],
    workspaceRole,
    workspaceAccess: true,
    workspacePermissions: workspacePermissionsForRole(workspaceRole, role === "admin")
  };
}

function route(permission: WorkspacePermission) {
  return { routeOptions: { config: { permission } } };
}

test("native OIDC mode rejects trusted proxy headers as API authentication", async () => {
  const hook = createApiAuthHook(authConfig({
    authMode: "native-oidc",
    trustProxyAuth: true
  }));

  await assert.rejects(
    () => hook.call(
      {} as never,
      {
        method: "GET",
        url: "/api/children",
        headers: {
          "x-auth-request-user": "subject-123",
          "x-auth-request-groups": "/betreuungskalender/admins"
        }
      } as never,
      {} as never
    ),
    (error) => {
      const normalized = error as Error & { code?: string; statusCode?: number };
      assert.equal(normalized.code, "authentication_required");
      assert.equal(normalized.statusCode, 401);
      assert.equal(normalized.message, "Authentifizierung erforderlich.");
      return true;
    }
  );
});

test("trusted proxy mode rejects identity headers from untrusted source addresses", async () => {
  const hook = createApiAuthHook(
    authConfig({
      authMode: "trusted-proxy",
      trustProxyAuth: true,
      oidcRequireRoleClaim: true,
      trustedProxyRules: [{
        source: "10.0.0.0/24",
        address: "10.0.0.0",
        prefix: 24,
        family: "ipv4"
      }]
    }),
    undefined,
    {
      upsertAuthenticatedUser: () => undefined,
      applyMembershipRole: (candidate) => ({
        membershipRole: "admin",
        user: {
          ...candidate,
          workspaceRole: "admin",
          workspaceAccess: true,
          workspacePermissions: workspacePermissionsForRole("admin")
        }
      })
    }
  );

  await assert.rejects(
    () => hook.call(
      {} as never,
      {
        method: "GET",
        url: "/api/children",
        raw: { socket: { remoteAddress: "203.0.113.10" } },
        headers: {
          "x-auth-request-user": "subject-123",
          "x-auth-request-groups": "/betreuungskalender/admins"
        }
      } as never,
      {} as never
    ),
    (error) => {
      const normalized = error as Error & { code?: string; statusCode?: number };
      assert.equal(normalized.code, "untrusted_proxy");
      assert.equal(normalized.statusCode, 403);
      return true;
    }
  );
});

test("trusted proxy mode accepts identity headers from allowed source addresses", async () => {
  const hook = createApiAuthHook(
    authConfig({
      authMode: "trusted-proxy",
      trustProxyAuth: true,
      oidcRequireRoleClaim: true,
      trustedProxyRules: [{
        source: "10.0.0.0/24",
        address: "10.0.0.0",
        prefix: 24,
        family: "ipv4"
      }]
    }),
    undefined,
    {
      upsertAuthenticatedUser: () => undefined,
      applyMembershipRole: (candidate) => ({
        membershipRole: "admin",
        user: {
          ...candidate,
          workspaceRole: "admin",
          workspaceAccess: true,
          workspacePermissions: workspacePermissionsForRole("admin")
        }
      })
    }
  );
  const request = {
    ...route("children:view-sensitive"),
    method: "GET",
    url: "/api/children",
    raw: { socket: { remoteAddress: "10.0.0.23" } },
    headers: {
      "x-auth-request-user": "subject-123",
      "x-auth-request-groups": "/betreuungskalender/admins"
    }
  } as never;

  await assert.doesNotReject(() => hook.call({} as never, request, {} as never));
  assert.equal((request as { user?: RequestUser }).user?.role, "admin");
});

test("trusted proxy mode can authorize strict users through app membership", async () => {
  const hook = createApiAuthHook(
    authConfig({
      authMode: "trusted-proxy",
      trustProxyAuth: true,
      oidcRequireRoleClaim: true,
      trustedProxyRules: [{
        source: "10.0.0.0/24",
        address: "10.0.0.0",
        prefix: 24,
        family: "ipv4"
      }]
    }),
    undefined,
    {
      upsertAuthenticatedUser: () => undefined,
      applyMembershipRole: (candidate) => ({
        membershipRole: "editor",
        user: {
          ...candidate,
          role: "parent",
          permissions: ["read", "write"],
          workspaceRole: "editor",
          workspaceAccess: true,
          workspacePermissions: workspacePermissionsForRole("editor")
        }
      })
    }
  );
  const request = {
    ...route("children:manage"),
    method: "POST",
    url: "/api/children",
    raw: { socket: { remoteAddress: "10.0.0.23" } },
    headers: {
      "x-auth-request-user": "subject-member",
      "x-auth-request-email": "member@example.test",
      "x-auth-request-groups": "/unknown/group"
    }
  } as never;

  await assert.doesNotReject(() => hook.call({} as never, request, {} as never));
  assert.equal((request as { user?: RequestUser }).user?.role, "parent");
});

test("/api/session stays reachable for frontend auth discovery", async () => {
  const hook = createApiAuthHook(authConfig());

  await assert.doesNotReject(() => hook.call(
    {} as never,
    {
      method: "GET",
      url: "/api/session",
      headers: {
        cookie: "betreuungskalender_session=opaque"
      }
    } as never,
    {} as never
  ));
});

test("native OIDC API authentication uses server-side sessions and persisted users", async () => {
  const hook = createApiAuthHook(authConfig(), undefined, {
    nativeSessions: {
      findByToken: (token) => token === "valid"
        ? {
            id: "session-1",
            externalSubject: "subject-admin",
            createdAt: "2026-07-01T00:00:00.000Z",
            expiresAt: "2026-07-02T00:00:00.000Z"
          }
        : undefined
    },
    findUserByExternalSubject: (subject) => subject === "subject-admin"
      ? user("admin")
      : undefined
  });
  const request = {
    ...route("admin:destructive"),
    method: "PUT",
    url: "/api/app-data",
    headers: { cookie: "betreuungskalender_session=valid" }
  } as never;

  await assert.doesNotReject(() => hook.call({} as never, request, {} as never));
  assert.equal((request as { user?: RequestUser }).user?.role, "admin");
});

test("native OIDC API authentication enforces readonly permissions", async () => {
  const hook = createApiAuthHook(authConfig(), undefined, {
    nativeSessions: {
      findByToken: () => ({
        id: "session-1",
        externalSubject: "subject-readonly",
        createdAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-07-02T00:00:00.000Z"
      })
    },
    findUserByExternalSubject: () => user("readonly")
  });

  await assert.doesNotReject(() => hook.call(
    {} as never,
    {
      ...route("children:view-basic"),
      method: "GET",
      url: "/api/children/summary",
      headers: { cookie: "betreuungskalender_session=valid" }
    } as never,
    {} as never
  ));

  await assert.rejects(
    () => hook.call(
      {} as never,
      {
        ...route("children:manage"),
        method: "POST",
        url: "/api/children",
        headers: { cookie: "betreuungskalender_session=valid" }
      } as never,
      {} as never
    ),
    (error) => {
      const normalized = error as Error & { code?: string; statusCode?: number };
      assert.equal(normalized.code, "forbidden");
      assert.equal(normalized.statusCode, 403);
      return true;
    }
  );
});

test("protected API routes without explicit permission metadata fail closed", async () => {
  const hook = createApiAuthHook(authConfig(), undefined, {
    nativeSessions: {
      findByToken: () => ({
        id: "session-1",
        externalSubject: "subject-admin",
        createdAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-07-02T00:00:00.000Z"
      })
    },
    findUserByExternalSubject: () => user("admin")
  });

  await assert.rejects(
    () => hook.call(
      {} as never,
      {
        method: "GET",
        url: "/api/route-without-permission",
        headers: { cookie: "betreuungskalender_session=valid" }
      } as never,
      {} as never
    ),
    (error) => {
      const normalized = error as Error & { code?: string; statusCode?: number };
      assert.equal(normalized.code, "forbidden");
      assert.equal(normalized.statusCode, 403);
      return true;
    }
  );
});

test("authenticated users without workspace access are denied on the next request", async () => {
  const deniedUser = {
    ...user("admin"),
    permissions: [],
    workspaceAccess: false,
    workspacePermissions: []
  } satisfies RequestUser;
  const hook = createApiAuthHook(authConfig(), undefined, {
    nativeSessions: {
      findByToken: () => ({
        id: "session-1",
        externalSubject: "subject-revoked",
        createdAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-07-02T00:00:00.000Z"
      })
    },
    findUserByExternalSubject: () => deniedUser
  });

  await assert.rejects(
    () => hook.call(
      {} as never,
      {
        ...route("appointments:view"),
        method: "GET",
        url: "/api/care-entries/schedule",
        headers: { cookie: "betreuungskalender_session=valid" }
      } as never,
      {} as never
    ),
    (error) => {
      const normalized = error as Error & { code?: string; statusCode?: number };
      assert.equal(normalized.code, "forbidden");
      assert.equal(normalized.statusCode, 403);
      return true;
    }
  );
});

test("instance readiness requires an admin session", async () => {
  const parentHook = createApiAuthHook(authConfig(), undefined, {
    nativeSessions: {
      findByToken: () => ({
        id: "session-parent",
        externalSubject: "subject-parent",
        createdAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-07-02T00:00:00.000Z"
      })
    },
    findUserByExternalSubject: () => user("parent")
  });

  await assert.rejects(
    () => parentHook.call(
      {} as never,
      {
        ...route("instance:inspect"),
        method: "GET",
        url: "/api/instance-readiness",
        headers: { cookie: "betreuungskalender_session=valid" }
      } as never,
      {} as never
    ),
    (error) => {
      const normalized = error as Error & { code?: string; statusCode?: number };
      assert.equal(normalized.code, "forbidden");
      assert.equal(normalized.statusCode, 403);
      return true;
    }
  );

  const adminHook = createApiAuthHook(authConfig(), undefined, {
    nativeSessions: {
      findByToken: () => ({
        id: "session-admin",
        externalSubject: "subject-admin",
        createdAt: "2026-07-01T00:00:00.000Z",
        expiresAt: "2026-07-02T00:00:00.000Z"
      })
    },
    findUserByExternalSubject: () => user("admin")
  });

  await assert.doesNotReject(() => adminHook.call(
    {} as never,
    {
      ...route("instance:inspect"),
      method: "GET",
      url: "/api/instance-readiness",
      headers: { cookie: "betreuungskalender_session=valid" }
    } as never,
    {} as never
  ));
});

test("native OIDC API authentication rejects missing sessions", async () => {
  const hook = createApiAuthHook(authConfig(), undefined, {
    nativeSessions: {
      findByToken: () => undefined
    }
  });

  await assert.rejects(
    () => hook.call(
      {} as never,
      {
        method: "GET",
        url: "/api/children",
        headers: { cookie: "betreuungskalender_session=missing" }
      } as never,
      {} as never
    ),
    (error) => {
      const normalized = error as Error & { code?: string; statusCode?: number };
      assert.equal(normalized.code, "authentication_required");
      assert.equal(normalized.statusCode, 401);
      return true;
    }
  );
});

test("enabled recovery admin sessions can authorize API admin requests", async () => {
  const hook = createApiAuthHook(authConfig({
    recoveryAdminEnabled: true
  }), undefined, {
    nativeSessions: {
      findByToken: () => undefined
    },
    findRecoveryUserByToken: (token) => token === "recovery-valid"
      ? user("admin")
      : undefined
  });
  const request = {
    ...route("admin:destructive"),
    method: "PUT",
    url: "/api/app-data",
    headers: { cookie: "betreuungskalender_recovery=recovery-valid" }
  } as never;

  await assert.doesNotReject(() => hook.call({} as never, request, {} as never));
  assert.equal((request as { user?: RequestUser }).user?.role, "admin");
});

test("disabled recovery admin sessions never grant API access", async () => {
  const hook = createApiAuthHook(authConfig(), undefined, {
    nativeSessions: {
      findByToken: () => undefined
    },
    findRecoveryUserByToken: () => user("admin")
  });

  await assert.rejects(
    () => hook.call(
      {} as never,
      {
        method: "GET",
        url: "/api/children",
        headers: { cookie: "betreuungskalender_recovery=recovery-valid" }
      } as never,
      {} as never
    ),
    (error) => {
      const normalized = error as Error & { code?: string; statusCode?: number };
      assert.equal(normalized.code, "authentication_required");
      assert.equal(normalized.statusCode, 401);
      return true;
    }
  );
});
