import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { sql } from "kysely";
import {
  classifyDatabaseError,
  createSqlitePersistenceRuntime
} from "./runtime.js";

const migrationsDirectory = resolve(process.cwd(), "server/migrations");

test("SQLite runtime owns migration, readiness, transaction, and close lifecycle", async () => {
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
    const migrated = await runtime.status();
    assert.equal(migrated.reachable, true);
    assert.equal(migrated.migrationsApplied, true);
    assert.equal(migrated.migrationCount, 31);
    assert.equal(runtime.legacyDatabase.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(runtime.legacyDatabase.pragma("busy_timeout", { simple: true }), 5000);

    await assert.rejects(
      runtime.transaction(async (transaction) => {
        await sql`
          INSERT INTO settings (key, value_json, created_at, updated_at)
          VALUES ('runtime-rollback', '{}', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
        `.execute(transaction);
        throw new Error("rollback requested");
      }),
      /rollback requested/
    );
    const rolledBack = runtime.legacyDatabase
      .prepare("SELECT 1 AS found FROM settings WHERE key = ?")
      .get("runtime-rollback");
    assert.equal(rolledBack, undefined);
  } finally {
    await runtime.close();
    assert.deepEqual(await runtime.status(), {
      reachable: false,
      migrationsApplied: false,
      migrationCount: 0
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
