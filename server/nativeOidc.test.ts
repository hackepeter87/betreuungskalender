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
    buildEndSessionUrl: (_config, parameters) => {
      const url = new URL("https://idp.example.test/realms/demo/protocol/openid-connect/logout");
      for (const [key, value] of Object.entries(parameters)) {
        url.searchParams.set(key, value);
      }
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
      SELECT state, nonce, pkce_verifier, redirect_uri, context_type,
             context_token_hash, consumed_at
      FROM native_oidc_login_states
    `).get() as {
      state: string;
      nonce: string;
      pkce_verifier: string;
      redirect_uri: string;
      context_type: string;
      context_token_hash: string | null;
      consumed_at: string | null;
    };
    assert.deepEqual(row, {
      state: "state-123",
      nonce: "nonce-123",
      pkce_verifier: "verifier-123",
      redirect_uri: "https://bk.example.test/auth/callback",
      context_type: "normal",
      context_token_hash: null,
      consumed_at: null
    });
  } finally {
    cleanup();
  }
});

test("native OIDC login stores only hashed onboarding context", async () => {
  const { database, cleanup } = testDatabase();
  try {
    const tokenHash = "a".repeat(64);
    const service = new NativeOidcService({
      config: nativeConfig(),
      loginStates: new OidcLoginStateStore(database),
      library: fakeLibrary()
    });

    await service.createLoginRedirect({ type: "invitation", tokenHash });

    const row = database.prepare(`
      SELECT context_type, context_token_hash
      FROM native_oidc_login_states
    `).get() as { context_type: string; context_token_hash: string | null };
    assert.deepEqual(row, {
      context_type: "invitation",
      context_token_hash: tokenHash
    });
    const result = await service.validateCallback(
      "/auth/callback?code=code-123&state=state-123"
    );
    assert.deepEqual(result.loginContext, { type: "invitation", tokenHash });
  } finally {
    cleanup();
  }
});

test("native OIDC login rejects raw onboarding tokens as context", async () => {
  const { database, cleanup } = testDatabase();
  try {
    const service = new NativeOidcService({
      config: nativeConfig(),
      loginStates: new OidcLoginStateStore(database),
      library: fakeLibrary()
    });

    await assert.rejects(
      () => service.createLoginRedirect({
        type: "owner_setup",
        tokenHash: "raw-owner-token"
      }),
      /SHA-256 hex digest/
    );
    const count = database.prepare(
      "SELECT COUNT(*) AS count FROM native_oidc_login_states"
    ).get() as { count: number };
    assert.equal(count.count, 0);
  } finally {
    cleanup();
  }
});

test("native OIDC logout redirects to the provider end-session endpoint", async () => {
  const service = new NativeOidcService({
    config: {
      ...nativeConfig(),
      postLogoutRedirectUri: "https://bk.example.test/logged-out"
    },
    library: fakeLibrary()
  });

  const redirect = await service.createLogoutRedirect();

  assert.equal(
    redirect.origin + redirect.pathname,
    "https://idp.example.test/realms/demo/protocol/openid-connect/logout"
  );
  assert.equal(redirect.searchParams.get("client_id"), "betreuungskalender");
  assert.equal(
    redirect.searchParams.get("post_logout_redirect_uri"),
    "https://bk.example.test/logged-out"
  );
  assert.equal(redirect.searchParams.has("id_token_hint"), false);
});

test("native OIDC logout defaults the post-logout redirect to the app origin", async () => {
  const service = new NativeOidcService({
    config: nativeConfig(),
    library: fakeLibrary()
  });

  const redirect = await service.createLogoutRedirect();

  assert.equal(
    redirect.searchParams.get("post_logout_redirect_uri"),
    "https://bk.example.test/"
  );
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
      groups: ["/betreuungskalender/parents", "/other"],
      loginContext: { type: "normal" }
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
  const ownerHash = "b".repeat(64);
  const invitationHash = "c".repeat(64);
  const loginContexts: unknown[] = [];
  const ownerClaims: Array<{ tokenHash: string; userId: string }> = [];
  const invitationClaims: Array<{ tokenHash: string; userId: string }> = [];
  let callbackContext: { type: "owner_setup" | "invitation"; tokenHash: string } = {
    type: "owner_setup",
    tokenHash: ownerHash
  };
  await app.register(nativeOidcRoutes, {
    config: {
      authMode: "native-oidc",
      nodeEnv: "production",
      oidcIssuerUrl: "https://idp.example.test/realms/demo",
      oidcClientId: "betreuungskalender",
      oidcClientSecret: "test-secret",
      oidcRedirectUri: "https://bk.example.test/auth/callback",
      oidcPostLogoutRedirectUri: "https://bk.example.test/",
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
      createLoginRedirect: async (context = { type: "normal" as const }) => {
        loginContexts.push(context);
        return new URL("https://idp.example.test/auth?state=state-123");
      },
      createLogoutRedirect: async () =>
        new URL("https://idp.example.test/logout?client_id=betreuungskalender"),
      validateCallback: async () => ({
        subject: "subject-123",
        email: "parent@example.net",
        displayName: "Example Parent",
        groups: ["/betreuungskalender/parents"],
        loginContext: callbackContext
      })
    },
    ownerSetupTokens: {
      begin: (token) => {
        if (token === "consumed-owner-token") {
          throw new NativeOidcError(
            "owner_setup_consumed",
            409,
            "Der Owner-Setup-Link wurde bereits verwendet."
          );
        }
        assert.equal(token, "fictional-owner-token");
        return ownerHash;
      },
      consumeAndClaim: (tokenHash, user) => {
        ownerClaims.push({ tokenHash, userId: user.id });
      }
    },
    invitationFlow: {
      begin: (token) => {
        if (token === "expired-invitation-token") {
          throw new NativeOidcError(
            "invitation_expired",
            410,
            "Die Einladung ist abgelaufen."
          );
        }
        assert.equal(token, "fictional-invitation-token");
        return invitationHash;
      },
      accept: (tokenHash, user) => {
        invitationClaims.push({ tokenHash, userId: user.id });
      }
    },
    sessions,
    upsertUser: (user) => upsertAuthenticatedUser(user, new Date().toISOString(), database),
    applyMembershipRole: (candidate) => ({ user: candidate })
  });

  try {
    const login = await app.inject({ method: "GET", url: "/auth/login" });
    assert.equal(login.statusCode, 302);
    assert.equal(login.headers.location, "https://idp.example.test/auth?state=state-123");

    const setup = await app.inject({
      method: "GET",
      url: "/setup?token=fictional-owner-token"
    });
    assert.equal(setup.statusCode, 200);
    assert.match(setup.headers["content-type"] ?? "", /text\/html/);
    assert.match(setup.payload, /Installation einrichten/);
    assert.match(setup.payload, /\/setup\/continue\?token=fictional-owner-token/);
    assert.equal(setup.payload.includes("idp.example.test"), false);

    const setupContinue = await app.inject({
      method: "GET",
      url: "/setup/continue?token=fictional-owner-token"
    });
    assert.equal(setupContinue.statusCode, 302);
    assert.equal(setupContinue.headers.location, "https://idp.example.test/auth?state=state-123");
    assert.deepEqual(loginContexts, [
      { type: "normal" },
      { type: "owner_setup", tokenHash: ownerHash }
    ]);
    assert.equal(String(setupContinue.headers.location).includes("fictional-owner-token"), false);

    const invitation = await app.inject({
      method: "GET",
      url: "/invite?token=fictional-invitation-token"
    });
    assert.equal(invitation.statusCode, 200);
    assert.match(invitation.payload, /Einladung annehmen/);
    assert.match(invitation.payload, /\/invite\/continue\?token=fictional-invitation-token/);

    const invitationContinue = await app.inject({
      method: "GET",
      url: "/invite/continue?token=fictional-invitation-token"
    });
    assert.equal(invitationContinue.statusCode, 302);
    assert.equal(String(invitationContinue.headers.location).includes("fictional-invitation-token"), false);
    assert.deepEqual(loginContexts.at(-1), {
      type: "invitation",
      tokenHash: invitationHash
    });

    const consumedSetup = await app.inject({
      method: "GET",
      url: "/setup?token=consumed-owner-token"
    });
    assert.equal(consumedSetup.statusCode, 409);
    assert.match(consumedSetup.payload, /bereits verwendet/);
    assert.equal(consumedSetup.payload.includes("consumed-owner-token"), false);

    const expiredInvitation = await app.inject({
      method: "GET",
      url: "/invite?token=expired-invitation-token"
    });
    assert.equal(expiredInvitation.statusCode, 410);
    assert.match(expiredInvitation.payload, /abgelaufen/);
    assert.equal(expiredInvitation.payload.includes("expired-invitation-token"), false);

    const callback = await app.inject({
      method: "GET",
      url: "/auth/callback?code=code-123&state=state-123"
    });
    assert.equal(callback.statusCode, 302);
    assert.equal(callback.headers.location, "/");
    assert.equal(callback.payload.includes("subject-123"), false);
    assert.equal(callback.payload.includes("code-123"), false);
    assert.deepEqual(ownerClaims, [{ tokenHash: ownerHash, userId: "user_e8725703d28a2972830e5502" }]);
    callbackContext = { type: "invitation", tokenHash: invitationHash };
    const invitationCallback = await app.inject({
      method: "GET",
      url: "/auth/callback?code=code-456&state=state-456"
    });
    assert.equal(invitationCallback.statusCode, 302);
    assert.deepEqual(invitationClaims, [{
      tokenHash: invitationHash,
      userId: "user_e8725703d28a2972830e5502"
    }]);
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
      loggedOut: true,
      logoutRedirectUrl: "https://idp.example.test/logout?client_id=betreuungskalender"
    });
    assert.match(String(logout.headers["set-cookie"]), /Max-Age=0/);
    assert.equal(sessions.findByToken(sessionToken), undefined);

    const browserLogout = await app.inject({
      method: "GET",
      url: "/auth/logout",
      headers: { cookie: cookieHeader ?? "" }
    });
    assert.equal(browserLogout.statusCode, 302);
    assert.equal(
      browserLogout.headers.location,
      "https://idp.example.test/logout?client_id=betreuungskalender"
    );
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
      oidcPostLogoutRedirectUri: "https://bk.example.test/",
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
      createLogoutRedirect: async () => new URL("https://idp.example.test/logout"),
      validateCallback: async () => ({
        subject: "subject-123",
        groups: ["/other"],
        loginContext: { type: "normal" }
      })
    },
    sessions: new OidcSessionStore(database),
    upsertUser: (user) => upsertAuthenticatedUser(user, new Date().toISOString(), database),
    applyMembershipRole: (candidate) => ({ user: candidate }),
    isSetupRequired: () => false
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

test("native OIDC callback accepts users with app membership without role groups", async () => {
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
      oidcPostLogoutRedirectUri: "https://bk.example.test/",
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
      createLogoutRedirect: async () => new URL("https://idp.example.test/logout"),
      validateCallback: async () => ({
        subject: "subject-member",
        email: "member@example.net",
        displayName: "Known Member",
        groups: ["/other"],
        loginContext: { type: "normal" }
      })
    },
    sessions,
    upsertUser: (user) => upsertAuthenticatedUser(user, new Date().toISOString(), database),
    applyMembershipRole: (candidate) => ({
      membershipRole: "parent",
      user: {
        ...candidate,
        role: "parent",
        permissions: ["read", "write"]
      }
    })
  });

  try {
    const callback = await app.inject({
      method: "GET",
      url: "/auth/callback?code=code-123&state=state-123"
    });

    assert.equal(callback.statusCode, 302);
    assert.equal(callback.headers.location, "/");
    const setCookie = String(callback.headers["set-cookie"]);
    const sessionToken = setCookie.split(";")[0]?.split("=")[1];
    assert.equal(Boolean(sessionToken), true);
    assert.equal(sessions.findByToken(sessionToken)?.externalSubject, "subject-member");
  } finally {
    await app.close();
    cleanup();
  }
});

test("native OIDC callback rejects normal setup login without role groups", async () => {
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
      oidcPostLogoutRedirectUri: "https://bk.example.test/",
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
      createLogoutRedirect: async () => new URL("https://idp.example.test/logout"),
      validateCallback: async () => ({
        subject: "subject-setup",
        email: "setup@example.net",
        displayName: "Setup User",
        groups: ["/other"],
        loginContext: { type: "normal" }
      })
    },
    sessions,
    upsertUser: (user) => upsertAuthenticatedUser(user, new Date().toISOString(), database),
    applyMembershipRole: (candidate) => ({ user: candidate }),
    isSetupRequired: () => true
  });

  try {
    const callback = await app.inject({
      method: "GET",
      url: "/auth/callback?code=code-123&state=state-123"
    });

    assert.equal(callback.statusCode, 403);
    assert.equal(callback.headers["set-cookie"], undefined);
    assert.equal(sessions.findByToken("missing"), undefined);
  } finally {
    await app.close();
    cleanup();
  }
});
