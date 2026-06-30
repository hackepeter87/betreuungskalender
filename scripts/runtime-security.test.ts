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
        OIDC_REQUIRE_ROLE_CLAIM: "true",
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
    headers: {
      "x-auth-request-user": "subject-parent",
      "x-auth-request-email": "parent@example.net",
      "x-auth-request-groups": "/betreuungskalender/parents"
    }
  });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), {
    authRequired: true,
    authenticated: true,
    user: {
      id: "user_6f4c7289801c623dbaf3e32b",
      displayName: "parent",
      role: "parent",
      email: "parent@example.net"
    },
    logoutUrl: "/oauth2/sign_out"
  });

  const readOnlyRead = await fetch(`${baseUrl}/api/children`, {
    headers: {
      "x-auth-request-user": "subject-reader",
      "x-auth-request-email": "reader@example.net",
      "x-auth-request-groups": "/betreuungskalender/readers"
    }
  });
  assert.equal(readOnlyRead.status, 200);

  const readOnlyWrite = await fetch(`${baseUrl}/api/children`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-auth-request-user": "subject-reader",
      "x-auth-request-email": "reader@example.net",
      "x-auth-request-groups": "/betreuungskalender/readers"
    },
    body: JSON.stringify({
      name: "Readonly Child",
      birthMonth: 1,
      birthYear: 2016,
      color: "#2563eb"
    })
  });
  assert.equal(readOnlyWrite.status, 403);
  assert.deepEqual(await readOnlyWrite.json(), {
    error: "forbidden",
    message: "Für diese Aktion fehlt die erforderliche Berechtigung."
  });
});

test("runtime enforces the OIDC authorization matrix across endpoint classes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "betreuungskalender-oidc-matrix-"));
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
        OIDC_REQUIRE_ROLE_CLAIM: "false",
        ALLOWED_ORIGIN: "https://allowed.example.test",
        LOG_LEVEL: "warn",
        RATE_LIMIT_MAX: "200",
        RATE_LIMIT_WRITE_MAX: "200",
        RATE_LIMIT_SENSITIVE_MAX: "200",
        RATE_LIMIT_EXPORT_MAX: "200"
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

  const roleHeaders = (subject: string, groups?: string) => ({
    "x-auth-request-user": subject,
    "x-auth-request-email": `${subject}@example.net`,
    "x-auth-request-preferred-username": subject,
    ...(groups ? { "x-auth-request-groups": groups } : {})
  });
  const childInput = (name: string) => ({
    name,
    birthMonth: 1,
    birthYear: 2016,
    color: "#2563eb"
  });
  const jsonHeaders = (headers: Record<string, string>) => ({
    "content-type": "application/json",
    ...headers
  });
  const request = (path: string, init?: RequestInit) =>
    fetch(`${baseUrl}${path}`, init);

  const unauthenticatedRead = await request("/api/children");
  assert.equal(unauthenticatedRead.status, 401);
  assert.deepEqual(await unauthenticatedRead.json(), {
    error: "authentication_required",
    message: "Authentifizierung erforderlich."
  });

  const readonlyHeaders = roleHeaders(
    "readonly-user",
    "/betreuungskalender/readers"
  );
  const parentHeaders = roleHeaders(
    "parent-user",
    "/betreuungskalender/parents"
  );
  const adminHeaders = roleHeaders(
    "admin-user",
    "/betreuungskalender/admins"
  );
  const fallbackHeaders = roleHeaders("fallback-user", "/unknown/group");

  const sessionCases = [
    { expectedRole: "readonly", headers: readonlyHeaders },
    { expectedRole: "parent", headers: parentHeaders },
    { expectedRole: "admin", headers: adminHeaders },
    { expectedRole: "parent", headers: fallbackHeaders }
  ] as const;
  for (const { expectedRole, headers } of sessionCases) {
    const response = await request("/api/session", { headers });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      authenticated: boolean;
      user: { id: string; displayName: string; role: string; email?: string };
      logoutUrl?: string;
    };
    assert.equal(body.authenticated, true);
    assert.match(body.user.id, /^user_[0-9a-f]{24}$/);
    assert.equal(body.user.displayName, headers["x-auth-request-preferred-username"]);
    assert.equal(body.user.role, expectedRole);
    assert.equal(body.user.email, headers["x-auth-request-email"]);
    assert.equal(body.logoutUrl, "/oauth2/sign_out");
  }

  for (const headers of [readonlyHeaders, parentHeaders, adminHeaders, fallbackHeaders]) {
    assert.equal((await request("/api/children", { headers })).status, 200);
  }

  const readonlyWrite = await request("/api/children", {
    method: "POST",
    headers: jsonHeaders(readonlyHeaders),
    body: JSON.stringify(childInput("Readonly Matrix Child"))
  });
  assert.equal(readonlyWrite.status, 403);

  const parentWrite = await request("/api/children", {
    method: "POST",
    headers: jsonHeaders(parentHeaders),
    body: JSON.stringify(childInput("Parent Matrix Child"))
  });
  assert.equal(parentWrite.status, 201);

  const adminWrite = await request("/api/children", {
    method: "POST",
    headers: jsonHeaders(adminHeaders),
    body: JSON.stringify(childInput("Admin Matrix Child"))
  });
  assert.equal(adminWrite.status, 201);

  const fallbackWrite = await request("/api/children", {
    method: "POST",
    headers: jsonHeaders(fallbackHeaders),
    body: JSON.stringify(childInput("Fallback Matrix Child"))
  });
  assert.equal(fallbackWrite.status, 201);

  for (const headers of [readonlyHeaders, parentHeaders, fallbackHeaders]) {
    assert.equal((await request("/api/app-data", {
      method: "DELETE",
      headers
    })).status, 403);
    assert.equal((await request("/api/migration/legacy-detected", {
      method: "POST",
      headers: jsonHeaders(headers),
      body: JSON.stringify({ fingerprint: "synthetic-fingerprint" })
    })).status, 403);
  }

  assert.equal((await request("/api/migration/legacy-detected", {
    method: "POST",
    headers: jsonHeaders(adminHeaders),
    body: JSON.stringify({ fingerprint: "synthetic-fingerprint" })
  })).status, 204);

  assert.equal((await request("/api/app-data", {
    method: "DELETE",
    headers: adminHeaders
  })).status, 204);
});

test("runtime rejects users without matching OIDC groups when strict role claims are required", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "betreuungskalender-oidc-strict-"));
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
        OIDC_REQUIRE_ROLE_CLAIM: "true",
        ALLOWED_ORIGIN: "https://allowed.example.test",
        LOG_LEVEL: "warn",
        RATE_LIMIT_MAX: "200",
        RATE_LIMIT_WRITE_MAX: "200",
        RATE_LIMIT_SENSITIVE_MAX: "200",
        RATE_LIMIT_EXPORT_MAX: "200"
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
  const noMatchingRoleHeaders = {
    "x-auth-request-user": "strict-user",
    "x-auth-request-email": "strict-user@example.net",
    "x-auth-request-groups": "/unknown/group"
  };

  const session = await fetch(`${baseUrl}/api/session`, {
    headers: noMatchingRoleHeaders
  });
  assert.equal(session.status, 403);
  assert.deepEqual(await session.json(), {
    error: "authorization_required",
    message: "Keine passende Berechtigung in den OIDC-Claims gefunden."
  });

  const read = await fetch(`${baseUrl}/api/children`, {
    headers: noMatchingRoleHeaders
  });
  assert.equal(read.status, 403);

  const write = await fetch(`${baseUrl}/api/children`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...noMatchingRoleHeaders
    },
    body: JSON.stringify({
      name: "Strict Matrix Child",
      birthMonth: 1,
      birthYear: 2016,
      color: "#2563eb"
    })
  });
  assert.equal(write.status, 403);
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
