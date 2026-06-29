import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "..");

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const { port } = address;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForHealth(url: string, logs: () => string): Promise<Response> {
  const deadline = Date.now() + 15_000;
  let latestError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      latestError = `HTTP ${response.status}`;
    } catch (error) {
      latestError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  throw new Error(`Runtime did not become healthy: ${latestError}\n${logs()}`);
}

async function stop(process: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([
    once(process, "exit"),
    new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 5_000))
  ]);
  if (process.exitCode === null) process.kill("SIGKILL");
}

test("production runtime sends documented security headers and restrictive CORS", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "betreuungskalender-security-"));
  const port = await freePort();
  let logs = "";
  const runtime = spawn(
    process.execPath,
    [resolve(projectRoot, "node_modules/tsx/dist/cli.mjs"), "server/index.ts"],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: String(port),
        DATABASE_PATH: join(root, "app.sqlite"),
        BACKUP_DIR: join(root, "backups"),
        REQUIRE_AUTH: "false",
        TRUST_PROXY_AUTH: "false",
        ALLOWED_ORIGIN: "https://allowed.example.test",
        LOG_LEVEL: "warn"
      }
    }
  );
  runtime.stdout.on("data", (chunk) => { logs += chunk; });
  runtime.stderr.on("data", (chunk) => { logs += chunk; });

  t.after(async () => {
    await stop(runtime);
    await rm(root, { recursive: true, force: true });
  });

  const healthUrl = `http://127.0.0.1:${port}/api/health`;
  const health = await waitForHealth(healthUrl, () => logs);
  assert.equal(health.status, 200);
  const healthBody = await health.json() as Record<string, unknown>;
  assert.equal(healthBody.status, "ok");
  assert.equal(healthBody.databaseReachable, true);
  assert.equal(typeof healthBody.version, "string");
  assert.equal(typeof healthBody.timestamp, "string");
  assert.match(health.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  assert.equal(health.headers.get("x-frame-options"), "DENY");
  assert.equal(health.headers.get("referrer-policy"), "no-referrer");
  assert.notEqual(health.headers.get("access-control-allow-origin"), "*");
  assert.equal(health.headers.get("authorization"), null);
  assert.equal(health.headers.get("set-cookie"), null);

  const allowed = await fetch(healthUrl, {
    headers: { origin: "https://allowed.example.test" }
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://allowed.example.test");

  const preflight = await fetch(healthUrl, {
    method: "OPTIONS",
    headers: {
      origin: "https://allowed.example.test",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type"
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://allowed.example.test");
  assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /POST/);

  const disallowed = await fetch(healthUrl, {
    headers: { origin: "https://disallowed.example.test" }
  });
  assert.equal(disallowed.status, 403);
  assert.deepEqual(await disallowed.json(), {
    error: "origin_not_allowed",
    message: "Diese Herkunft ist nicht zugelassen."
  });

  const missingApi = await fetch(`http://127.0.0.1:${port}/api/not-found`, {
    headers: { origin: "https://allowed.example.test" }
  });
  assert.equal(missingApi.status, 404);
  const missingBody = await missingApi.text();
  assert.doesNotMatch(missingBody, /stack|sqlite|node_modules|server\//i);
  assert.equal(missingApi.headers.get("access-control-allow-origin"), "https://allowed.example.test");
});

test("runtime exposes compact session metadata for trusted proxy auth", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "betreuungskalender-session-"));
  const port = await freePort();
  let logs = "";
  const runtime = spawn(
    process.execPath,
    [resolve(projectRoot, "node_modules/tsx/dist/cli.mjs"), "server/index.ts"],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: String(port),
        DATABASE_PATH: join(root, "app.sqlite"),
        BACKUP_DIR: join(root, "backups"),
        REQUIRE_AUTH: "true",
        TRUST_PROXY_AUTH: "true",
        AUTH_LOGOUT_URL: "/oauth2/sign_out",
        ALLOWED_ORIGIN: "https://allowed.example.test",
        LOG_LEVEL: "warn"
      }
    }
  );
  runtime.stdout.on("data", (chunk) => { logs += chunk; });
  runtime.stderr.on("data", (chunk) => { logs += chunk; });

  t.after(async () => {
    await stop(runtime);
    await rm(root, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(`${baseUrl}/api/health`, () => logs);

  const missingIdentity = await fetch(`${baseUrl}/api/session`);
  assert.equal(missingIdentity.status, 401);

  const session = await fetch(`${baseUrl}/api/session`, {
    headers: { "x-auth-request-email": "parent@example.net" }
  });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), {
    authRequired: true,
    authenticated: true,
    user: { displayName: "parent" },
    logoutUrl: "/oauth2/sign_out"
  });
});

test("production runtime applies central and stricter API rate limits", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "betreuungskalender-rate-limit-"));
  const port = await freePort();
  let logs = "";
  const runtime = spawn(
    process.execPath,
    [resolve(projectRoot, "node_modules/tsx/dist/cli.mjs"), "server/index.ts"],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: String(port),
        DATABASE_PATH: join(root, "app.sqlite"),
        BACKUP_DIR: join(root, "backups"),
        REQUIRE_AUTH: "false",
        TRUST_PROXY_AUTH: "true",
        ALLOWED_ORIGIN: "https://allowed.example.test",
        LOG_LEVEL: "warn",
        RATE_LIMIT_MAX: "2",
        RATE_LIMIT_WRITE_MAX: "1",
        RATE_LIMIT_SENSITIVE_MAX: "1",
        RATE_LIMIT_EXPORT_MAX: "1",
        RATE_LIMIT_WINDOW_MS: "60000"
      }
    }
  );
  runtime.stdout.on("data", (chunk) => { logs += chunk; });
  runtime.stderr.on("data", (chunk) => { logs += chunk; });

  t.after(async () => {
    await stop(runtime);
    await rm(root, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(`${baseUrl}/api/health`, () => logs);
  const request = (path: string, ip: string, init?: RequestInit) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "x-forwarded-for": ip, ...init?.headers }
    });

  assert.equal((await request("/api/children", "198.51.100.1")).status, 200);
  assert.equal((await request("/api/children", "198.51.100.1")).status, 200);
  const defaultExceeded = await request("/api/children", "198.51.100.1");
  assert.equal(defaultExceeded.status, 429);
  assert.equal(defaultExceeded.headers.get("x-ratelimit-limit"), "2");
  assert.deepEqual(await defaultExceeded.json(), {
    error: "rate_limit_exceeded",
    message: "Zu viele Anfragen. Bitte später erneut versuchen."
  });

  const childInput = {
    name: "Rate Limit Child",
    birthMonth: 1,
    birthYear: 2016,
    color: "#2563eb"
  };
  assert.equal((await request("/api/children", "198.51.100.2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(childInput)
  })).status, 201);
  const writeExceeded = await request("/api/children", "198.51.100.2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(childInput)
  });
  assert.equal(writeExceeded.status, 429);
  assert.equal(writeExceeded.headers.get("x-ratelimit-limit"), "1");

  assert.equal((await request("/api/migration/legacy-summary", "198.51.100.3")).status, 200);
  assert.equal((await request("/api/migration/legacy-summary", "198.51.100.3")).status, 429);

  assert.equal((await request("/api/external-calendar-events/export", "198.51.100.4")).status, 200);
  assert.equal((await request("/api/external-calendar-events/export", "198.51.100.4")).status, 429);
});
