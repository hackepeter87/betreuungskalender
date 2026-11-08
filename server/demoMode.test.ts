import assert from "node:assert/strict";
import test from "node:test";
import Fastify, { type RouteOptions } from "fastify";
import { createApiAuthHook } from "./authHook.js";
import { createSqlitePersistenceRuntime } from "./db/runtime.js";
import {
  applyDemoModeRoutePolicy,
  createDemoModeBoundaryHook,
  DemoRequestLimiter,
  demoModeAllowsExternalSideEffects,
  installDemoModeRoutePolicy,
  isDemoModeRouteForbidden
} from "./demoModePolicy.js";
import { importData } from "./routes/appData.js";
import { publicDemoRoutes } from "./routes/publicDemo.js";
import { createEdgeCaseDemoData } from "./services/demoFixtures.js";
import {
  DemoDatasetLimitError,
  assertDemoCareEntryCapacity
} from "./services/demoModeLimits.js";
import { DEMO_SEED_VERSION_SETTING } from "./services/publicDemoProjection.js";
import { DEMO_RESET_STATE_SETTING } from "./services/demoReset.js";

function authConfig() {
  return {
    authMode: "native-oidc" as const,
    requireAuth: true,
    trustProxyAuth: false,
    trustedProxyRules: [],
    oidcUserIdHeader: "x-auth-request-user",
    oidcEmailHeader: "x-auth-request-email",
    oidcDisplayNameHeader: "x-auth-request-preferred-username",
    oidcGroupsHeader: "x-auth-request-groups",
    oidcAdminGroup: "/admins",
    oidcParentGroup: "/parents",
    oidcReadonlyGroup: "/readers",
    oidcRequireRoleClaim: true,
    sessionCookieName: "demo_session",
    recoveryAdminEnabled: false,
    recoveryAdminSessionCookieName: "demo_recovery"
  };
}

async function fixture() {
  const persistence = createSqlitePersistenceRuntime(":memory:");
  await persistence.migrate();
  await persistence.transaction((database) =>
    importData(createEdgeCaseDemoData(), "fixture-actor", database)
  );
  return persistence;
}

async function markDatasetReady(
  persistence: Awaited<ReturnType<typeof fixture>>,
  version = "fixture-v1",
  nextResetAt = "2099-01-01T00:00:00.000Z",
  status: "ready" | "failed" = "ready"
): Promise<void> {
  const timestamp = new Date().toISOString();
  await persistence.query.insertInto("settings").values({
    key: DEMO_SEED_VERSION_SETTING,
    value_json: JSON.stringify(version),
    created_by: "demo-system",
    updated_by: "demo-system",
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null
  }).execute();
  await persistence.query.insertInto("settings").values({
    key: DEMO_RESET_STATE_SETTING,
    value_json: JSON.stringify({
      seedVersion: version,
      sessionGeneration: 1,
      status,
      lastSuccessfulResetAt: "2026-11-08T10:00:00.000Z",
      nextResetAt
    }),
    created_by: "demo-system",
    updated_by: "demo-system",
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null
  }).execute();
}

async function appFor(
  persistence: Awaited<ReturnType<typeof fixture>>,
  enabled: boolean
) {
  const app = Fastify({ logger: false });
  app.decorate("persistence", persistence);
  app.decorateRequest("userEmail", "local-dev");
  app.decorateRequest("user", undefined);
  app.addHook("preHandler", createDemoModeBoundaryHook(enabled));
  app.addHook("preHandler", createApiAuthHook(authConfig(), undefined, {
    database: persistence.query,
    nativeSessions: { findByToken: async () => undefined }
  }));
  await app.register(publicDemoRoutes, { enabled });
  app.get("/api/private-test", {
    config: { permission: "appointments:view" }
  }, async () => ({ ok: true }));
  app.put("/api/children/:id", {
    config: { permission: "children:manage" }
  }, async () => ({ ok: true }));
  app.post("/api/setup/first-use", async () => ({ ok: true }));
  app.get("/setup", async () => "setup");
  return app;
}

test("public demo projection stays unavailable until a versioned seed is active", async () => {
  const persistence = await fixture();
  const app = await appFor(persistence, true);
  try {
    const response = await app.inject({ method: "GET", url: "/api/demo/public" });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: "demo_unavailable" });
    assert.match(response.headers["cache-control"] ?? "", /no-store/);
  } finally {
    await app.close();
    await persistence.close();
  }
});

test("public demo projection exposes only the explicit fictional-data allowlist", async () => {
  const persistence = await fixture();
  await markDatasetReady(persistence);
  const app = await appFor(persistence, true);
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/demo/public?startDate=2026-07-01&endDate=2026-07-31"
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["cache-control"] ?? "", /no-store/);
    const body = response.json<{
      mode: string;
      seedVersion: string;
      children: Array<Record<string, unknown>>;
      careParties: Array<Record<string, unknown>>;
      entries: Array<Record<string, unknown>>;
    }>();
    assert.equal(body.mode, "shared_fictional_demo");
    assert.equal(body.seedVersion, "fixture-v1");
    assert.ok(body.children.length > 0);
    assert.ok(body.careParties.length > 0);
    assert.ok(body.entries.length > 0);
    assert.deepEqual(Object.keys(body.children[0]!).sort(), ["color", "id", "name"]);
    assert.deepEqual(Object.keys(body.careParties[0]!).sort(), ["id", "name"]);
    assert.deepEqual(Object.keys(body.entries[0]!).sort(), [
      "additionalCare",
      "careScope",
      "childIds",
      "endDateTime",
      "holiday",
      "id",
      "overnight",
      "responsiblePartyId",
      "startDateTime",
      "status"
    ]);
    const serialized = response.body;
    for (const forbidden of [
      "createdBy",
      "updatedBy",
      "birthYear",
      "birthMonth",
      "notes",
      "evidenceReference",
      "email",
      "auditLog",
      "feedUrl"
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  } finally {
    await app.close();
    await persistence.close();
  }
});

test("public demo projection stops serving failed or overdue generations", async () => {
  for (const reset of [
    { nextResetAt: "2020-01-01T00:00:00.000Z", status: "ready" as const },
    { nextResetAt: "2099-01-01T00:00:00.000Z", status: "failed" as const },
    { nextResetAt: "not-a-date", status: "ready" as const }
  ]) {
    const persistence = await fixture();
    await markDatasetReady(persistence, "fixture-v1", reset.nextResetAt, reset.status);
    const app = await appFor(persistence, true);
    try {
      const response = await app.inject({ method: "GET", url: "/api/demo/public" });
      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.json(), { error: "demo_unavailable" });
    } finally {
      await app.close();
      await persistence.close();
    }
  }
});

test("public demo route is hidden when disabled and does not open other APIs", async () => {
  const persistence = await fixture();
  await markDatasetReady(persistence);
  const app = await appFor(persistence, false);
  try {
    const publicResponse = await app.inject({ method: "GET", url: "/api/demo/public" });
    assert.equal(publicResponse.statusCode, 404);
    assert.deepEqual(publicResponse.json(), { error: "not_found" });

    const privateResponse = await app.inject({ method: "GET", url: "/api/private-test" });
    assert.equal(privateResponse.statusCode, 401);
    assert.equal(privateResponse.json<{ code?: string }>().code, "authentication_required");
  } finally {
    await app.close();
    await persistence.close();
  }
});

test("public demo range validation is bounded and generic", async () => {
  const persistence = await fixture();
  await markDatasetReady(persistence);
  const app = await appFor(persistence, true);
  try {
    for (const url of [
      "/api/demo/public?startDate=2026-08-01&endDate=2026-07-01",
      "/api/demo/public?startDate=2025-01-01&endDate=2026-12-31",
      "/api/demo/public?startDate=not-a-date"
    ]) {
      const response = await app.inject({ method: "GET", url });
      assert.equal(response.statusCode, 400);
      assert.deepEqual(response.json(), { error: "invalid_request" });
    }
  } finally {
    await app.close();
    await persistence.close();
  }
});

test("demo boundary keeps fictional master data immutable and disables owner bootstrap", async () => {
  const persistence = await fixture();
  await markDatasetReady(persistence);
  const app = await appFor(persistence, true);
  try {
    for (const request of [
      { method: "PUT" as const, url: "/api/children/demo-child-alpha", payload: {} },
      { method: "POST" as const, url: "/api/setup/first-use", payload: {} },
      { method: "GET" as const, url: "/setup" }
    ]) {
      const response = await app.inject(request);
      assert.equal(response.statusCode, 403);
      assert.equal(response.json<{ code?: string }>().code, "forbidden");
      assert.equal(response.body.includes("demo-child-alpha"), false);
    }
  } finally {
    await app.close();
    await persistence.close();
  }
});

test("demo boundary blocks external side effects and administrative data movement", () => {
  const blocked = [
    ["POST", "/api/invitations"],
    ["GET", "/invite"],
    ["PUT", "/api/settings"],
    ["POST", "/api/push-subscriptions"],
    ["PUT", "/api/notification-preferences"],
    ["POST", "/api/external-calendars/feed"],
    ["GET", "/api/calendar-feed"],
    ["GET", "/calendar/opaque-token"],
    ["PUT", "/api/app-data"],
    ["GET", "/api/data-transfer/export"],
    ["POST", "/api/migration/legacy-import"],
    ["POST", "/api/demo-data/edge-cases"],
    ["POST", "/api/privacy-actions/execute"]
  ] as const;
  for (const [method, path] of blocked) {
    assert.equal(isDemoModeRouteForbidden(method, path), true, `${method} ${path}`);
  }

  for (const [method, path] of [
    ["GET", "/api/external-calendars"],
    ["POST", "/api/care-entries"],
    ["PUT", "/api/members/member-id/access"]
  ] as const) {
    assert.equal(isDemoModeRouteForbidden(method, path), false, `${method} ${path}`);
  }
});

test("demo route policy bounds write bodies and preserves stricter route limits", () => {
  const write = {
    method: "POST",
    url: "/api/care-entries",
    config: { rateLimit: { max: 20, timeWindow: 60_000 } }
  } as RouteOptions;
  applyDemoModeRoutePolicy(write, true);
  assert.equal(write.bodyLimit, 64 * 1024);
  assert.deepEqual(write.config?.rateLimit, { max: 20, timeWindow: 60_000 });

  const publicRead = {
    method: "GET",
    url: "/api/demo/public",
    config: {}
  } as RouteOptions;
  applyDemoModeRoutePolicy(publicRead, true);
  assert.deepEqual(publicRead.config?.rateLimit, { max: 60, timeWindow: 60_000 });

  const disabled = {
    method: "POST",
    url: "/api/care-entries",
    bodyLimit: 1024 * 1024,
    config: {}
  } as RouteOptions;
  applyDemoModeRoutePolicy(disabled, false);
  assert.equal(disabled.bodyLimit, 1024 * 1024);
  assert.equal(disabled.config?.rateLimit, undefined);
});

test("demo write body limit is enforced by the real Fastify parser", async () => {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  installDemoModeRoutePolicy(app, true);
  app.post("/api/demo-write", async () => ({ ok: true }));
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/demo-write",
      payload: { value: "x".repeat(64 * 1024) }
    });
    assert.equal(response.statusCode, 413);
  } finally {
    await app.close();
  }
});

test("demo request limiter enforces global and per-session budgets with retry metadata", () => {
  const limiter = new DemoRequestLimiter({
    windowMs: 60_000,
    publicReadGlobalMax: 2,
    writeGlobalMax: 3,
    writeSessionMax: 1,
    loginGlobalMax: 1
  });
  const now = 1_000;

  limiter.consume("public_read", undefined, now);
  limiter.consume("public_read", undefined, now);
  assert.throws(
    () => limiter.consume("public_read", undefined, now),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "rate_limit_exceeded");
      assert.equal((error as { statusCode?: number }).statusCode, 429);
      assert.equal((error as { retryAfterSeconds?: number }).retryAfterSeconds, 60);
      return true;
    }
  );

  limiter.consume("write", "session-a", now);
  assert.throws(() => limiter.consume("write", "session-a", now), /Zu viele Anfragen/);
  limiter.consume("write", "session-b", now);
  assert.throws(() => limiter.consume("write", "session-c", now), /Zu viele Anfragen/);

  limiter.consume("login", undefined, now);
  assert.throws(() => limiter.consume("login", undefined, now), /Zu viele Anfragen/);
  assert.doesNotThrow(() => limiter.consume("login", undefined, now + 60_000));
});

test("demo mode disables notification and delivery background effects", () => {
  assert.equal(demoModeAllowsExternalSideEffects(true), false);
  assert.equal(demoModeAllowsExternalSideEffects(false), true);
});

test("demo care entry capacity counts persisted rows and is disabled outside demo mode", async () => {
  const persistence = await fixture();
  try {
    const result = await persistence.query.selectFrom("care_entries")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow();
    const currentCount = Number(result.count);

    await assert.rejects(
      assertDemoCareEntryCapacity(persistence.query, true, currentCount),
      (error: unknown) => error instanceof DemoDatasetLimitError
    );
    await assert.doesNotReject(
      assertDemoCareEntryCapacity(persistence.query, false, currentCount)
    );
  } finally {
    await persistence.close();
  }
});
