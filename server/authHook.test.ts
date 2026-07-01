import assert from "node:assert/strict";
import test from "node:test";
import { createApiAuthHook } from "./authHook.js";
import type { RequestUser } from "./auth.js";
import type { config as appConfig } from "./config.js";

type TestAuthConfig = Pick<
  typeof appConfig,
  | "authMode"
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
  | "sessionCookieName"
>;

function authConfig(overrides: Partial<TestAuthConfig> = {}): TestAuthConfig {
  return {
    authMode: "native-oidc",
    requireAuth: true,
    trustProxyAuth: false,
    oidcUserIdHeader: "x-auth-request-user",
    oidcEmailHeader: "x-auth-request-email",
    oidcDisplayNameHeader: "x-auth-request-preferred-username",
    oidcGroupsHeader: "x-auth-request-groups",
    oidcAdminGroup: "/betreuungskalender/admins",
    oidcParentGroup: "/betreuungskalender/parents",
    oidcReadonlyGroup: "/betreuungskalender/readers",
    oidcRequireRoleClaim: true,
    sessionCookieName: "betreuungskalender_session",
    ...overrides
  };
}

function user(role: RequestUser["role"]): RequestUser {
  const permissions = role === "admin"
    ? ["read", "write", "admin"] as const
    : role === "parent"
      ? ["read", "write"] as const
      : ["read"] as const;
  return {
    id: `user-${role}`,
    externalSubject: `subject-${role}`,
    displayName: role,
    groups: [`/betreuungskalender/${role}`],
    role,
    permissions: [...permissions]
  };
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
      method: "GET",
      url: "/api/children",
      headers: { cookie: "betreuungskalender_session=valid" }
    } as never,
    {} as never
  ));

  await assert.rejects(
    () => hook.call(
      {} as never,
      {
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
