import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import Fastify from "fastify";
import type { Configuration } from "openid-client";
import { migrateDatabase } from "./db/migrationRunner.js";
import {
  NativeOidcError,
  NativeOidcService,
  type OidcLibrary
} from "./nativeOidc.js";
import { nativeOidcRoutes } from "./routes/nativeOidc.js";
import { OidcLoginStateStore } from "./services/oidcLoginStates.js";
import { OidcSessionStore } from "./services/oidcSessions.js";
import { upsertAuthenticatedUser } from "./services/users.js";

function testDatabase() {
  const root = mkdtempSync(join(tmpdir(), "betreuungskalender-oidc-"));
  const database = new Database(join(root, "app.sqlite"));
  database.pragma("foreign_keys = ON");
  migrateDatabase(database);
  return {
    database,
    cleanup() {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  };
}

function fakeLibrary(
  overrides: Partial<OidcLibrary> = {},
  grantCalls: Array<{
    currentUrl: URL;
    checks: {
      pkceCodeVerifier: string;
      expectedState: string;
      expectedNonce: string;
    };
  }> = []
): OidcLibrary {
  const configuration = {} as Configuration;
  return {
    discovery: async () => configuration,
    randomState: () => "state-123",
    randomNonce: () => "nonce-123",
    randomPKCECodeVerifier: () => "verifier-123",
    calculatePKCECodeChallenge: async (verifier) => `challenge-${verifier}`,
    buildAuthorizationUrl: (_config, parameters) => {
      const url = new URL("https://idp.example.test/realms/demo/protocol/openid-connect/auth");
      for (const [key, value] of Object.entries(parameters)) {
        url.searchParams.set(key, value);
      }
      url.searchParams.set("client_id", "betreuungskalender");
      return url;
    },
    authorizationCodeGrant: async (_config, currentUrl, checks) => {
      grantCalls.push({ currentUrl, checks });
      return {
        claims: () => ({
          sub: "subject-123",
          email: "parent@example.net",
          preferred_username: "Example Parent",
          groups: ["/betreuungskalender/parents", "/other"]
        })
      };
    },
    ...overrides
  };
}

function nativeConfig() {
  return {
    issuerUrl: "https://idp.example.test/realms/demo",
    clientId: "betreuungskalender",
    clientSecret: "test-secret",
    redirectUri: "https://bk.example.test/auth/callback",
    scopes: "openid email profile",
    groupsClaim: "groups",
    loginStateTtlSeconds: 600
  };
}

test("native OIDC login stores server-side state and redirects with PKCE and nonce", async () => {
  const { database, cleanup } = testDatabase();
  try {
    const service = new NativeOidcService({
      config: nativeConfig(),
      loginStates: new OidcLoginStateStore(database),
      library: fakeLibrary()
    });

    const redirect = await service.createLoginRedirect();

    assert.equal(redirect.origin, "https://idp.example.test");
    assert.equal(redirect.searchParams.get("redirect_uri"), "https://bk.example.test/auth/callback");
    assert.equal(redirect.searchParams.get("scope"), "openid email profile");
    assert.equal(redirect.searchParams.get("response_type"), "code");
    assert.equal(redirect.searchParams.get("code_challenge"), "challenge-verifier-123");
    assert.equal(redirect.searchParams.get("code_challenge_method"), "S256");
    assert.equal(redirect.searchParams.get("state"), "state-123");
    assert.equal(redirect.searchParams.get("nonce"), "nonce-123");

    const row = database.prepare(`
      SELECT state, nonce, pkce_verifier, redirect_uri, consumed_at
      FROM native_oidc_login_states
    `).get() as {
      state: string;
      nonce: string;
      pkce_verifier: string;
      redirect_uri: string;
      consumed_at: string | null;
    };
    assert.deepEqual(row, {
      state: "state-123",
      nonce: "nonce-123",
      pkce_verifier: "verifier-123",
      redirect_uri: "https://bk.example.test/auth/callback",
      consumed_at: null
    });
  } finally {
    cleanup();
  }
});

test("native OIDC callback validates state nonce and PKCE through the client library", async () => {
  const { database, cleanup } = testDatabase();
  try {
    const grantCalls: Array<{
      currentUrl: URL;
      checks: {
        pkceCodeVerifier: string;
        expectedState: string;
        expectedNonce: string;
      };
    }> = [];
    const service = new NativeOidcService({
      config: nativeConfig(),
      loginStates: new OidcLoginStateStore(database),
      library: fakeLibrary({}, grantCalls)
    });

    await service.createLoginRedirect();
    const result = await service.validateCallback("/auth/callback?code=code-123&state=state-123");

    assert.deepEqual(result, {
      subject: "subject-123",
      email: "parent@example.net",
      displayName: "Example Parent",
      groups: ["/betreuungskalender/parents", "/other"]
    });
    assert.equal(grantCalls.length, 1);
    assert.equal(grantCalls[0]?.currentUrl.href, "https://bk.example.test/auth/callback?code=code-123&state=state-123");
    assert.deepEqual(grantCalls[0]?.checks, {
      pkceCodeVerifier: "verifier-123",
      expectedState: "state-123",
      expectedNonce: "nonce-123"
    });

    await assert.rejects(
      () => service.validateCallback("/auth/callback?code=code-123&state=state-123"),
      (error) =>
        error instanceof NativeOidcError &&
        error.code === "native_oidc_invalid_state" &&
        error.statusCode === 400
    );
  } finally {
    cleanup();
  }
});

test("native OIDC callback rejects state mismatches before token exchange", async () => {
  const { database, cleanup } = testDatabase();
  try {
    const grantCalls: Array<{
      currentUrl: URL;
      checks: {
        pkceCodeVerifier: string;
        expectedState: string;
        expectedNonce: string;
      };
    }> = [];
    const service = new NativeOidcService({
      config: nativeConfig(),
      loginStates: new OidcLoginStateStore(database),
      library: fakeLibrary({}, grantCalls)
    });

    await service.createLoginRedirect();

    await assert.rejects(
      () => service.validateCallback("/auth/callback?code=code-123&state=wrong-state"),
      (error) =>
        error instanceof NativeOidcError &&
        error.code === "native_oidc_invalid_state" &&
        error.statusCode === 400
    );
    assert.equal(grantCalls.length, 0);
  } finally {
    cleanup();
  }
});

for (const validationCase of [
  "nonce mismatch",
  "PKCE verifier mismatch",
  "wrong issuer",
  "wrong audience",
  "expired token"
]) {
  test(`native OIDC callback rejects ${validationCase} from protocol validation`, async () => {
    const { database, cleanup } = testDatabase();
    try {
      const service = new NativeOidcService({
        config: nativeConfig(),
        loginStates: new OidcLoginStateStore(database),
        library: fakeLibrary({
          authorizationCodeGrant: async () => {
            throw new Error(validationCase);
          }
        })
      });

      await service.createLoginRedirect();

      await assert.rejects(
        () => service.validateCallback("/auth/callback?code=code-123&state=state-123"),
        (error) =>
          error instanceof NativeOidcError &&
          error.code === "native_oidc_callback_rejected" &&
          error.statusCode === 400 &&
          !error.message.includes(validationCase)
      );
    } finally {
      cleanup();
    }
  });
}

test("native OIDC callback rejects missing subjects without exposing token details", async () => {
  const { database, cleanup } = testDatabase();
  try {
    const service = new NativeOidcService({
      config: nativeConfig(),
      loginStates: new OidcLoginStateStore(database),
      library: fakeLibrary({
        authorizationCodeGrant: async () => ({
          claims: () => ({})
        })
      })
    });

    await service.createLoginRedirect();

    await assert.rejects(
      () => service.validateCallback("/auth/callback?code=code-123&state=state-123"),
      (error) =>
        error instanceof NativeOidcError &&
        error.code === "native_oidc_missing_subject" &&
        error.statusCode === 400
    );
  } finally {
    cleanup();
  }
});

test("native OIDC routes redirect login and keep callback responses token-free", async () => {
  const { database, cleanup } = testDatabase();
  const app = Fastify({ logger: false });
  const sessions = new OidcSessionStore(database);
  await app.register(nativeOidcRoutes, {
    config: {
      authMode: "native-oidc",
      nodeEnv: "production",
      oidcIssuerUrl: "https://idp.example.test/realms/demo",
      oidcClientId: "betreuungskalender",
      oidcClientSecret: "test-secret",
      oidcRedirectUri: "https://bk.example.test/auth/callback",
      oidcScopes: "openid email profile",
      oidcGroupsClaim: "groups",
      oidcLoginStateTtlSeconds: 600,
      oidcAdminGroup: "/betreuungskalender/admins",
      oidcParentGroup: "/betreuungskalender/parents",
      oidcReadonlyGroup: "/betreuungskalender/readers",
      oidcRequireRoleClaim: true,
      sessionCookieName: "betreuungskalender_session",
      sessionTtlSeconds: 3600,
      rateLimitSensitiveMax: 5,
      rateLimitWindowMs: 60_000
    },
    service: {
      createLoginRedirect: async () => new URL("https://idp.example.test/auth?state=state-123"),
      validateCallback: async () => ({
        subject: "subject-123",
        email: "parent@example.net",
        displayName: "Example Parent",
        groups: ["/betreuungskalender/parents"]
      })
    },
    sessions,
    upsertUser: (user) => upsertAuthenticatedUser(user, new Date().toISOString(), database)
  });

  try {
    const login = await app.inject({ method: "GET", url: "/auth/login" });
    assert.equal(login.statusCode, 302);
    assert.equal(login.headers.location, "https://idp.example.test/auth?state=state-123");

    const callback = await app.inject({
      method: "GET",
      url: "/auth/callback?code=code-123&state=state-123"
    });
    assert.equal(callback.statusCode, 302);
    assert.equal(callback.headers.location, "/");
    assert.equal(callback.payload.includes("subject-123"), false);
    assert.equal(callback.payload.includes("code-123"), false);
    const setCookie = String(callback.headers["set-cookie"]);
    assert.match(setCookie, /^betreuungskalender_session=[^;]+;/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /Max-Age=3600/);
    const cookieHeader = setCookie.split(";")[0];
    const sessionToken = cookieHeader?.split("=")[1];
    assert.equal(Boolean(sessionToken), true);
    assert.equal(sessions.findByToken(sessionToken)?.externalSubject, "subject-123");
    const user = database.prepare(`
      SELECT email, display_name, role, groups_json
      FROM app_users
      WHERE external_subject = ?
    `).get("subject-123") as {
      email: string;
      display_name: string;
      role: string;
      groups_json: string;
    };
    assert.deepEqual(user, {
      email: "parent@example.net",
      display_name: "Example Parent",
      role: "parent",
      groups_json: "[\"/betreuungskalender/parents\"]"
    });

    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: cookieHeader ?? "" }
    });
    assert.equal(logout.statusCode, 200);
    assert.deepEqual(JSON.parse(logout.payload), {
      authenticated: false,
      loggedOut: true
    });
    assert.match(String(logout.headers["set-cookie"]), /Max-Age=0/);
    assert.equal(sessions.findByToken(sessionToken), undefined);
  } finally {
    await app.close();
    cleanup();
  }
});

test("native OIDC callback rejects claims without a configured role group", async () => {
  const { database, cleanup } = testDatabase();
  const app = Fastify({ logger: false });
  await app.register(nativeOidcRoutes, {
    config: {
      authMode: "native-oidc",
      nodeEnv: "production",
      oidcIssuerUrl: "https://idp.example.test/realms/demo",
      oidcClientId: "betreuungskalender",
      oidcClientSecret: "test-secret",
      oidcRedirectUri: "https://bk.example.test/auth/callback",
      oidcScopes: "openid email profile",
      oidcGroupsClaim: "groups",
      oidcLoginStateTtlSeconds: 600,
      oidcAdminGroup: "/betreuungskalender/admins",
      oidcParentGroup: "/betreuungskalender/parents",
      oidcReadonlyGroup: "/betreuungskalender/readers",
      oidcRequireRoleClaim: true,
      sessionCookieName: "betreuungskalender_session",
      sessionTtlSeconds: 3600,
      rateLimitSensitiveMax: 5,
      rateLimitWindowMs: 60_000
    },
    service: {
      createLoginRedirect: async () => new URL("https://idp.example.test/auth?state=state-123"),
      validateCallback: async () => ({
        subject: "subject-123",
        groups: ["/other"]
      })
    },
    sessions: new OidcSessionStore(database)
  });

  try {
    const callback = await app.inject({
      method: "GET",
      url: "/auth/callback?code=code-123&state=state-123"
    });
    assert.equal(callback.statusCode, 403);
    assert.equal(callback.headers["set-cookie"], undefined);
    assert.deepEqual(JSON.parse(callback.payload), {
      error: "authorization_required",
      message: "Keine passende Berechtigung in den OIDC-Claims gefunden."
    });
  } finally {
    await app.close();
    cleanup();
  }
});
