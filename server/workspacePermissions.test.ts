import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import test from "node:test";
import Database from "better-sqlite3";
import type { ApiCareParty, ApiChild, ApiScheduleEntry, ApiSession } from "../shared/api.js";

const projectRoot = resolve(process.cwd());
const ownerHeaders = identityHeaders("subject-owner", "/betreuungskalender/admins");
const adminHeaders = identityHeaders("subject-admin", "/betreuungskalender/admins");
const schedulerHeaders = identityHeaders("subject-scheduler", "/betreuungskalender/parents");
const viewerHeaders = identityHeaders("subject-viewer", "/betreuungskalender/readers");

function identityHeaders(subject: string, group: string): Record<string, string> {
  return {
    "x-auth-request-user": subject,
    "x-auth-request-preferred-username": subject.replace("subject-", ""),
    "x-auth-request-groups": group
  };
}

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForHealth(baseUrl: string, logs: () => string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {
      // Runtime is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
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

async function request(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers
    }
  });
}

async function jsonRequest<T>(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  init: RequestInit = {}
): Promise<T> {
  const response = await request(baseUrl, path, headers, init);
  if (!response.ok) assert.fail(`${response.status} ${await response.text()}`);
  return await response.json() as T;
}

test("workspace roles enforce restricted projections and scheduler writes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "betreuungskalender-workspace-permissions-"));
  const databasePath = join(root, "app.sqlite");
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
        AUTH_MODE: "trusted-proxy",
        REQUIRE_AUTH: "true",
        TRUST_PROXY_AUTH: "true",
        TRUSTED_PROXY_CIDRS: "127.0.0.1/32",
        OIDC_REQUIRE_ROLE_CLAIM: "true",
        HOST: "127.0.0.1",
        PORT: String(port),
        DATABASE_PATH: databasePath,
        BACKUP_DIR: join(root, "backups"),
        RATE_LIMIT_MAX: "500",
        RATE_LIMIT_WRITE_MAX: "500",
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
  await waitForHealth(baseUrl, () => logs);

  const ownerSession = await jsonRequest<ApiSession>(baseUrl, "/api/session", ownerHeaders);
  const adminSession = await jsonRequest<ApiSession>(baseUrl, "/api/session", adminHeaders);
  const schedulerSession = await jsonRequest<ApiSession>(baseUrl, "/api/session", schedulerHeaders);
  const viewerSession = await jsonRequest<ApiSession>(baseUrl, "/api/session", viewerHeaders);
  assert(ownerSession.user && adminSession.user && schedulerSession.user && viewerSession.user);

  const child = await jsonRequest<ApiChild>(baseUrl, "/api/children", ownerHeaders, {
    method: "POST",
    body: JSON.stringify({ name: "Test child", birthMonth: 4, birthYear: 2018, color: "#0d9488" })
  });
  const assignedParty = await jsonRequest<ApiCareParty>(baseUrl, "/api/care-parties", ownerHeaders, {
    method: "POST",
    body: JSON.stringify({ name: "Assigned caregiver", kind: "other" })
  });
  const unassignedParty = await jsonRequest<ApiCareParty>(baseUrl, "/api/care-parties", ownerHeaders, {
    method: "POST",
    body: JSON.stringify({ name: "Other caregiver", kind: "other" })
  });

  const database = new Database(databasePath);
  database.pragma("foreign_keys = ON");
  const timestamp = "2026-07-27T10:00:00.000Z";
  database.transaction(() => {
    database.prepare(`
      INSERT INTO settings (key, value_json, created_by, updated_by, created_at, updated_at)
      VALUES ('setup.ownerUserId', ?, ?, ?, ?, ?)
    `).run(JSON.stringify(ownerSession.user?.id), ownerSession.user?.id, ownerSession.user?.id, timestamp, timestamp);
    const setRole = database.prepare(`
      INSERT INTO app_memberships (
        id, user_id, role, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    setRole.run("membership-owner", ownerSession.user?.id, "admin", ownerSession.user?.id, ownerSession.user?.id, timestamp, timestamp);
    setRole.run("membership-admin", adminSession.user?.id, "admin", ownerSession.user?.id, ownerSession.user?.id, timestamp, timestamp);
    setRole.run("membership-scheduler", schedulerSession.user?.id, "scheduler", ownerSession.user?.id, ownerSession.user?.id, timestamp, timestamp);
    setRole.run("membership-viewer", viewerSession.user?.id, "viewer", ownerSession.user?.id, ownerSession.user?.id, timestamp, timestamp);
    database.prepare(`
      INSERT INTO app_user_care_party_assignments (
        id, user_id, care_party_id, created_by, updated_by, created_at, updated_at
      ) VALUES ('scheduler-assignment', ?, ?, ?, ?, ?, ?)
    `).run(
      schedulerSession.user?.id,
      assignedParty.id,
      ownerSession.user?.id,
      ownerSession.user?.id,
      timestamp,
      timestamp
    );
  })();
  database.close();

  const effectiveScheduler = await jsonRequest<ApiSession>(baseUrl, "/api/session", schedulerHeaders);
  assert.equal(effectiveScheduler.workspaceRole, "scheduler");
  assert.equal(effectiveScheduler.permissions?.includes("children:view-sensitive"), false);

  assert.equal((await request(baseUrl, "/api/children", schedulerHeaders)).status, 403);
  const childSummary = await jsonRequest<Array<Record<string, unknown>>>(baseUrl, "/api/children/summary", schedulerHeaders);
  assert.deepEqual(Object.keys(childSummary[0] ?? {}).sort(), ["color", "id", "name"]);
  assert.equal((await request(baseUrl, "/api/settings", schedulerHeaders)).status, 403);
  assert.equal((await request(baseUrl, "/api/app-data", schedulerHeaders)).status, 403);

  const input = {
    startDateTime: "2030-07-04T16:00:00.000Z",
    endDateTime: "2030-07-04T18:00:00.000Z",
    childIds: [child.id],
    responsiblePartyId: assignedParty.id,
    location: "school"
  };
  const created = await jsonRequest<ApiScheduleEntry>(baseUrl, "/api/care-entries", schedulerHeaders, {
    method: "POST",
    body: JSON.stringify(input)
  });
  assert.deepEqual(Object.keys(created).sort(), [
    "children",
    "endDateTime",
    "hasConflict",
    "id",
    "location",
    "responsibleParty",
    "startDateTime",
    "status"
  ]);
  assert.equal(created.status, "planned");
  assert.equal("notes" in created, false);
  assert.equal("createdBy" in created, false);

  const sensitiveWrite = await request(baseUrl, "/api/care-entries", schedulerHeaders, {
    method: "POST",
    body: JSON.stringify({ ...input, notes: "must not be accepted" })
  });
  assert.equal(sensitiveWrite.status, 400);
  const unassignedWrite = await request(baseUrl, "/api/care-entries", schedulerHeaders, {
    method: "POST",
    body: JSON.stringify({ ...input, responsiblePartyId: unassignedParty.id })
  });
  assert.equal(unassignedWrite.status, 403);
  const historicalWrite = await request(baseUrl, "/api/care-entries", schedulerHeaders, {
    method: "POST",
    body: JSON.stringify({
      ...input,
      startDateTime: "2020-07-04T16:00:00.000Z",
      endDateTime: "2020-07-04T18:00:00.000Z"
    })
  });
  assert.equal(historicalWrite.status, 403);
  assert.equal((await request(baseUrl, `/api/care-entries/${created.id}`, schedulerHeaders)).status, 403);
  assert.equal((await request(baseUrl, `/api/care-entries/${created.id}`, schedulerHeaders, {
    method: "PUT",
    body: JSON.stringify({ ...input, startDateTime: "2030-07-04T17:00:00.000Z", endDateTime: "2030-07-04T19:00:00.000Z" })
  })).status, 200);
  assert.equal((await request(baseUrl, `/api/care-entries/${created.id}`, schedulerHeaders, { method: "DELETE" })).status, 403);

  assert.equal((await request(baseUrl, "/api/care-entries", viewerHeaders, {
    method: "POST",
    body: JSON.stringify(input)
  })).status, 403);
  assert.equal((await request(baseUrl, "/api/care-entries/schedule", viewerHeaders)).status, 200);

  const customLocationEntry = await jsonRequest<{ id: string }>(baseUrl, "/api/care-entries", ownerHeaders, {
    method: "POST",
    body: JSON.stringify({
      ...input,
      startDateTime: "2030-07-05T16:00:00.000Z",
      endDateTime: "2030-07-05T18:00:00.000Z",
      status: "planned",
      location: "other",
      customLocation: "Private address"
    })
  });
  const restrictedSchedule = await jsonRequest<ApiScheduleEntry[]>(
    baseUrl,
    "/api/care-entries/schedule?startDate=2030-07-05&endDate=2030-07-05",
    schedulerHeaders
  );
  const restrictedCustomLocation = restrictedSchedule.find((entry) => entry.id === customLocationEntry.id);
  assert(restrictedCustomLocation);
  assert.equal("location" in restrictedCustomLocation, false);

  const conflictDatabase = new Database(databasePath);
  conflictDatabase.pragma("foreign_keys = ON");
  conflictDatabase.transaction(() => {
    const insertEntry = conflictDatabase.prepare(`
      INSERT INTO care_entries (
        id, start_datetime, end_datetime, status, care_scope,
        duration_minutes, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, 'planned', 'hourly', 120, ?, ?, ?, ?)
    `);
    const insertChildLink = conflictDatabase.prepare(`
      INSERT INTO care_entry_children (
        care_entry_id, child_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?)
    `);
    for (let index = 0; index < 101; index += 1) {
      const entryId = `entry-conflict-limit-${index}`;
      insertEntry.run(
        entryId,
        "2031-01-02T16:00:00.000Z",
        "2031-01-02T18:00:00.000Z",
        ownerSession.user?.id,
        ownerSession.user?.id,
        timestamp,
        timestamp
      );
      insertChildLink.run(entryId, child.id, timestamp, timestamp);
    }
  })();
  conflictDatabase.close();
  assert.equal((await request(
    baseUrl,
    "/api/care-entries/schedule?startDate=2031-01-02&endDate=2031-01-02",
    schedulerHeaders
  )).status, 200);

  assert.equal((await request(baseUrl, "/api/members", adminHeaders)).status, 403);
  assert.equal((await request(baseUrl, "/api/settings", adminHeaders)).status, 200);
  const adminSettings = await jsonRequest<Record<string, unknown>>(baseUrl, "/api/settings", adminHeaders);
  assert.equal("setup.ownerUserId" in adminSettings, false);
  assert.equal((await request(baseUrl, "/api/settings", adminHeaders, {
    method: "PUT",
    body: JSON.stringify({ "setup.ownerUserId": adminSession.user.id })
  })).status, 400);
  assert.equal((await request(baseUrl, "/api/members", adminHeaders)).status, 403);
  assert.equal((await request(baseUrl, "/api/app-data", adminHeaders, {
    method: "DELETE"
  })).status, 403);
  assert.equal((await request(baseUrl, "/api/members", ownerHeaders)).status, 200);

  const feed = await jsonRequest<{ feedUrl: string }>(baseUrl, "/api/calendar-feed", adminHeaders, {
    method: "POST",
    body: JSON.stringify({ scope: "all" })
  });
  assert.equal((await fetch(feed.feedUrl)).status, 200);
  assert.equal((await request(
    baseUrl,
    `/api/members/${encodeURIComponent(adminSession.user.id)}/role`,
    ownerHeaders,
    { method: "PUT", body: JSON.stringify({ role: "editor" }) }
  )).status, 200);
  const editorFeed = await fetch(feed.feedUrl);
  assert.equal(editorFeed.status, 200);
  assert.equal((await editorFeed.text()).includes("BEGIN:VEVENT"), false);
  assert.equal((await request(
    baseUrl,
    `/api/members/${encodeURIComponent(adminSession.user.id)}/role`,
    ownerHeaders,
    { method: "PUT", body: JSON.stringify({ role: "viewer" }) }
  )).status, 200);
  assert.equal((await fetch(feed.feedUrl)).status, 404);

  assert.equal((await request(baseUrl, "/api/app-data", ownerHeaders, { method: "DELETE" })).status, 204);
  assert.equal((await request(baseUrl, "/api/members", ownerHeaders)).status, 200);
  assert.equal((await request(baseUrl, "/api/members", adminHeaders)).status, 403);

  assert.equal((await request(
    baseUrl,
    `/api/members/${encodeURIComponent(schedulerSession.user.id)}`,
    ownerHeaders,
    { method: "DELETE" }
  )).status, 200);
  assert.equal((await request(baseUrl, "/api/care-entries/schedule", schedulerHeaders)).status, 403);
});
