import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import test from "node:test";
import type { ApiAuditEntry, ApiChild } from "../shared/api.js";

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

async function waitForHealth(url: string, logs: () => string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let latestError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
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

const alphaHeaders = {
  "x-auth-request-user": "subject-alpha",
  "x-auth-request-email": "alpha@example.invalid",
  "x-auth-request-preferred-username": "Alpha Parent",
  "x-auth-request-groups": "/betreuungskalender/parents"
};

const betaHeaders = {
  "x-auth-request-user": "subject-beta",
  "x-auth-request-email": "beta@example.invalid",
  "x-auth-request-preferred-username": "Beta Parent",
  "x-auth-request-groups": "/betreuungskalender/parents"
};

async function jsonRequest<T>(
  baseUrl: string,
  path: string,
  init: RequestInit
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers
    }
  });
  if (!response.ok) {
    assert.fail(`${response.status} ${await response.text()}`);
  }
  return await response.json() as T;
}

test("trusted OIDC users create distinct actor metadata and audit entries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "betreuungskalender-multi-user-"));
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
        RATE_LIMIT_MAX: "200",
        RATE_LIMIT_WRITE_MAX: "200",
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

  const created = await jsonRequest<ApiChild>(baseUrl, "/api/children", {
    method: "POST",
    headers: alphaHeaders,
    body: JSON.stringify({
      name: "Alex Beispiel",
      birthMonth: 4,
      birthYear: 2018,
      color: "#087f7b"
    })
  });
  assert.equal(created.createdBy, "user_aabd54982532b4bcc0d16367");
  assert.equal(created.updatedBy, "user_aabd54982532b4bcc0d16367");

  const updated = await jsonRequest<ApiChild>(
    baseUrl,
    `/api/children/${encodeURIComponent(created.id)}`,
    {
      method: "PUT",
      headers: betaHeaders,
      body: JSON.stringify({
        name: "Alex Muster",
        birthMonth: 4,
        birthYear: 2018,
        color: "#0d9488"
      })
    }
  );
  assert.equal(updated.createdBy, created.createdBy);
  assert.equal(updated.updatedBy, "user_fd650153075906bd17636173");

  const children = await jsonRequest<ApiChild[]>(baseUrl, "/api/children", {
    method: "GET",
    headers: betaHeaders
  });
  assert.deepEqual(children.map((child) => ({
    name: child.name,
    createdBy: child.createdBy,
    updatedBy: child.updatedBy
  })), [{
    name: "Alex Muster",
    createdBy: "user_aabd54982532b4bcc0d16367",
    updatedBy: "user_fd650153075906bd17636173"
  }]);

  const auditEntries = await jsonRequest<ApiAuditEntry[]>(
    baseUrl,
    `/api/audit-log?entityType=child&entityId=${encodeURIComponent(created.id)}&limit=10`,
    {
      method: "GET",
      headers: betaHeaders
    }
  );
  assert.deepEqual(
    auditEntries.map((entry) => ({
      action: entry.action,
      fieldName: entry.fieldName,
      userEmail: entry.userEmail,
      userDisplayName: entry.userDisplayName
    })),
    [
      {
        action: "updated",
        fieldName: "color",
        userEmail: "user_fd650153075906bd17636173",
        userDisplayName: "Beta Parent"
      },
      {
        action: "updated",
        fieldName: "name",
        userEmail: "user_fd650153075906bd17636173",
        userDisplayName: "Beta Parent"
      },
      {
        action: "created",
        fieldName: null,
        userEmail: "user_aabd54982532b4bcc0d16367",
        userDisplayName: "Alpha Parent"
      }
    ]
  );
});
