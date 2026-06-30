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
        claims: () => ({ sub: "subject-123" })
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

    assert.deepEqual(result, { subject: "subject-123" });
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
  const app = Fastify({ logger: false });
  await app.register(nativeOidcRoutes, {
    config: {
      authMode: "native-oidc",
      oidcIssuerUrl: "https://idp.example.test/realms/demo",
      oidcClientId: "betreuungskalender",
      oidcClientSecret: "test-secret",
      oidcRedirectUri: "https://bk.example.test/auth/callback",
      oidcScopes: "openid email profile",
      oidcLoginStateTtlSeconds: 600,
      rateLimitSensitiveMax: 5,
      rateLimitWindowMs: 60_000
    },
    service: {
      createLoginRedirect: async () => new URL("https://idp.example.test/auth?state=state-123"),
      validateCallback: async () => ({ subject: "subject-123" })
    }
  });

  try {
    const login = await app.inject({ method: "GET", url: "/auth/login" });
    assert.equal(login.statusCode, 302);
    assert.equal(login.headers.location, "https://idp.example.test/auth?state=state-123");

    const callback = await app.inject({
      method: "GET",
      url: "/auth/callback?code=code-123&state=state-123"
    });
    assert.equal(callback.statusCode, 200);
    assert.deepEqual(JSON.parse(callback.payload), {
      authenticated: false,
      loginValidated: true,
      sessionCreated: false
    });
    assert.equal(callback.payload.includes("subject-123"), false);
    assert.equal(callback.payload.includes("code-123"), false);
  } finally {
    await app.close();
  }
});
