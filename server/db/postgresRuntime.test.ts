import assert from "node:assert/strict";
import test from "node:test";
import { Pool, type QueryResult } from "pg";
import {
  PostgresPersistenceRuntime,
  classifyDatabaseError,
  createPersistenceRuntime,
  createSqlitePersistenceRuntime
} from "./runtime.js";
import { availableMigrationVersions } from "./migrationRunner.js";
import { runPersistenceMigrations } from "./migrate.js";
import { postgresMigrationVersions } from "./postgresMigrationRunner.js";
import { databaseTableNames } from "./schema.js";

const configured = Boolean(
  process.env.TEST_POSTGRES_HOST && process.env.TEST_POSTGRES_PASSWORD_FILE
);

function testOptions() {
  return {
    driver: "postgres" as const,
    host: process.env.TEST_POSTGRES_HOST ?? "127.0.0.1",
    port: Number(process.env.TEST_POSTGRES_PORT ?? 5432),
    database: process.env.TEST_POSTGRES_DATABASE ?? "betreuungskalender_test",
    user: process.env.TEST_POSTGRES_USER ?? "postgres",
    passwordFile: process.env.TEST_POSTGRES_PASSWORD_FILE ?? "",
    tlsMode: "disable" as const
  };
}

test("PostgreSQL runtime owns migrations, transactions, constraints, and close", {
  skip: !configured
}, async () => {
  const options = testOptions();
  const password = await import("node:fs/promises")
    .then(({ readFile }) => readFile(options.passwordFile, "utf8"));
  const admin = new Pool({
    host: options.host,
    port: options.port,
    database: options.database,
    user: options.user,
    password: password.trim()
  });
  await admin.query("DROP SCHEMA public CASCADE");
  await admin.query("CREATE SCHEMA public");
  await admin.end();

  const first = createPersistenceRuntime(options);
  const second = createPersistenceRuntime(options);
  assert.ok(first instanceof PostgresPersistenceRuntime);
  assert.ok(second instanceof PostgresPersistenceRuntime);
  try {
    assert.deepEqual(await first.status(), {
      reachable: true,
      migrationsApplied: false,
      migrationCount: 0
    });

    await Promise.all([first.migrate(), second.migrate()]);
    assert.deepEqual(postgresMigrationVersions(), availableMigrationVersions());
    assert.deepEqual(await first.status(), {
      reachable: true,
      migrationsApplied: true,
      migrationCount: postgresMigrationVersions().length
    });

    const tables = await first.pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    assert.deepEqual(
      tables.rows.map(({ table_name }) => table_name),
      [...databaseTableNames].sort()
    );
    const sqlite = createSqlitePersistenceRuntime(":memory:");
    try {
      await sqlite.migrate();
      const postgresIndexes = await first.pool.query<{ indexname: string }>(`
        SELECT indexname
        FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public' AND indexname LIKE 'idx_%'
        ORDER BY indexname
      `);
      const sqliteIndexes = sqlite.sqliteDatabase.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index' AND name LIKE 'idx_%'
        ORDER BY name
      `).all() as Array<{ name: string }>;
      assert.deepEqual(
        postgresIndexes.rows.map(({ indexname }) => indexname),
        sqliteIndexes.map(({ name }) => name),
        "Named index mismatch"
      );
      for (const tableName of databaseTableNames) {
        const postgresColumns: QueryResult<{ column_name: string }> =
          await first.pool.query({
          text: `
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position
          `,
          values: [tableName]
        });
        const sqliteColumns = sqlite.sqliteDatabase
          .prepare(`PRAGMA table_info(${tableName})`)
          .all() as Array<{ name: string }>;
        assert.deepEqual(
          postgresColumns.rows.map(({ column_name }) => column_name).sort(),
          sqliteColumns.map(({ name }) => name).sort(),
          `Column mismatch for ${tableName}`
        );
        const postgresForeignKeys: QueryResult<{
          column_name: string;
          foreign_table_name: string;
          foreign_column_name: string;
          delete_rule: string;
        }> = await first.pool.query({
          text: `
            SELECT
              key_column.column_name,
              foreign_column.table_name AS foreign_table_name,
              foreign_column.column_name AS foreign_column_name,
              reference.delete_rule
            FROM information_schema.table_constraints AS constraint_entry
            JOIN information_schema.key_column_usage AS key_column
              ON key_column.constraint_name = constraint_entry.constraint_name
              AND key_column.constraint_schema = constraint_entry.constraint_schema
            JOIN information_schema.referential_constraints AS reference
              ON reference.constraint_name = constraint_entry.constraint_name
              AND reference.constraint_schema = constraint_entry.constraint_schema
            JOIN information_schema.constraint_column_usage AS foreign_column
              ON foreign_column.constraint_name = reference.unique_constraint_name
              AND foreign_column.constraint_schema = reference.unique_constraint_schema
            WHERE constraint_entry.constraint_type = 'FOREIGN KEY'
              AND constraint_entry.table_schema = 'public'
              AND constraint_entry.table_name = $1
            ORDER BY key_column.column_name
          `,
          values: [tableName]
        });
        const sqliteForeignKeys = sqlite.sqliteDatabase
          .prepare(`PRAGMA foreign_key_list(${tableName})`)
          .all() as Array<{
            from: string;
            table: string;
            to: string;
            on_delete: string;
          }>;
        assert.deepEqual(
          postgresForeignKeys.rows.map((row) => ({
            column: row.column_name,
            targetTable: row.foreign_table_name,
            targetColumn: row.foreign_column_name,
            deleteRule: row.delete_rule
          })).sort((left, right) => left.column.localeCompare(right.column)),
          sqliteForeignKeys.map((row) => ({
            column: row.from,
            targetTable: row.table,
            targetColumn: row.to,
            deleteRule: row.on_delete
          })).sort((left, right) => left.column.localeCompare(right.column)),
          `Foreign-key mismatch for ${tableName}`
        );
      }
    } finally {
      await sqlite.close();
    }
    await first.migrate();
    assert.equal(
      (await first.status()).migrationCount,
      postgresMigrationVersions().length
    );

    await first.transaction(async (transaction) => {
      await transaction.insertInto("settings").values({
        key: "postgres-commit",
        value_json: "{}",
        created_at: "2026-09-02T00:00:00.000Z",
        updated_at: "2026-09-02T00:00:00.000Z"
      }).execute();
    });
    assert.equal(
      (await first.query.selectFrom("settings").select("key")
        .where("key", "=", "postgres-commit").executeTakeFirst())?.key,
      "postgres-commit"
    );

    await assert.rejects(first.transaction(async (transaction) => {
      await transaction.insertInto("settings").values({
        key: "postgres-rollback",
        value_json: "{}",
        created_at: "2026-09-02T00:00:00.000Z",
        updated_at: "2026-09-02T00:00:00.000Z"
      }).execute();
      throw new Error("rollback requested");
    }), /rollback requested/);
    assert.equal(
      await first.query.selectFrom("settings").select("key")
        .where("key", "=", "postgres-rollback").executeTakeFirst(),
      undefined
    );

    const timestamp = "2026-09-02T00:00:00.000Z";
    await first.query.insertInto("children").values([
      {
        id: "active-child",
        name: "Alex Beispiel",
        birth_month: 4,
        birth_year: 2018,
        color: "#00897b",
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null
      },
      {
        id: "deleted-child",
        name: "Sam Beispiel",
        birth_month: 8,
        birth_year: 2016,
        color: "#2563eb",
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: "2026-09-03T00:00:00.000Z"
      }
    ]).execute();
    assert.deepEqual(
      await first.query.selectFrom("children")
        .select("id")
        .where("deleted_at", "is", null)
        .orderBy("name", "asc")
        .limit(1)
        .offset(0)
        .execute(),
      [{ id: "active-child" }]
    );

    await first.query.insertInto("care_entries").values({
      id: "runtime-entry",
      start_datetime: "2026-09-02T08:00:00.000Z",
      end_datetime: "2026-09-02T18:00:00.000Z",
      status: "planned",
      care_scope: "full_day",
      overnight: 1,
      holiday: 0,
      duration_minutes: 600,
      created_by: "runtime-actor",
      updated_by: "runtime-actor",
      created_at: timestamp,
      updated_at: timestamp
    }).execute();
    assert.deepEqual(
      await first.query.selectFrom("care_entries")
        .select(["start_datetime", "overnight", "holiday"])
        .where("id", "=", "runtime-entry")
        .executeTakeFirstOrThrow(),
      {
        start_datetime: "2026-09-02T08:00:00.000Z",
        overnight: 1,
        holiday: 0
      }
    );
    await assert.rejects(
      first.query.insertInto("care_entry_children").values({
        care_entry_id: "runtime-entry",
        child_id: "missing-child",
        created_at: timestamp,
        updated_at: timestamp
      }).execute(),
      (error: unknown) => {
        assert.deepEqual(classifyDatabaseError(error), {
          kind: "constraint",
          code: "constraint_violation"
        });
        return true;
      }
    );

    await first.query.updateTable("settings")
      .set({ value_json: JSON.stringify({ enabled: true, threshold: 2 }) })
      .where("key", "=", "postgres-commit")
      .execute();
    assert.equal(
      (await first.query.selectFrom("settings").select("value_json")
        .where("key", "=", "postgres-commit").executeTakeFirstOrThrow()).value_json,
      '{"enabled":true,"threshold":2}'
    );

    const auditRows = await first.query.insertInto("audit_log").values([
      {
        timestamp: "2026-09-02T10:00:00.000Z",
        user_email: "runtime-actor",
        entity_type: "runtime",
        entity_id: "first",
        action: "created",
        created_at: timestamp,
        updated_at: timestamp
      },
      {
        timestamp: "2026-09-02T11:00:00.000Z",
        user_email: "runtime-actor",
        entity_type: "runtime",
        entity_id: "second",
        action: "created",
        created_at: timestamp,
        updated_at: timestamp
      }
    ]).returning(["id", "entity_id"]).execute();
    assert.equal(auditRows.length, 2);
    assert.ok(auditRows.every(({ id }) => Number.isInteger(id) && id > 0));
    assert.deepEqual(
      await first.query.selectFrom("audit_log")
        .select("entity_id")
        .where("entity_type", "=", "runtime")
        .orderBy("timestamp", "desc")
        .orderBy("id", "desc")
        .limit(1)
        .execute(),
      [{ entity_id: "second" }]
    );

    await assert.rejects(
      first.query.insertInto("settings").values({
        key: "postgres-commit",
        value_json: "{}",
        created_at: "2026-09-02T00:00:00.000Z",
        updated_at: "2026-09-02T00:00:00.000Z"
      }).execute(),
      (error: unknown) => {
        assert.deepEqual(classifyDatabaseError(error), {
          kind: "constraint",
          code: "constraint_violation"
        });
        return true;
      }
    );
    await first.pool.query("DROP SCHEMA IF EXISTS unrelated_runtime_test CASCADE");
    await first.pool.query("CREATE SCHEMA unrelated_runtime_test");
    await first.pool.query(`
      CREATE TABLE unrelated_runtime_test.parent (id INTEGER PRIMARY KEY);
      CREATE TABLE unrelated_runtime_test.child (parent_id INTEGER);
      ALTER TABLE unrelated_runtime_test.child
        ADD CONSTRAINT unresolved_parent
        FOREIGN KEY (parent_id)
        REFERENCES unrelated_runtime_test.parent(id)
        NOT VALID;
    `);
    assert.deepEqual(await first.integrity(), {
      valid: true,
      foreignKeyViolations: 0
    });
  } finally {
    await Promise.all([first.close(), second.close()]);
    await first.close();
  }
  assert.deepEqual(await first.status(), {
    reachable: false,
    migrationsApplied: false,
    migrationCount: 0
  });
});

test("PostgreSQL startup failures stay generic", { skip: !configured }, async () => {
  const options = testOptions();
  const invalidCredentials = createPersistenceRuntime({
    ...options,
    user: "unknown_runtime_user"
  });
  try {
    assert.equal((await invalidCredentials.status()).reachable, false);
    await assert.rejects(
      runPersistenceMigrations(invalidCredentials),
      (error: unknown) => {
        assert.equal(error instanceof Error && error.message, "Database startup failed.");
        assert.equal(String(error).includes(options.host), false);
        assert.equal(String(error).includes("unknown_runtime_user"), false);
        return true;
      }
    );
  } finally {
    await invalidCredentials.close();
  }

  const failedTls = createPersistenceRuntime({
    ...options,
    tlsMode: "verify-full",
    caFile: options.passwordFile
  });
  try {
    await assert.rejects(
      runPersistenceMigrations(failedTls),
      (error: unknown) => {
        assert.equal(error instanceof Error && error.message, "Database startup failed.");
        assert.equal(String(error).includes(options.host), false);
        assert.equal(String(error).includes(options.passwordFile), false);
        return true;
      }
    );
  } finally {
    await failedTls.close();
  }
});
