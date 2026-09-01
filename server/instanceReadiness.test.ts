import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { migrateDatabase } from "./db/migrationRunner.js";
import { createSqlitePersistenceRuntime, type PersistenceRuntime } from "./db/runtime.js";
import { buildInstanceReadiness } from "./services/instanceReadiness.js";

const migrationsDirectory = resolve(process.cwd(), "server/migrations");

async function withDatabase(
  run: (database: Database.Database, persistence: PersistenceRuntime) => Promise<void>
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "betreuungskalender-readiness-"));
  const database = new Database(join(root, "app.sqlite"));
  database.pragma("foreign_keys = ON");
  try {
    migrateDatabase(database, migrationsDirectory);
    await run(database, createSqlitePersistenceRuntime(database));
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
}

const runtime = {
  authMode: "native-oidc" as const,
  demoDatasetsEnabled: true,
  nodeEnv: "production",
  recoveryAdminEnabled: false,
  requireAuth: true,
  trustProxyAuth: false,
  version: "9.9.9-test",
  webPushPrivateKey: "very-secret-private-key",
  webPushPublicKey: "public-vapid-key"
};

test("builds admin-safe instance readiness without exposing secrets", async () => {
  await withDatabase(async (database, persistence) => {
    database.prepare(`
      INSERT INTO children (
        id, name, birth_month, birth_year, color, created_by, updated_by,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "child-readiness",
      "Demo Child",
      7,
      2018,
      "#087f7b",
      "tester",
      "tester",
      "2026-07-05T10:00:00.000Z",
      "2026-07-05T10:00:00.000Z"
    );
    database.prepare(`
      INSERT INTO care_parties (
        id, name, kind, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "party-readiness",
      "Hauptbetreuung",
      "other",
      "tester",
      "tester",
      "2026-07-05T10:00:00.000Z",
      "2026-07-05T10:00:00.000Z"
    );

    const readiness = await buildInstanceReadiness(database, runtime, persistence);
    const serialized = JSON.stringify(readiness);

    assert.equal(readiness.version, "9.9.9-test");
    assert.equal(readiness.authMode, "native-oidc");
    assert.equal(readiness.requireAuth, true);
    assert.equal(readiness.database.reachable, true);
    assert.equal(readiness.database.upToDate, true);
    assert.equal(readiness.setup.complete, true);
    assert.equal(readiness.setup.children, 1);
    assert.equal(readiness.setup.careParties, 1);
    assert.equal(readiness.setup.appUsers, 1);
    assert.equal(readiness.features.pushConfigured, true);
    assert.match(readiness.instanceId, /^inst_[0-9a-f]{16}$/);
    assert.doesNotMatch(serialized, /secret/i);
    assert.doesNotMatch(serialized, /private-key/i);
    assert.doesNotMatch(serialized, /DATABASE_PATH|OIDC_ISSUER|OIDC_CLIENT|VAPID|ISSUER_URL|CLIENT_SECRET/i);
  });
});

test("marks setup incomplete while the instance has no child data", async () => {
  await withDatabase(async (database, persistence) => {
    const readiness = await buildInstanceReadiness(database, {
      ...runtime,
      demoDatasetsEnabled: false,
      webPushPrivateKey: "",
      webPushPublicKey: ""
    }, persistence);

    assert.equal(readiness.setup.complete, false);
    assert.equal(readiness.setup.children, 0);
    assert.equal(readiness.setup.careParties, 0);
    assert.equal(readiness.features.demoDatasetsEnabled, false);
    assert.equal(readiness.features.pushConfigured, false);
  });
});
