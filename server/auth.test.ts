import assert from "node:assert/strict";
import test from "node:test";
import { requestIdentity, resolveRequestIdentity } from "./auth.js";

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
