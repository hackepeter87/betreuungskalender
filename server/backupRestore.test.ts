import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { migrateDatabase } from "./db/migrationRunner.js";
import { backupDatabase } from "./services/sqliteBackup.js";

const migrationsDirectory = resolve(process.cwd(), "server/migrations");
const expectedMigrations = [
  "001_initial_schema",
  "002_unavailable_periods",
  "003_api_source_of_truth",
  "004_legacy_migration",
  "005_external_calendars",
  "006_oidc_users",
  "007_actor_metadata",
  "008_calendar_feed_tokens",
  "009_native_oidc_login_states",
  "010_native_oidc_sessions"
];

async function withTemporaryDirectory(
  name: string,
  run: (directory: string) => void | Promise<void>
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), `betreuungskalender-${name}-`));
  try {
    await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function openDatabase(path: string): Database.Database {
  const database = new Database(path);
  database.pragma("foreign_keys = ON");
  return database;
}

function appliedMigrations(database: Database.Database): string[] {
  return (database.prepare(
    "SELECT version FROM schema_migrations ORDER BY version"
  ).all() as Array<{ version: string }>).map((row) => row.version);
}

function insertFictionalData(database: Database.Database): void {
  const timestamp = "2026-03-01T10:00:00.000Z";
  database.prepare(`
    INSERT INTO children (
      id, name, birth_month, birth_year, color, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "fixture-child-1",
    "Alex Beispiel",
    4,
    2018,
    "#087f7b",
    timestamp,
    timestamp
  );
  database.prepare(`
    INSERT INTO care_entries (
      id, start_datetime, end_datetime, status, care_scope,
      overnight, school_handover, holiday, weekend, additional_care,
      duration_minutes, is_contact_time, created_by, updated_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "fixture-entry-1",
    "2026-03-06T16:00:00.000Z",
    "2026-03-08T18:00:00.000Z",
    "completed",
    "overnight",
    1,
    0,
    0,
    1,
    0,
    3000,
    1,
    "test@example.invalid",
    "test@example.invalid",
    timestamp,
    timestamp
  );
  database.prepare(`
    INSERT INTO care_entry_children (
      care_entry_id, child_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?)
  `).run("fixture-entry-1", "fixture-child-1", timestamp, timestamp);
  database.prepare(`
    INSERT INTO trips (
      id, care_entry_id, purpose, km, own_car, reimbursed,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "fixture-trip-1",
    "fixture-entry-1",
    "pickup",
    18.5,
    1,
    0,
    timestamp,
    timestamp
  );
}

function domainSnapshot(database: Database.Database): unknown {
  return {
    children: database.prepare(
      "SELECT id, name, birth_month, birth_year, color FROM children ORDER BY id"
    ).all(),
    entries: database.prepare(`
      SELECT id, start_datetime, end_datetime, status, care_scope,
        overnight, weekend, duration_minutes
      FROM care_entries
      ORDER BY id
    `).all(),
    entryChildren: database.prepare(`
      SELECT care_entry_id, child_id
      FROM care_entry_children
      ORDER BY care_entry_id, child_id
    `).all(),
    trips: database.prepare(
      "SELECT id, care_entry_id, purpose, km, own_car, reimbursed FROM trips ORDER BY id"
    ).all(),
    migrations: appliedMigrations(database)
  };
}

test("empty database startup applies every migration", async () => {
  await withTemporaryDirectory("empty-startup", (directory) => {
    const database = openDatabase(join(directory, "app.sqlite"));
    try {
      migrateDatabase(database, migrationsDirectory);
      assert.deepEqual(appliedMigrations(database), expectedMigrations);
      const childCount = database.prepare(
        "SELECT COUNT(*) AS count FROM children"
      ).get() as { count: number };
      assert.equal(
        childCount.count,
        0
      );
      const localUser = database.prepare(
        "SELECT role FROM app_users WHERE external_subject = ?"
      ).get("local-dev") as { role: string };
      assert.equal(localUser.role, "admin");
    } finally {
      database.close();
    }
  });
});

test("existing database startup preserves fictional data", async () => {
  await withTemporaryDirectory("existing-startup", (directory) => {
    const databasePath = join(directory, "app.sqlite");
    const initial = openDatabase(databasePath);
    migrateDatabase(initial, migrationsDirectory);
    insertFictionalData(initial);
    initial.close();

    const restarted = openDatabase(databasePath);
    try {
      migrateDatabase(restarted, migrationsDirectory);
      assert.deepEqual(appliedMigrations(restarted), expectedMigrations);
      const child = restarted.prepare(
        "SELECT name FROM children WHERE id = ?"
      ).get("fixture-child-1") as { name: string };
      assert.equal(
        child.name,
        "Alex Beispiel"
      );
    } finally {
      restarted.close();
    }
  });
});

test("actor metadata supports multi-user audit attribution", async () => {
  await withTemporaryDirectory("actor-metadata", (directory) => {
    const database = openDatabase(join(directory, "app.sqlite"));
    try {
      migrateDatabase(database, migrationsDirectory);
      const timestamp = "2026-03-01T10:00:00.000Z";
      database.prepare(`
        INSERT INTO app_users (
          id, external_subject, email, display_name, role, groups_json,
          last_seen_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "user_alpha",
        "subject-alpha",
        "alpha@example.invalid",
        "Alpha Parent",
        "parent",
        "[]",
        timestamp,
        timestamp,
        timestamp
      );
      database.prepare(`
        INSERT INTO app_users (
          id, external_subject, email, display_name, role, groups_json,
          last_seen_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "user_beta",
        "subject-beta",
        "beta@example.invalid",
        "Beta Parent",
        "parent",
        "[]",
        timestamp,
        timestamp,
        timestamp
      );
      database.prepare(`
        INSERT INTO children (
          id, name, birth_month, birth_year, color,
          created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "fixture-child-actor",
        "Alex Beispiel",
        4,
        2018,
        "#087f7b",
        "user_alpha",
        "user_beta",
        timestamp,
        "2026-03-02T10:00:00.000Z"
      );
      database.prepare(`
        INSERT INTO audit_log (
          timestamp, user_email, entity_type, entity_id, action, field_name,
          old_value, new_value, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "2026-03-02T10:00:00.000Z",
        "user_beta",
        "child",
        "fixture-child-actor",
        "updated",
        "name",
        "Alex",
        "Alex Beispiel",
        "2026-03-02T10:00:00.000Z",
        "2026-03-02T10:00:00.000Z"
      );

      assert.deepEqual(database.prepare(`
        SELECT created_by AS createdBy, updated_by AS updatedBy
        FROM children
        WHERE id = ?
      `).get("fixture-child-actor"), {
        createdBy: "user_alpha",
        updatedBy: "user_beta"
      });
      assert.deepEqual(database.prepare(`
        SELECT audit_log.user_email AS userEmail, app_users.display_name AS userDisplayName
        FROM audit_log
        LEFT JOIN app_users ON app_users.id = audit_log.user_email
        WHERE audit_log.entity_id = ?
      `).get("fixture-child-actor"), {
        userEmail: "user_beta",
        userDisplayName: "Beta Parent"
      });
    } finally {
      database.close();
    }
  });
});

test("repeated migrations are idempotent", async () => {
  await withTemporaryDirectory("repeat-migrations", (directory) => {
    const database = openDatabase(join(directory, "app.sqlite"));
    try {
      migrateDatabase(database, migrationsDirectory);
      const firstAppliedAt = database.prepare(`
        SELECT version, applied_at
        FROM schema_migrations
        ORDER BY version
      `).all();

      migrateDatabase(database, migrationsDirectory);

      assert.deepEqual(database.prepare(`
        SELECT version, applied_at
        FROM schema_migrations
        ORDER BY version
      `).all(), firstAppliedAt);
    } finally {
      database.close();
    }
  });
});

test("backup restores the complete fictional dataset", async () => {
  await withTemporaryDirectory("backup-restore", async (directory) => {
    const sourcePath = join(directory, "source.sqlite");
    const backupDirectory = join(directory, "backups");
    const source = openDatabase(sourcePath);
    migrateDatabase(source, migrationsDirectory);
    insertFictionalData(source);
    const expected = domainSnapshot(source);

    const backupName = await backupDatabase(
      source,
      backupDirectory,
      new Date("2026-03-10T12:34:56.000Z")
    );
    source.close();

    assert.equal(
      backupName,
      "betreuungskalender-sqlite-2026-03-10T12-34-56Z.sqlite"
    );
    const restoredPath = join(directory, "restored.sqlite");
    copyFileSync(join(backupDirectory, backupName), restoredPath);

    const restored = new Database(restoredPath, {
      readonly: true,
      fileMustExist: true
    });
    try {
      assert.equal(restored.pragma("integrity_check", { simple: true }), "ok");
      assert.deepEqual(domainSnapshot(restored), expected);
    } finally {
      restored.close();
    }
  });
});
