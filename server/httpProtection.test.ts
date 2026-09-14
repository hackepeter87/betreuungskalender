import assert from "node:assert/strict";
import Fastify from "fastify";
import test from "node:test";
import {
  assertBrowserRequestOrigin,
  browserRequestOriginGuard,
  preventSensitiveResponseCaching
} from "./httpProtection.js";

const allowedOrigin = "https://app.example.invalid";

test("sensitive responses carry consistent no-store headers", async () => {
  const app = Fastify({ logger: false });
  app.get("/sensitive", async (_request, reply) =>
    preventSensitiveResponseCaching(reply).send({ ok: true }));

  const response = await app.inject({ method: "GET", url: "/sensitive" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store, max-age=0");
  assert.equal(response.headers.pragma, "no-cache");
  assert.equal(response.headers.expires, "0");
  await app.close();
});

test("browser origin guard accepts same-origin and non-browser requests", async () => {
  const app = Fastify({ logger: false });
  app.post("/action", {
    preHandler: browserRequestOriginGuard(allowedOrigin)
  }, async () => ({ ok: true }));

  for (const headers of [
    {},
    { origin: allowedOrigin },
    { referer: `${allowedOrigin}/settings` },
    { "sec-fetch-site": "same-origin" },
    { "sec-fetch-site": "none" }
  ]) {
    const response = await app.inject({ method: "POST", url: "/action", headers });
    assert.equal(response.statusCode, 200);
  }
  await app.close();
});

test("browser origin guard rejects foreign or malformed browser metadata", () => {
  for (const headers of [
    { origin: "https://foreign.example.invalid" },
    { referer: "https://foreign.example.invalid/settings" },
    { referer: "not-a-url" },
    { "sec-fetch-site": "same-site" },
    { "sec-fetch-site": "cross-site" }
  ]) {
    assert.throws(
      () => assertBrowserRequestOrigin({ headers }, allowedOrigin),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "origin_not_allowed");
        assert.equal((error as { statusCode?: number }).statusCode, 403);
        return true;
      }
    );
  }
});
