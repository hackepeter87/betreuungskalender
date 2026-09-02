import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { migrateDatabase } from "./db/migrationRunner.js";
import { createSqlitePersistenceRuntime } from "./db/runtime.js";

interface ReleasedChecksums {
  release: string;
  latestMigration: string;
  sha256: Record<string, string>;
}

const migrationsDirectory = resolve(process.cwd(), "server/migrations");
const manifestPath = join(migrationsDirectory, "released-checksums.json");

function readManifest(): ReleasedChecksums {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as ReleasedChecksums;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertReleasedMigrationsUnchanged(manifest: ReleasedChecksums): string[] {
  const releasedFiles = Object.keys(manifest.sha256).sort();
  const availableFiles = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const latestFile = `${manifest.latestMigration}.sql`;
  const latestIndex = availableFiles.indexOf(latestFile);

  assert.equal(manifest.release, "v1.26.1");
  assert.notEqual(latestIndex, -1, `Missing released migration ${latestFile}`);
  assert.deepEqual(
    availableFiles.slice(0, latestIndex + 1),
    releasedFiles,
    "The released migration sequence must remain complete and ordered"
  );

  for (const file of releasedFiles) {
    assert.equal(
      sha256(join(migrationsDirectory, file)),
      manifest.sha256[file],
      `Released migration changed: ${file}`
    );
  }
  return releasedFiles;
}

function createReleasedFixture(root: string, releasedFiles: string[]): string {
  const releasedMigrations = join(root, "released-migrations");
  const databasePath = join(root, "v1.26.1.sqlite");
  mkdirSync(releasedMigrations);

  for (const file of releasedFiles) {
    copyFileSync(join(migrationsDirectory, file), join(releasedMigrations, file));
  }

  const releasedDatabase = new Database(databasePath);
  try {
    releasedDatabase.pragma("foreign_keys = ON");
    migrateDatabase(releasedDatabase, releasedMigrations);
    const timestamp = "2026-08-31T12:00:00.000Z";
    releasedDatabase.prepare(`
      INSERT INTO children (
        id, name, birth_month, birth_year, color,
        created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `).run("fixture-child", "Alex Beispiel", 4, 2018, "#00897b", timestamp, timestamp);
    releasedDatabase.prepare(`
      INSERT INTO care_parties (id, name, kind, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run("fixture-party", "Betreuung Beispiel", "other", timestamp, timestamp);
    releasedDatabase.prepare(`
      INSERT INTO care_entries (
        id, start_datetime, end_datetime, status, care_scope,
        duration_minutes, created_by, updated_by, created_at, updated_at,
        responsible_party_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "fixture-entry",
      "2026-08-30T08:00:00.000Z",
      "2026-08-30T18:00:00.000Z",
      "completed",
      "full_day",
      600,
      "fixture-actor",
      "fixture-actor",
      timestamp,
      timestamp,
      "fixture-party"
    );
    releasedDatabase.prepare(`
      INSERT INTO care_entry_children (
        care_entry_id, child_id, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, NULL)
    `).run("fixture-entry", "fixture-child", timestamp, timestamp);
    releasedDatabase.prepare(`
      INSERT INTO settings (key, value_json, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, NULL)
    `).run("fixture-setting", JSON.stringify({ enabled: true }), timestamp, timestamp);
  } finally {
    releasedDatabase.close();
  }

  return databasePath;
}

test("released SQLite migrations remain immutable", () => {
  assertReleasedMigrationsUnchanged(readManifest());
});

test("current runtime preserves and operates on a released SQLite database", async () => {
  const root = mkdtempSync(join(tmpdir(), "betreuungskalender-sqlite-parity-"));
  const releasedFiles = assertReleasedMigrationsUnchanged(readManifest());
  const currentMigrationFiles = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const databasePath = createReleasedFixture(root, releasedFiles);
  const runtime = createSqlitePersistenceRuntime(databasePath, migrationsDirectory);

  try {
    await runtime.migrate();

    const migrations = await runtime.query
      .selectFrom("schema_migrations")
      .select("version")
      .orderBy("version")
      .execute();
    assert.deepEqual(
      migrations.map(({ version }) => `${version}.sql`),
      currentMigrationFiles
    );

    const child = await runtime.query
      .selectFrom("children")
      .select(["name", "birth_month", "birth_year", "color"])
      .where("id", "=", "fixture-child")
      .executeTakeFirstOrThrow();
    assert.deepEqual(child, {
      name: "Alex Beispiel",
      birth_month: 4,
      birth_year: 2018,
      color: "#00897b"
    });
    const entry = await runtime.query
      .selectFrom("care_entries")
      .innerJoin("care_entry_children", "care_entry_children.care_entry_id", "care_entries.id")
      .select([
        "care_entries.status",
        "care_entries.duration_minutes",
        "care_entries.responsible_party_id",
        "care_entry_children.child_id"
      ])
      .where("care_entries.id", "=", "fixture-entry")
      .executeTakeFirstOrThrow();
    assert.deepEqual(entry, {
      status: "completed",
      duration_minutes: 600,
      responsible_party_id: "fixture-party",
      child_id: "fixture-child"
    });

    await runtime.transaction(async (transaction) => {
      await transaction.insertInto("children").values({
        id: "fixture-crud-child",
        name: "Robin Beispiel",
        birth_month: 7,
        birth_year: 2020,
        color: "#2563eb",
        created_at: "2026-09-02T00:00:00.000Z",
        updated_at: "2026-09-02T00:00:00.000Z",
        deleted_at: null
      }).execute();
      await transaction.updateTable("children")
        .set({ name: "Robin Aktualisiert" })
        .where("id", "=", "fixture-crud-child")
        .execute();
    });
    assert.equal(
      (await runtime.query.selectFrom("children").select("name")
        .where("id", "=", "fixture-crud-child").executeTakeFirstOrThrow()).name,
      "Robin Aktualisiert"
    );
    await runtime.query.deleteFrom("children").where("id", "=", "fixture-crud-child").execute();
    assert.equal(
      await runtime.query.selectFrom("children").select("id")
        .where("id", "=", "fixture-crud-child").executeTakeFirst(),
      undefined
    );

    await assert.rejects(
      runtime.query.insertInto("care_entry_children").values({
        care_entry_id: "fixture-entry",
        child_id: "missing-child",
        created_at: "2026-09-02T00:00:00.000Z",
        updated_at: "2026-09-02T00:00:00.000Z",
        deleted_at: null
      }).execute(),
      /FOREIGN KEY constraint failed/
    );

    await assert.rejects(
      runtime.transaction(async (transaction) => {
        await transaction.insertInto("settings").values({
          key: "fixture-rollback",
          value_json: "{}",
          created_at: "2026-09-02T00:00:00.000Z",
          updated_at: "2026-09-02T00:00:00.000Z"
        }).execute();
        throw new Error("rollback fixture");
      }),
      /rollback fixture/
    );
    assert.equal(
      await runtime.query.selectFrom("settings").select("key")
        .where("key", "=", "fixture-rollback").executeTakeFirst(),
      undefined
    );
    assert.deepEqual(await runtime.integrity(), {
      valid: true,
      foreignKeyViolations: 0
    });

    await runtime.migrate();
    assert.equal(
      (await runtime.query.selectFrom("schema_migrations")
        .select(({ fn }) => fn.count<number>("version").as("count"))
        .executeTakeFirstOrThrow()).count,
      currentMigrationFiles.length
    );
  } finally {
    await runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});
