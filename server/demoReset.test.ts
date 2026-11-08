import assert from "node:assert/strict";
import test from "node:test";
import { createSqlitePersistenceRuntime } from "./db/runtime.js";
import { importData } from "./routes/appData.js";
import { createEdgeCaseDemoData } from "./services/demoFixtures.js";
import {
  DEMO_RESET_STATE_SETTING,
  DemoResetCoordinator,
  DemoWriteGate,
  readDemoResetState
} from "./services/demoReset.js";

async function fixture() {
  const persistence = createSqlitePersistenceRuntime(":memory:");
  await persistence.migrate();
  await persistence.transaction((database) =>
    importData(createEdgeCaseDemoData(), "demo-fixture", database)
  );
  await persistence.query.insertInto("app_users").values({
    id: "demo-user",
    external_subject: "demo-subject",
    email: "demo.user@example.invalid",
    display_name: "Demo User",
    role: "parent",
    groups_json: "[]",
    last_seen_at: "2026-11-08T10:00:00.000Z",
    created_at: "2026-11-08T10:00:00.000Z",
    updated_at: "2026-11-08T10:00:00.000Z",
    deleted_at: null
  }).execute();
  await persistence.query.insertInto("app_memberships").values({
    id: "demo-membership",
    user_id: "demo-user",
    role: "scheduler",
    care_scope_type: "selected",
    created_by: "demo-system",
    updated_by: "demo-system",
    created_at: "2026-11-08T10:00:00.000Z",
    updated_at: "2026-11-08T10:00:00.000Z",
    deleted_at: null
  }).execute();
  await persistence.query.insertInto("app_user_care_party_assignments").values({
    id: "demo-assignment",
    user_id: "demo-user",
    care_party_id: "demo-party-primary",
    created_by: "demo-system",
    updated_by: "demo-system",
    created_at: "2026-11-08T10:00:00.000Z",
    updated_at: "2026-11-08T10:00:00.000Z",
    deleted_at: null
  }).execute();
  await persistence.query.insertInto("native_oidc_sessions").values({
    id: "demo-session",
    session_hash: "synthetic-session-hash",
    external_subject: "demo-subject",
    created_at: "2026-11-08T10:00:00.000Z",
    last_seen_at: null,
    expires_at: "2026-11-09T10:00:00.000Z",
    revoked_at: null
  }).execute();
  return persistence;
}

test("demo reset atomically replaces domain data while preserving identities and access", async () => {
  const persistence = await fixture();
  try {
    const beforeAudit = await persistence.query.selectFrom("audit_log")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow();
    const coordinator = new DemoResetCoordinator({
      enabled: true,
      persistence,
      now: () => new Date("2026-11-08T12:34:56.000Z")
    });

    const state = await coordinator.initialize();

    assert.equal(state?.status, "ready");
    assert.equal(state?.seedVersion, "controlled-demo-v1");
    assert.equal(state?.sessionGeneration, 1);
    assert.equal(state?.lastSuccessfulResetAt, "2026-11-08T12:34:56.000Z");
    assert.equal(state?.nextResetAt, "2026-11-08T13:00:00.000Z");
    assert.equal((await persistence.query.selectFrom("care_entries")
      .select("start_datetime")
      .where("id", "=", "demo-entry-future-overdue-candidate")
      .executeTakeFirstOrThrow()).start_datetime, "2026-11-05T15:00:00.000Z");
    assert.equal((await persistence.query.selectFrom("app_users")
      .select("external_subject")
      .where("id", "=", "demo-user")
      .executeTakeFirstOrThrow()).external_subject, "demo-subject");
    assert.equal((await persistence.query.selectFrom("app_memberships")
      .select("role")
      .where("id", "=", "demo-membership")
      .executeTakeFirstOrThrow()).role, "scheduler");
    assert.equal((await persistence.query.selectFrom("app_user_care_party_assignments")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow()).count, 1);
    assert.equal((await persistence.query.selectFrom("audit_log")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow()).count, beforeAudit.count);
    assert.equal((await persistence.query.selectFrom("native_oidc_sessions")
      .select("revoked_at")
      .where("id", "=", "demo-session")
      .executeTakeFirstOrThrow()).revoked_at, "2026-11-08T12:34:56.000Z");

    const unchanged = await coordinator.runIfDue(new Date("2026-11-08T12:59:59.000Z"));
    assert.equal(unchanged?.sessionGeneration, 1);
  } finally {
    await persistence.close();
  }
});

test("failed demo reset rolls domain changes back and persists only a bounded failure state", async () => {
  const persistence = await fixture();
  try {
    const coordinator = new DemoResetCoordinator({
      enabled: true,
      persistence,
      now: () => new Date("2026-11-08T12:34:56.000Z"),
      replaceDomain: async (database) => {
        await database.deleteFrom("care_entries").execute();
        throw new Error("sensitive internal reset detail");
      }
    });

    await assert.rejects(() => coordinator.initialize(), /demo_reset_failed/);

    assert.equal((await persistence.query.selectFrom("care_entries")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow()).count, 6);
    const state = await readDemoResetState(persistence.query);
    assert.equal(state?.status, "failed");
    assert.equal(state?.errorCode, "demo_reset_failed");
    assert.equal(JSON.stringify(state).includes("sensitive"), false);
    assert.equal((await persistence.query.selectFrom("native_oidc_sessions")
      .select("revoked_at")
      .where("id", "=", "demo-session")
      .executeTakeFirstOrThrow()).revoked_at, null);
  } finally {
    await persistence.close();
  }
});

test("concurrent and restarted overdue reset requests execute one generation", async () => {
  const persistence = await fixture();
  try {
    let replacements = 0;
    const coordinator = new DemoResetCoordinator({
      enabled: true,
      persistence,
      now: () => new Date("2026-11-08T12:00:00.000Z"),
      beforeReplace: async () => {
        replacements += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });

    const [first, second] = await Promise.all([
      coordinator.initialize(),
      coordinator.initialize()
    ]);

    assert.equal(first?.sessionGeneration, 1);
    assert.equal(second?.sessionGeneration, 1);
    assert.equal(replacements, 1);
  } finally {
    await persistence.close();
  }
});

test("startup catches up a persisted interrupted reset before serving a new generation", async () => {
  const persistence = await fixture();
  try {
    const timestamp = "2026-11-08T11:00:00.000Z";
    await persistence.query.insertInto("settings").values({
      key: DEMO_RESET_STATE_SETTING,
      value_json: JSON.stringify({
        seedVersion: "controlled-demo-v1",
        sessionGeneration: 4,
        status: "running",
        nextResetAt: timestamp,
        startedAt: timestamp
      }),
      created_by: "demo-system",
      updated_by: "demo-system",
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null
    }).execute();
    const coordinator = new DemoResetCoordinator({
      enabled: true,
      persistence,
      now: () => new Date("2026-11-08T12:34:56.000Z")
    });

    const state = await coordinator.initialize();

    assert.equal(state?.status, "ready");
    assert.equal(state?.sessionGeneration, 5);
  } finally {
    await persistence.close();
  }
});

test("controlled reset refuses a database that is not exactly the synthetic seed", async () => {
  const persistence = await fixture();
  try {
    await persistence.query.insertInto("children").values({
      id: "unexpected-child",
      name: "Nicht freigegebener Bestand",
      birth_month: null,
      birth_year: null,
      color: "#000000",
      created_by: "test",
      updated_by: "test",
      created_at: "2026-11-08T10:00:00.000Z",
      updated_at: "2026-11-08T10:00:00.000Z",
      deleted_at: null
    }).execute();
    const coordinator = new DemoResetCoordinator({
      enabled: true,
      persistence,
      now: () => new Date("2026-11-08T12:34:56.000Z")
    });

    await assert.rejects(() => coordinator.initialize(), /demo_reset_failed/);

    assert.equal((await persistence.query.selectFrom("children")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow()).count, 4);
    assert.equal((await persistence.query.selectFrom("care_entries")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow()).count, 6);
  } finally {
    await persistence.close();
  }
});

test("disabled demo reset leaves normal installations untouched", async () => {
  const persistence = await fixture();
  try {
    const coordinator = new DemoResetCoordinator({ enabled: false, persistence });
    assert.equal(await coordinator.initialize(), undefined);
    assert.equal(await readDemoResetState(persistence.query), undefined);
  } finally {
    await persistence.close();
  }
});

test("demo write gate drains active writes and rejects new writes while reset is blocked", async () => {
  const gate = new DemoWriteGate(true);
  const release = gate.enter("POST", "/api/care-entries");
  let drained = false;
  const drain = gate.blockAndDrain().then(() => {
    drained = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(drained, false);
  assert.throws(
    () => gate.enter("PUT", "/api/care-entries/demo-entry"),
    (error: unknown) => (
      error instanceof Error &&
      "code" in error &&
      error.code === "demo_writes_blocked"
    )
  );
  release();
  await drain;
  assert.equal(drained, true);
  assert.throws(() => gate.enter("GET", "/auth/callback"), /Demo writes are blocked/);
  assert.throws(() => gate.enter("GET", "/auth/login"), /Demo writes are blocked/);

  gate.unblock();
  const releaseAfterReset = gate.enter("DELETE", "/api/care-entries/demo-entry");
  releaseAfterReset();
});
