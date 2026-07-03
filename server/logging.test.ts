import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeRequestUrl } from "./logging.js";

test("request URL sanitizer redacts bearer feed tokens and OIDC callback parameters", () => {
  assert.equal(
    sanitizeRequestUrl("/calendar/feed-secret.ics"),
    "/calendar/[redacted].ics"
  );
  assert.equal(
    sanitizeRequestUrl("/auth/callback?code=code-secret&state=state-secret"),
    "/auth/callback?[redacted]"
  );
  assert.equal(
    sanitizeRequestUrl("/api/session"),
    "/api/session"
  );
  assert.equal(
    sanitizeRequestUrl("/api/session?access_token=access-secret&from=2026-01-01&client_secret=client-secret"),
    "/api/session?access_token=[redacted]&from=2026-01-01&client_secret=[redacted]"
  );
  assert.equal(
    sanitizeRequestUrl("/auth/logout?id_token_hint=id-secret&state=state-secret"),
    "/auth/logout?id_token_hint=[redacted]&state=[redacted]"
  );
});
