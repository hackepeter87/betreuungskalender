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
});
