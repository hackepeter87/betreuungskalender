import assert from "node:assert/strict";
import test from "node:test";
import { createApiAuthHook } from "./authHook.js";
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
    ...overrides
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
