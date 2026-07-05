import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { migrateDatabase } from "./db/migrationRunner.js";
import { buildSetupState, publicSetupState } from "./services/setupState.js";

const migrationsDirectory = resolve(process.cwd(), "server/migrations");
const timestamp = "2026-07-05T10:00:00.000Z";

function withDatabase(run: (database: Database.Database) => void): void {
  const root = mkdtempSync(join(tmpdir(), "betreuungskalender-setup-state-"));
  const database = new Database(join(root, "app.sqlite"));
  database.pragma("foreign_keys = ON");
  try {
    migrateDatabase(database, migrationsDirectory);
    run(database);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function insertChild(database: Database.Database): void {
  database.prepare(`
    INSERT INTO children (
      id, name, birth_month, birth_year, color, created_by, updated_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "child-setup-state",
    "Demo Child",
    7,
    2018,
    "#087f7b",
    "tester",
    "tester",
    timestamp,
    timestamp
  );
}

function insertCareParty(database: Database.Database): void {
  database.prepare(`
    INSERT INTO care_parties (
      id, name, kind, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "party-setup-state",
    "Hauptbetreuung",
    "other",
    "tester",
    "tester",
    timestamp,
    timestamp
  );
}

function insertSetting(database: Database.Database, key: string, value: unknown): void {
  database.prepare(`
    INSERT INTO settings (
      key, value_json, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(key, JSON.stringify(value), "tester", "tester", timestamp, timestamp);
}

test("detects a fresh installation without browser state", () => {
  withDatabase((database) => {
    const setup = buildSetupState(database);
    const publicState = publicSetupState(database);

    assert.equal(setup.complete, false);
    assert.equal(setup.required, true);
    assert.equal(setup.source, "fresh");
    assert.deepEqual(setup.counts, {
      children: 0,
      careParties: 0,
      appUsers: 1
    });
    assert.deepEqual(publicState, {
      complete: false,
      required: true
    });
  });
});

test("treats existing installations with domain setup data as complete", () => {
  withDatabase((database) => {
    insertChild(database);
    insertCareParty(database);

    const setup = buildSetupState(database);

    assert.equal(setup.complete, true);
    assert.equal(setup.required, false);
    assert.equal(setup.source, "existing-data");
    assert.equal(setup.counts.children, 1);
    assert.equal(setup.counts.careParties, 1);
  });
});

test("supports explicit setup completion metadata for later owner bootstrap", () => {
  withDatabase((database) => {
    insertSetting(database, "setup.completedAt", "2026-07-05T11:00:00.000Z");
    insertSetting(database, "setup.completedBy", "user_owner");

    const setup = buildSetupState(database);

    assert.equal(setup.complete, true);
    assert.equal(setup.required, false);
    assert.equal(setup.source, "explicit");
    assert.equal(setup.completedAt, "2026-07-05T11:00:00.000Z");
    assert.equal(setup.completedBy, "user_owner");
    assert.equal(setup.counts.children, 0);
    assert.equal(setup.counts.careParties, 0);
  });
});
