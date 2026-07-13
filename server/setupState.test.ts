import assert from "node:assert/strict";
import { mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { permissionsForRole, type RequestUser } from "./auth.js";
import { migrateDatabase } from "./db/migrationRunner.js";
import { membershipRoleForUser } from "./services/memberships.js";
import { bootstrapInstallationOwner, completeFirstUseSetup, SetupBootstrapError } from "./services/setupBootstrap.js";
import { buildSetupState, publicSetupState } from "./services/setupState.js";
import { OwnerSetupTokenError, OwnerSetupTokenStore } from "./services/ownerSetupTokens.js";

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

function settingValue(database: Database.Database, key: string): unknown {
  const row = database.prepare(`
    SELECT value_json AS valueJson
    FROM settings
    WHERE key = ? AND deleted_at IS NULL
  `).get(key) as { valueJson: string } | undefined;
  return row ? JSON.parse(row.valueJson) : undefined;
}

function setupUser(): RequestUser {
  return {
    id: "local-dev",
    externalSubject: "local-dev",
    displayName: "local-dev",
    groups: [],
    role: "readonly",
    permissions: permissionsForRole("readonly")
  };
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

test("bootstraps the first owner and records explicit setup completion", () => {
  withDatabase((database) => {
    const result = bootstrapInstallationOwner(
      setupUser(),
      "2026-07-05T12:00:00.000Z",
      database
    );
    const settings = database.prepare(`
      SELECT key, value_json AS valueJson
      FROM settings
      WHERE key IN ('setup.ownerUserId', 'setup.completedAt', 'setup.completedBy')
      ORDER BY key
    `).all() as Array<{ key: string; valueJson: string }>;
    const auditRows = database.prepare(`
      SELECT field_name AS fieldName
      FROM audit_log
      WHERE entity_type = 'setup'
      ORDER BY id
    `).all() as Array<{ fieldName: string }>;

    assert.deepEqual(result.setup, {
      complete: true,
      required: false
    });
    assert.equal(result.owner.id, "local-dev");
    assert.equal(result.owner.role, "admin");
    assert.equal(membershipRoleForUser("local-dev", database), "admin");
    assert.deepEqual(settings.map((row) => [row.key, JSON.parse(row.valueJson)]), [
      ["setup.completedAt", "2026-07-05T12:00:00.000Z"],
      ["setup.completedBy", "local-dev"],
      ["setup.ownerUserId", "local-dev"]
    ]);
    assert.deepEqual(auditRows.map((row) => row.fieldName), [
      "owner_bootstrap",
      "setup_completed"
    ]);
  });
});

test("does not allow silent owner takeover after setup completion", () => {
  withDatabase((database) => {
    insertSetting(database, "setup.completedAt", "2026-07-05T11:00:00.000Z");

    assert.throws(
      () => bootstrapInstallationOwner(setupUser(), timestamp, database),
      (error) =>
        error instanceof SetupBootstrapError &&
        error.code === "setup_already_complete" &&
        error.statusCode === 409
    );
    assert.equal(membershipRoleForUser("local-dev", database), undefined);
  });
});

test("owner setup token claims an owner once without completing the wizard", () => {
  withDatabase((database) => {
    const directory = mkdtempSync(join(tmpdir(), "betreuungskalender-owner-token-"));
    const tokenFile = join(directory, "owner-token");
    try {
      writeFileSync(tokenFile, "fictional-owner-secret\n", { mode: 0o600 });
      const issuedAt = new Date("2026-07-05T11:00:00.000Z");
      utimesSync(tokenFile, issuedAt, issuedAt);
      const store = new OwnerSetupTokenStore({
        tokenFile,
        ttlSeconds: 3600,
        database
      });
      const hash = store.begin(
        "fictional-owner-secret",
        new Date("2026-07-05T11:15:00.000Z")
      );
      assert.match(hash, /^[0-9a-f]{64}$/);
      const stored = database.prepare(`
        SELECT token_hash AS tokenHash
        FROM owner_setup_tokens
      `).get() as { tokenHash: string };
      assert.equal(stored.tokenHash, hash);
      assert.equal(stored.tokenHash.includes("fictional-owner-secret"), false);

      store.consumeAndClaim(
        hash,
        setupUser(),
        new Date("2026-07-05T11:20:00.000Z")
      );
      assert.equal(membershipRoleForUser("local-dev", database), "admin");
      assert.equal(buildSetupState(database).complete, false);

      assert.throws(
        () => store.begin(
          "fictional-owner-secret",
          new Date("2026-07-05T11:25:00.000Z")
        ),
        (error) =>
          error instanceof OwnerSetupTokenError &&
          error.code === "owner_setup_consumed"
      );
      const auditFields = database.prepare(`
        SELECT field_name AS fieldName
        FROM audit_log
        WHERE entity_type = 'setup'
        ORDER BY id
      `).all() as Array<{ fieldName: string }>;
      assert.deepEqual(auditFields.map((row) => row.fieldName), [
        "owner_setup_token_consumed",
        "owner_bootstrap",
        "owner_setup_reuse_rejected"
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("owner setup rejects a pending context after the mounted token rotates", () => {
  withDatabase((database) => {
    const directory = mkdtempSync(join(tmpdir(), "betreuungskalender-owner-rotation-"));
    const tokenFile = join(directory, "owner-token");
    try {
      const issuedAt = new Date("2026-07-05T11:00:00.000Z");
      writeFileSync(tokenFile, "fictional-owner-secret-a\n", { mode: 0o600 });
      utimesSync(tokenFile, issuedAt, issuedAt);
      const store = new OwnerSetupTokenStore({ tokenFile, ttlSeconds: 3600, database });
      const hash = store.begin("fictional-owner-secret-a", new Date("2026-07-05T11:05:00.000Z"));

      writeFileSync(tokenFile, "fictional-owner-secret-b\n", { mode: 0o600 });
      utimesSync(tokenFile, issuedAt, issuedAt);

      assert.throws(
        () => store.consumeAndClaim(hash, setupUser(), new Date("2026-07-05T11:10:00.000Z")),
        (error) => error instanceof OwnerSetupTokenError && error.code === "owner_setup_invalid"
      );
      assert.equal(membershipRoleForUser("local-dev", database), undefined);
      assert.equal(settingValue(database, "setup.ownerUserId"), undefined);
      const audits = database.prepare(`
        SELECT field_name AS fieldName, new_value AS newValue
        FROM audit_log
        WHERE entity_type = 'setup'
      `).all() as Array<{ fieldName: string; newValue: string }>;
      assert.deepEqual(audits.map((row) => row.fieldName), ["owner_setup_context_rejected"]);
      assert.equal(JSON.stringify(audits).includes("fictional-owner-secret"), false);
      assert.equal(JSON.stringify(audits).includes(hash), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("owner setup rejects a pending context after the mounted token is removed", () => {
  withDatabase((database) => {
    const directory = mkdtempSync(join(tmpdir(), "betreuungskalender-owner-removal-"));
    const tokenFile = join(directory, "owner-token");
    try {
      const issuedAt = new Date("2026-07-05T11:00:00.000Z");
      writeFileSync(tokenFile, "fictional-owner-secret\n", { mode: 0o600 });
      utimesSync(tokenFile, issuedAt, issuedAt);
      const store = new OwnerSetupTokenStore({ tokenFile, ttlSeconds: 3600, database });
      const hash = store.begin("fictional-owner-secret", new Date("2026-07-05T11:05:00.000Z"));

      unlinkSync(tokenFile);

      assert.throws(
        () => store.consumeAndClaim(hash, setupUser(), new Date("2026-07-05T11:10:00.000Z")),
        (error) => error instanceof OwnerSetupTokenError && error.code === "owner_setup_invalid"
      );
      assert.equal(membershipRoleForUser("local-dev", database), undefined);
      assert.equal(settingValue(database, "setup.ownerUserId"), undefined);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("completes first-use setup with owner, care party, child, and defaults", () => {
  withDatabase((database) => {
    const result = completeFirstUseSetup(
      setupUser(),
      {
        installationLabel: "Private calendar",
        careParty: {
          name: "Primary care",
          kind: "other"
        },
        secondaryCareParty: {
          name: "Other parent",
          kind: "mother"
        },
        primaryCareParty: "secondary",
        defaultCareParty: "primary",
        child: {
          name: "Child A",
          birthMonth: 4,
          birthYear: 2017,
          color: "#0d9488"
        }
      },
      "2026-07-05T12:30:00.000Z",
      database
    );

    const setup = buildSetupState(database);
    const careParties = database.prepare(`
      SELECT id, name, kind
      FROM care_parties
      WHERE id IN (?, ?) AND deleted_at IS NULL
      ORDER BY name
    `).all(result.created.carePartyId, result.created.secondaryCarePartyId) as Array<{
      id: string;
      name: string;
      kind: string;
    }>;
    const child = database.prepare(`
      SELECT id, name, birth_month AS birthMonth, birth_year AS birthYear
      FROM children
      WHERE id = ? AND deleted_at IS NULL
    `).get(result.created.childId) as {
      id: string;
      name: string;
      birthMonth: number;
      birthYear: number;
    } | undefined;
    const settings = database.prepare(`
      SELECT key, value_json AS valueJson
      FROM settings
      WHERE key IN (
        'defaultResponsiblePartyId',
        'primaryCarePartyId',
        'setup.completedAt',
        'setup.completedBy',
        'setup.installationLabel',
        'setup.ownerUserId'
      )
      ORDER BY key
    `).all() as Array<{ key: string; valueJson: string }>;

    assert.deepEqual(result.setup, {
      complete: true,
      required: false
    });
    assert.equal(result.owner.id, "local-dev");
    assert.equal(result.owner.role, "admin");
    assert.equal(membershipRoleForUser("local-dev", database), "admin");
    assert.equal(setup.complete, true);
    assert.equal(setup.required, false);
    assert.equal(setup.counts.children, 1);
    assert.equal(setup.counts.careParties, 2);
    assert.deepEqual(careParties.map((party) => [party.name, party.kind]), [
      ["Other parent", "mother"],
      ["Primary care", "other"]
    ]);
    assert.equal(child?.name, "Child A");
    assert.equal(child?.birthMonth, 4);
    assert.equal(child?.birthYear, 2017);
    assert.deepEqual(settings.map((row) => [row.key, JSON.parse(row.valueJson)]), [
      ["defaultResponsiblePartyId", result.created.carePartyId],
      ["primaryCarePartyId", result.created.secondaryCarePartyId],
      ["setup.completedAt", "2026-07-05T12:30:00.000Z"],
      ["setup.completedBy", "local-dev"],
      ["setup.installationLabel", "Private calendar"],
      ["setup.ownerUserId", "local-dev"]
    ]);
    assert.equal(result.created.primaryCarePartyId, result.created.secondaryCarePartyId);
    assert.equal(result.created.defaultCarePartyId, result.created.carePartyId);
  });
});
