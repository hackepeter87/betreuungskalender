import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createApiAuthHook } from "./authHook.js";
import { createSqlitePersistenceRuntime } from "./db/runtime.js";
import { createDemoModeBoundaryHook } from "./demoModePolicy.js";
import { importData } from "./routes/appData.js";
import { publicDemoRoutes } from "./routes/publicDemo.js";
import { createEdgeCaseDemoData } from "./services/demoFixtures.js";
import { DEMO_SEED_VERSION_SETTING } from "./services/publicDemoProjection.js";

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
  version = "fixture-v1"
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
