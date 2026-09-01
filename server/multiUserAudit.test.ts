import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import test from "node:test";
import type {
  ApiAuditEntry,
  ApiCareEntry,
  ApiCareParty,
  ApiChild,
  ApiContactRule,
  ApiSession,
  ApiUnavailablePeriod
} from "../shared/api.js";

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

const adminHeaders = {
  "x-auth-request-user": "subject-admin",
  "x-auth-request-email": "admin@example.invalid",
  "x-auth-request-preferred-username": "Admin User",
  "x-auth-request-groups": "/betreuungskalender/admins"
};

async function jsonRequest<T>(
  baseUrl: string,
  path: string,
  init: RequestInit
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers
    }
  });
  if (!response.ok) {
    assert.fail(`${response.status} ${await response.text()}`);
  }
  return await response.json() as T;
}

async function expectStatus(
  baseUrl: string,
  path: string,
  expectedStatus: number,
  init: RequestInit
): Promise<void> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers
    }
  });
  assert.equal(response.status, expectedStatus, await response.text());
}

async function sessionUserId(
  baseUrl: string,
  headers: Record<string, string>
): Promise<string> {
  const session = await jsonRequest<ApiSession>(baseUrl, "/api/session", {
    method: "GET",
    headers
  });
  assert.equal(session.authenticated, true);
  assert.ok(session.user?.id);
  return session.user.id;
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

  const legacyAuditResponse = await fetch(
    `${baseUrl}/api/audit-log?entityType=child&entityId=${encodeURIComponent(created.id)}&limit=10`,
    { method: "GET", headers: adminHeaders }
  );
  assert.equal(legacyAuditResponse.status, 200);
  assert.equal(legacyAuditResponse.headers.get("cache-control"), "no-store");
  assert.equal(legacyAuditResponse.headers.get("deprecation"), "true");
  assert.equal(
    legacyAuditResponse.headers.get("link"),
    "</api/audit-log/page>; rel=\"successor-version\""
  );
  const auditEntries = await legacyAuditResponse.json() as ApiAuditEntry[];
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

  const firstAuditPageResponse = await fetch(
    `${baseUrl}/api/audit-log/page?entityType=child&entityId=${encodeURIComponent(created.id)}&limit=2`,
    { method: "GET", headers: adminHeaders }
  );
  assert.equal(firstAuditPageResponse.status, 200);
  assert.equal(firstAuditPageResponse.headers.get("cache-control"), "no-store");
  const firstAuditPage = await firstAuditPageResponse.json() as {
    items: ApiAuditEntry[];
    nextCursor?: string;
  };
  assert.equal(firstAuditPage.items.length, 2);
  assert.ok(firstAuditPage.nextCursor);

  const secondAuditPage = await jsonRequest<{
    items: ApiAuditEntry[];
    nextCursor?: string;
  }>(
    baseUrl,
    `/api/audit-log/page?entityType=child&entityId=${encodeURIComponent(created.id)}&limit=2&cursor=${encodeURIComponent(firstAuditPage.nextCursor)}`,
    { method: "GET", headers: adminHeaders }
  );
  assert.equal(secondAuditPage.items.length, 1);
  assert.equal(secondAuditPage.nextCursor, undefined);
  assert.deepEqual(
    new Set([...firstAuditPage.items, ...secondAuditPage.items].map((entry) => entry.id)).size,
    3
  );
  await expectStatus(baseUrl, "/api/audit-log/page?cursor=not-a-valid-cursor", 400, {
    method: "GET",
    headers: adminHeaders
  });

  const actorLabels = await jsonRequest<Array<{ id: string; displayName: string }>>(
    baseUrl,
    "/api/actor-labels/resolve",
    {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        ids: [created.createdBy, updated.updatedBy, "user_not_referenced_by_visible_data"]
      })
    }
  );
  assert.deepEqual(actorLabels, [
    { id: created.createdBy, displayName: "Alpha Parent" },
    { id: updated.updatedBy, displayName: "Beta Parent" }
  ]);

  await expectStatus(baseUrl, "/api/actor-labels/resolve", 400, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ ids: Array.from({ length: 201 }, (_, index) => `actor-${index}`) })
  });
});

test("shared care-party assignments restrict unavailable period care context", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "betreuungskalender-care-party-access-"));
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

  const alphaUserId = await sessionUserId(baseUrl, alphaHeaders);
  const betaUserId = await sessionUserId(baseUrl, betaHeaders);
  await sessionUserId(baseUrl, adminHeaders);
  await jsonRequest<ApiChild[]>(baseUrl, "/api/children", {
    method: "GET",
    headers: alphaHeaders
  });
  await jsonRequest<ApiChild[]>(baseUrl, "/api/children", {
    method: "GET",
    headers: betaHeaders
  });
  await jsonRequest<ApiChild[]>(baseUrl, "/api/children", {
    method: "GET",
    headers: adminHeaders
  });

  const alphaParty = await jsonRequest<ApiCareParty>(baseUrl, "/api/care-parties", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ name: "Alpha Betreuung", kind: "other" })
  });
  const betaParty = await jsonRequest<ApiCareParty>(baseUrl, "/api/care-parties", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ name: "Beta Betreuung", kind: "other" })
  });

  await jsonRequest(baseUrl, `/api/user-care-party-assignments/${alphaUserId}`, {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ carePartyIds: [alphaParty.id] })
  });
  await jsonRequest(baseUrl, `/api/user-care-party-assignments/${betaUserId}`, {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ carePartyIds: [betaParty.id] })
  });

  const periodInput = {
    startDateTime: "2026-07-04T08:00:00.000Z",
    endDateTime: "2026-07-04T17:00:00.000Z",
    scope: "external_contact_block",
    responsiblePartyId: alphaParty.id,
    childIds: [],
    category: "other",
    dutyRelated: false,
    affectsContact: true,
    affectsHolidays: false,
    location: "Fiktiver Ort"
  };

  const created = await jsonRequest<ApiUnavailablePeriod>(baseUrl, "/api/unavailable-periods", {
    method: "POST",
    headers: alphaHeaders,
    body: JSON.stringify(periodInput)
  });
  assert.equal(created.responsiblePartyId, alphaParty.id);

  await expectStatus(baseUrl, "/api/unavailable-periods", 400, {
    method: "POST",
    headers: betaHeaders,
    body: JSON.stringify(periodInput)
  });
  await expectStatus(baseUrl, `/api/unavailable-periods/${created.id}`, 400, {
    method: "PUT",
    headers: betaHeaders,
    body: JSON.stringify({
      ...periodInput,
      location: "Fiktiver Änderungsversuch"
    })
  });
  await expectStatus(baseUrl, `/api/unavailable-periods/${created.id}`, 400, {
    method: "DELETE",
    headers: betaHeaders
  });

  const afterDeniedDelete = await jsonRequest<ApiUnavailablePeriod[]>(baseUrl, "/api/unavailable-periods", {
    method: "GET",
    headers: alphaHeaders
  });
  assert.equal(afterDeniedDelete.some((period) => period.id === created.id), true);
});

test("shared care-party assignments restrict care entries and contact rules by existing owner", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "betreuungskalender-care-party-owner-"));
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

  const alphaUserId = await sessionUserId(baseUrl, alphaHeaders);
  const betaUserId = await sessionUserId(baseUrl, betaHeaders);
  await sessionUserId(baseUrl, adminHeaders);
  await jsonRequest<ApiChild[]>(baseUrl, "/api/children", {
    method: "GET",
    headers: alphaHeaders
  });
  await jsonRequest<ApiChild[]>(baseUrl, "/api/children", {
    method: "GET",
    headers: betaHeaders
  });
  await jsonRequest<ApiChild[]>(baseUrl, "/api/children", {
    method: "GET",
    headers: adminHeaders
  });

  const child = await jsonRequest<ApiChild>(baseUrl, "/api/children", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: "Demo Kind",
      birthMonth: 7,
      birthYear: 2018,
      color: "#087f7b"
    })
  });
  const alphaParty = await jsonRequest<ApiCareParty>(baseUrl, "/api/care-parties", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ name: "Alpha Betreuung", kind: "other" })
  });
  const betaParty = await jsonRequest<ApiCareParty>(baseUrl, "/api/care-parties", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ name: "Beta Betreuung", kind: "other" })
  });

  await jsonRequest(baseUrl, `/api/user-care-party-assignments/${alphaUserId}`, {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ carePartyIds: [alphaParty.id] })
  });
  await jsonRequest(baseUrl, `/api/user-care-party-assignments/${betaUserId}`, {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ carePartyIds: [betaParty.id] })
  });

  const alphaEntryInput = {
    startDateTime: "2026-07-04T08:00:00.000Z",
    endDateTime: "2026-07-04T17:00:00.000Z",
    childIds: [child.id],
    responsiblePartyId: alphaParty.id,
    status: "planned",
    careScope: "full_day",
    overnight: false,
    schoolHandover: false,
    holiday: false,
    weekend: false,
    additionalCare: false,
    hasEvidence: false,
    trips: [],
    costs: []
  };
  const alphaEntry = await jsonRequest<ApiCareEntry>(baseUrl, "/api/care-entries", {
    method: "POST",
    headers: alphaHeaders,
    body: JSON.stringify(alphaEntryInput)
  });

  await expectStatus(baseUrl, `/api/care-entries/${alphaEntry.id}`, 400, {
    method: "PUT",
    headers: betaHeaders,
    body: JSON.stringify({
      ...alphaEntryInput,
      responsiblePartyId: betaParty.id,
      location: "Nicht erlaubter Änderungsversuch"
    })
  });
  await expectStatus(baseUrl, `/api/care-entries/${alphaEntry.id}`, 400, {
    method: "DELETE",
    headers: betaHeaders
  });
  const afterDeniedEntryDelete = await jsonRequest<ApiCareEntry>(
    baseUrl,
    `/api/care-entries/${alphaEntry.id}`,
    { method: "GET", headers: alphaHeaders }
  );
  assert.equal(afterDeniedEntryDelete.responsiblePartyId, alphaParty.id);
  const alphaUpdatedEntry = await jsonRequest<ApiCareEntry>(baseUrl, `/api/care-entries/${alphaEntry.id}`, {
    method: "PUT",
    headers: alphaHeaders,
    body: JSON.stringify({
      ...alphaEntryInput,
      location: "Erlaubte Änderung"
    })
  });
  assert.equal(alphaUpdatedEntry.location, "Erlaubte Änderung");
  assert.equal(alphaUpdatedEntry.responsiblePartyId, alphaParty.id);

  const alphaRuleInput = {
    name: "Alpha Umgang",
    startDate: "2026-07-03",
    timezone: "Europe/Berlin",
    recurrence: {
      kind: "rrule",
      rrules: ["FREQ=WEEKLY;INTERVAL=1;BYDAY=FR"]
    },
    segments: [{
      id: "weekend",
      startDayOffset: 0,
      startTime: "16:00",
      endDayOffset: 2,
      endTime: "18:00"
    }],
    syncHorizonMonths: 1,
    responsiblePartyId: alphaParty.id,
    childIds: [child.id],
    active: true
  };
  const alphaRule = await jsonRequest<ApiContactRule>(baseUrl, "/api/contact-rules", {
    method: "POST",
    headers: alphaHeaders,
    body: JSON.stringify(alphaRuleInput)
  });

  await expectStatus(baseUrl, `/api/contact-rules/${alphaRule.id}`, 400, {
    method: "PUT",
    headers: betaHeaders,
    body: JSON.stringify({
      ...alphaRuleInput,
      name: "Nicht erlaubter Regelwechsel",
      responsiblePartyId: betaParty.id
    })
  });
  await expectStatus(baseUrl, `/api/contact-rules/${alphaRule.id}`, 400, {
    method: "DELETE",
    headers: betaHeaders
  });
  await expectStatus(baseUrl, `/api/contact-rules/${alphaRule.id}/sync`, 400, {
    method: "POST",
    headers: betaHeaders
  });
  const afterDeniedRuleDelete = await jsonRequest<ApiContactRule[]>(baseUrl, "/api/contact-rules", {
    method: "GET",
    headers: alphaHeaders
  });
  assert.equal(
    afterDeniedRuleDelete.some((rule) => rule.id === alphaRule.id && rule.responsiblePartyId === alphaParty.id),
    true
  );
  const alphaUpdatedRule = await jsonRequest<ApiContactRule>(baseUrl, `/api/contact-rules/${alphaRule.id}`, {
    method: "PUT",
    headers: alphaHeaders,
    body: JSON.stringify({
      ...alphaRuleInput,
      name: "Alpha Umgang angepasst"
    })
  });
  assert.equal(alphaUpdatedRule.name, "Alpha Umgang angepasst");
  assert.equal(alphaUpdatedRule.responsiblePartyId, alphaParty.id);
  const alphaSyncedRule = await jsonRequest<ApiContactRule>(
    baseUrl,
    `/api/contact-rules/${alphaRule.id}/sync`,
    { method: "POST", headers: alphaHeaders }
  );
  assert.equal(alphaSyncedRule.id, alphaRule.id);
  assert.ok(alphaSyncedRule.syncSummary);
});
