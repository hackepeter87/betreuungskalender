import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import test from "node:test";
import type { ApiCareConflict, ApiCareEntry, ApiCareParty, ApiChild } from "../shared/api.js";
import { detectCareConflicts } from "./services/careConflicts.js";

const projectRoot = resolve(import.meta.dirname, "..");

function entry(overrides: Partial<Parameters<typeof detectCareConflicts>[0][number]> = {}) {
  return {
    id: "entry-a",
    status: "planned" as const,
    startDateTime: "2026-07-04T16:00:00.000Z",
    endDateTime: "2026-07-04T18:00:00.000Z",
    childIds: ["child-a"],
    ...overrides
  };
}

test("detects planned overlaps and merges shared child context", () => {
  const conflicts = detectCareConflicts([
    entry({ childIds: ["child-a", "child-b"] }),
    entry({ id: "entry-b", startDateTime: "2026-07-04T17:00:00.000Z", childIds: ["child-a", "child-b"] })
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]?.severity, "planned_warning");
  assert.deepEqual(conflicts[0]?.entryIds, ["entry-a", "entry-b"]);
  assert.deepEqual(conflicts[0]?.childIds, ["child-a", "child-b"]);
  assert.equal(conflicts[0]?.startDateTime, "2026-07-04T17:00:00.000Z");
  assert.equal(conflicts[0]?.endDateTime, "2026-07-04T18:00:00.000Z");
});

test("uses actual children and time for partial-care conflicts", () => {
  const conflicts = detectCareConflicts([
    entry({
      status: "partial",
      actualStartDateTime: "2026-07-04T17:00:00.000Z",
      actualEndDateTime: "2026-07-04T19:00:00.000Z",
      actualChildIds: ["child-b"]
    }),
    entry({
      id: "entry-b",
      status: "completed",
      startDateTime: "2026-07-04T18:00:00.000Z",
      endDateTime: "2026-07-04T20:00:00.000Z",
      childIds: ["child-b"]
    })
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]?.severity, "unresolved_actual");
  assert.deepEqual(conflicts[0]?.childIds, ["child-b"]);
  assert.equal(conflicts[0]?.startDateTime, "2026-07-04T18:00:00.000Z");
  assert.equal(conflicts[0]?.endDateTime, "2026-07-04T19:00:00.000Z");
});

test("ignores adjacent, cancelled, and different-child entries", () => {
  const conflicts = detectCareConflicts([
    entry({ status: "completed" }),
    entry({
      id: "entry-adjacent",
      status: "completed",
      startDateTime: "2026-07-04T18:00:00.000Z",
      endDateTime: "2026-07-04T20:00:00.000Z"
    }),
    entry({ id: "entry-cancelled", status: "cancelled" }),
    entry({ id: "entry-other-child", status: "completed", childIds: ["child-b"] })
  ]);
  assert.deepEqual(conflicts, []);
});

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  server.close();
  await once(server, "close");
  return address.port;
}

async function waitForHealth(url: string, logs: () => string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Runtime is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  throw new Error(`Runtime did not become healthy.\n${logs()}`);
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

async function jsonRequest<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) {
    assert.fail(`${response.status} ${await response.text()}`);
  }
  return await response.json() as T;
}

test("care-entry API serializes actual writes and returns generic conflicts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "betreuungskalender-care-conflicts-"));
  const port = await freePort();
  let logs = "";
  const runtime = spawn(
    process.execPath,
    [resolve(projectRoot, "node_modules/tsx/dist/cli.mjs"), "server/index.ts"],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: "development",
        AUTH_MODE: "local",
        REQUIRE_AUTH: "false",
        HOST: "127.0.0.1",
        PORT: String(port),
        DATABASE_PATH: join(root, "app.sqlite"),
        BACKUP_DIR: join(root, "backups"),
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
  const child = await jsonRequest<ApiChild>(baseUrl, "/api/children", {
    method: "POST",
    body: JSON.stringify({ name: "Testkind A", birthMonth: 7, birthYear: 2018, color: "#0d9488" })
  });
  const otherChild = await jsonRequest<ApiChild>(baseUrl, "/api/children", {
    method: "POST",
    body: JSON.stringify({ name: "Testkind B", birthMonth: 8, birthYear: 2020, color: "#6967d9" })
  });
  const party = await jsonRequest<ApiCareParty>(baseUrl, "/api/care-parties", {
    method: "POST",
    body: JSON.stringify({ name: "Testbetreuung", kind: "other" })
  });
  const baseInput = {
    startDateTime: "2026-07-04T16:00:00.000Z",
    endDateTime: "2026-07-04T18:00:00.000Z",
    childIds: [child.id],
    responsiblePartyId: party.id,
    status: "completed",
    careScope: "hourly",
    overnight: false,
    schoolHandover: false,
    holiday: false,
    weekend: true,
    additionalCare: false,
    hasEvidence: false,
    trips: [],
    costs: []
  };

  const concurrent = await Promise.all([
    fetch(`${baseUrl}/api/care-entries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(baseInput) }),
    fetch(`${baseUrl}/api/care-entries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(baseInput) })
  ]);
  assert.deepEqual(concurrent.map((response) => response.status).sort(), [201, 409]);
  const rejected = concurrent.find((response) => response.status === 409);
  assert.deepEqual(await rejected?.json(), { error: "care_entry_conflict" });

  const planned = await jsonRequest<ApiCareEntry>(baseUrl, "/api/care-entries", {
    method: "POST",
    body: JSON.stringify({ ...baseInput, status: "planned" })
  });
  const conflicts = await jsonRequest<ApiCareConflict[]>(baseUrl, "/api/care-conflicts");
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]?.severity, "planned_warning");
  assert.equal(conflicts[0]?.entryIds.includes(planned.id), true);

  const actualUpdate = await fetch(`${baseUrl}/api/care-entries/${planned.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...baseInput, status: "completed" })
  });
  assert.equal(actualUpdate.status, 409);
  assert.deepEqual(await actualUpdate.json(), { error: "care_entry_conflict" });

  await jsonRequest<ApiCareEntry>(baseUrl, "/api/care-entries", {
    method: "POST",
    body: JSON.stringify({
      ...baseInput,
      startDateTime: "2026-07-04T18:00:00.000Z",
      endDateTime: "2026-07-04T20:00:00.000Z"
    })
  });
  await jsonRequest<ApiCareEntry>(baseUrl, "/api/care-entries", {
    method: "POST",
    body: JSON.stringify({ ...baseInput, childIds: [otherChild.id] })
  });
});
