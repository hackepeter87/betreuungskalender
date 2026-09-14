import assert from "node:assert/strict";
import test from "node:test";
import Fastify, { LogController } from "fastify";
import { Writable } from "node:stream";
import {
  createRequestId,
  installRequestDiagnostics,
  logRedactionPaths,
  normalizedRequestRoute,
  safeErrorCode
} from "./logging.js";

test("request identifiers accept only bounded inert values", () => {
  assert.equal(createRequestId("trusted-request_123", () => "generated"), "trusted-request_123");
  assert.equal(createRequestId("short", () => "generated"), "generated");
  assert.equal(createRequestId("line-break\nvalue", () => "generated"), "generated");
  assert.equal(createRequestId("x".repeat(65), () => "generated"), "generated");
  assert.equal(createRequestId(["one", "two"], () => "generated"), "generated");
});

test("error codes are bounded and discard message content", () => {
  assert.equal(safeErrorCode({ code: "database_unavailable", message: "private value" }), "database_unavailable");
  assert.equal(safeErrorCode({ code: "invalid code with spaces" }), "unknown");
  assert.equal(safeErrorCode(new Error("private value")), "unknown");
});

test("request diagnostics return the identifier and use route templates", async () => {
  const logLines: string[] = [];
  const logStream = new Writable({
    write(chunk, _encoding, callback) {
      logLines.push(String(chunk));
      callback();
    }
  });
  const app = Fastify({
    logController: new LogController({
      disableRequestLogging: true,
      requestIdLogLabel: "requestId"
    }),
    logger: {
      level: "info",
      stream: logStream,
      redact: { paths: [...logRedactionPaths], censor: "[redacted]" }
    },
    genReqId(request) {
      return createRequestId(request.headers["x-request-id"], () => "generated-request-id");
    }
  });
  installRequestDiagnostics(app);
  app.get<{ Params: { id: string } }>("/items/:id", async (request) => ({
    route: normalizedRequestRoute(request)
  }));

  const response = await app.inject({
    method: "GET",
    url: "/items/private-value?token=private-token",
    headers: { "x-request-id": "upstream-request-123" }
  });

  assert.equal(response.headers["x-request-id"], "upstream-request-123");
  assert.deepEqual(response.json(), { route: "/items/:id" });
  app.log.info({
    token: "setup-secret",
    clientSecret: "oidc-client-secret",
    nonce: "oidc-nonce",
    invitationUrl: "https://example.invalid/invite?token=invite-secret",
    feedUrl: "https://example.invalid/calendar/feed-secret.ics",
    filename: "private-export.json",
    email: "person@example.invalid",
    displayName: "Private Person",
    notes: "private care note"
  }, "redaction fixture");

  const loadStartedAt = performance.now();
  for (let index = 0; index < 100; index += 1) {
    const loadResponse = await app.inject({ method: "GET", url: `/items/${index}` });
    assert.equal(loadResponse.statusCode, 200);
  }
  const loadDurationMs = performance.now() - loadStartedAt;
  await app.close();
  const output = logLines.join("");
  assert.match(output, /http\.request\.completed/);
  assert.match(output, /\/items\/:id/);
  assert.doesNotMatch(
    output,
    /private-value|private-token|setup-secret|oidc-client-secret|oidc-nonce|invite-secret|feed-secret|private-export|person@example|Private Person|private care note/
  );
  const completionLogs = logLines.filter((line) => line.includes("http.request.completed"));
  assert.equal(completionLogs.length, 101);
  assert.equal(completionLogs.every((line) => Buffer.byteLength(line) < 1_024), true);
  assert.equal(loadDurationMs < 10_000, true, `request logging load took ${loadDurationMs}ms`);
});
