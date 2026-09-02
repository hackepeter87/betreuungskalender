import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  classifyDatabaseError,
  createSqlitePersistenceRuntime
} from "./runtime.js";
import { availableMigrationVersions } from "./migrationRunner.js";
import { databaseTableNames } from "./schema.js";

const migrationsDirectory = resolve(process.cwd(), "server/migrations");

test("SQLite runtime owns migrations, readiness, transactions, and close", async () => {
  const root = mkdtempSync(join(tmpdir(), "betreuungskalender-runtime-"));
  const runtime = createSqlitePersistenceRuntime(
    join(root, "app.sqlite"),
    migrationsDirectory
  );

  try {
    assert.deepEqual(await runtime.status(), {
      reachable: true,
      migrationsApplied: false,
      migrationCount: 0
    });

    await runtime.migrate();
    assert.deepEqual(await runtime.status(), {
      reachable: true,
      migrationsApplied: true,
      migrationCount: availableMigrationVersions(migrationsDirectory).length
    });
    assert.equal(runtime.sqliteDatabase.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(runtime.sqliteDatabase.pragma("busy_timeout", { simple: true }), 5000);
    assert.equal(runtime.sqliteDatabase.pragma("journal_mode", { simple: true }), "wal");
    const actualTables = runtime.sqliteDatabase.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map((row) => (row as { name: string }).name);
    assert.deepEqual(actualTables, [...databaseTableNames].sort());

    await runtime.transaction(async (transaction) => {
      await transaction
        .insertInto("settings")
        .values({
          key: "runtime-commit",
          value_json: "{}",
          created_at: "2026-09-02T00:00:00.000Z",
          updated_at: "2026-09-02T00:00:00.000Z"
        })
        .execute();
    });
    assert.ok(runtime.sqliteDatabase
      .prepare("SELECT 1 FROM settings WHERE key = ?")
      .get("runtime-commit"));

    await assert.rejects(
      runtime.transaction(async (transaction) => {
        await transaction
          .insertInto("settings")
          .values({
            key: "runtime-rollback",
            value_json: "{}",
            created_at: "2026-09-02T00:00:00.000Z",
            updated_at: "2026-09-02T00:00:00.000Z"
          })
          .execute();
        throw new Error("rollback requested");
      }),
      /rollback requested/
    );
    assert.equal(runtime.sqliteDatabase
      .prepare("SELECT 1 FROM settings WHERE key = ?")
      .get("runtime-rollback"), undefined);
  } finally {
    await runtime.close();
    await runtime.close();
    assert.deepEqual(await runtime.status(), {
      reachable: false,
      migrationsApplied: false,
      migrationCount: 0
    });
    await assert.rejects(runtime.transaction(async () => undefined), {
      code: "database_runtime_closed"
    });
    rmSync(root, { recursive: true, force: true });
  }
});

test("database errors map to stable application categories", () => {
  assert.deepEqual(classifyDatabaseError({ code: "SQLITE_CONSTRAINT_UNIQUE" }), {
    kind: "constraint",
    code: "constraint_violation"
  });
  assert.deepEqual(classifyDatabaseError({ code: "SQLITE_BUSY" }), {
    kind: "unavailable",
    code: "database_unavailable"
  });
  assert.deepEqual(classifyDatabaseError(new Error("unknown")), {
    kind: "unknown",
    code: "database_error"
  });
});
