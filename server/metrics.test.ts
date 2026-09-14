import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { createSqlitePersistenceRuntime } from "./db/runtime.js";
import { RuntimeMetrics, startMetricsListener } from "./metrics.js";

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

test("keeps the metrics listener disabled by default", async () => {
  const persistence = createSqlitePersistenceRuntime(":memory:");
  const metrics = new RuntimeMetrics(persistence);
  assert.equal(await startMetricsListener({
    enabled: false,
    host: "127.0.0.1",
    port: await freePort()
  }, metrics), undefined);
  await persistence.close();
});

test("requires a file-backed bearer token and exposes only private aggregate metrics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "betreuungskalender-metrics-"));
  const token = "fictional-metrics-token-with-at-least-32-characters";
  const tokenFile = join(directory, "token");
  await writeFile(tokenFile, `${token}\n`, { mode: 0o600 });
  const persistence = createSqlitePersistenceRuntime(":memory:");
  await persistence.migrate();
  const metrics = new RuntimeMetrics(persistence);
  const app = Fastify();
  metrics.install(app);
  app.get<{ Params: { id: string } }>("/api/children/:id", async () => ({ ok: true }));
  await app.inject({ method: "GET", url: "/api/children/fictional-sensitive-child" });
  metrics.recordBackgroundJob("success");

  const port = await freePort();
  const listener = await startMetricsListener({
    enabled: true,
    host: "127.0.0.1",
    port,
    bearerTokenFile: tokenFile
  }, metrics);
  assert.ok(listener);
  try {
    const unauthorized = await fetch(`http://127.0.0.1:${port}/metrics`);
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("cache-control"), "no-store");

    const unknown = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(unknown.status, 404);

    const response = await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /betreuungskalender_process_uptime_seconds/);
    assert.match(body, /route="\/api\/children\/:id"/);
    assert.match(body, /status_class="2xx"/);
    assert.match(body, /betreuungskalender_database_reachable 1/);
    assert.match(body, /job="care_confirmation_sweep",outcome="success"/);
    for (const sensitive of [token, "fictional-sensitive-child", "example.test", "request-id"]) {
      assert.ok(!body.includes(sensitive));
    }
  } finally {
    await listener.close();
    await app.close();
    await persistence.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("fails closed when the configured metrics secret is unavailable", async () => {
  const persistence = createSqlitePersistenceRuntime(":memory:");
  const metrics = new RuntimeMetrics(persistence);
  await assert.rejects(
    startMetricsListener({
      enabled: true,
      host: "127.0.0.1",
      port: await freePort(),
      bearerTokenFile: "/does/not/exist"
    }, metrics),
    (error: unknown) => Boolean(error && typeof error === "object" &&
      "code" in error && error.code === "metrics_secret_unavailable")
  );
  await persistence.close();
});
