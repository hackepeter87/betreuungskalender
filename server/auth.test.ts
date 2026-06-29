import assert from "node:assert/strict";
import test from "node:test";
import {
  displayNameForIdentity,
  requestIdentity,
  resolveRequestIdentity,
  sessionInfo
} from "./auth.js";

test("reads supported proxy identity headers in priority order", () => {
  assert.equal(
    requestIdentity({
      "x-auth-request-email": " user@example.net ",
      "x-forwarded-user": "fallback"
    }),
    "user@example.net"
  );
});

test("allows local development without proxy authentication", () => {
  assert.deepEqual(
    resolveRequestIdentity({}, { requireAuth: false, trustProxyAuth: false }),
    { authenticated: true, identity: "local-dev" }
  );
});

test("blocks required authentication when no trusted identity exists", () => {
  assert.deepEqual(
    resolveRequestIdentity(
      { "x-auth-request-email": "user@example.net" },
      { requireAuth: true, trustProxyAuth: false }
    ),
    { authenticated: false, identity: "" }
  );
});

test("accepts an identity only when trusted proxy authentication is enabled", () => {
  assert.deepEqual(
    resolveRequestIdentity(
      { "x-auth-request-user": "account-123" },
      { requireAuth: true, trustProxyAuth: true }
    ),
    { authenticated: true, identity: "account-123" }
  );
});

test("derives compact display names without exposing extra identity details", () => {
  assert.equal(displayNameForIdentity(" user@example.net "), "user");
  assert.equal(displayNameForIdentity("Example User"), "Example User");
  assert.equal(displayNameForIdentity("\u0000".repeat(4)), "authenticated-user");
});

test("reports authenticated session metadata only when proxy identity is trusted", () => {
  assert.deepEqual(
    sessionInfo(
      { "x-auth-request-email": "parent@example.net" },
      {
        requireAuth: true,
        trustProxyAuth: true,
        authLogoutUrl: "/oauth2/sign_out"
      }
    ),
    {
      authRequired: true,
      authenticated: true,
      user: { displayName: "parent" },
      logoutUrl: "/oauth2/sign_out"
    }
  );

  assert.deepEqual(
    sessionInfo(
      { "x-auth-request-email": "parent@example.net" },
      { requireAuth: false, trustProxyAuth: false }
    ),
    {
      authRequired: false,
      authenticated: false
    }
  );
});
