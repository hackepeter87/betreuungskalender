import assert from "node:assert/strict";
import { mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { permissionsForRole, type RequestUser } from "./auth.js";
import { migrateDatabase } from "./db/migrationRunner.js";
import { createSqlitePersistenceRuntime, type PersistenceRuntime } from "./db/runtime.js";
import { membershipRoleForUser } from "./services/memberships.js";
import { completeFirstUseSetup } from "./services/setupBootstrap.js";
import { buildSetupState, publicSetupState } from "./services/setupState.js";
import { OwnerSetupTokenError, OwnerSetupTokenStore } from "./services/ownerSetupTokens.js";
import { setupFirstUseInputSchema } from "./validation/schemas.js";

const migrationsDirectory = resolve(process.cwd(), "server/migrations");
const timestamp = "2026-07-05T10:00:00.000Z";

async function withDatabase(
  run: (database: Database.Database, persistence: PersistenceRuntime) => Promise<void>
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "betreuungskalender-setup-state-"));
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

test("detects a fresh installation without browser state", async () => {
  await withDatabase(async (_database, persistence) => {
    const setup = await buildSetupState(persistence.query);
    const publicState = await publicSetupState(persistence.query);

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

test("treats existing installations with domain setup data as complete", async () => {
  await withDatabase(async (database, persistence) => {
    insertChild(database);
    insertCareParty(database);

    const setup = await buildSetupState(persistence.query);

    assert.equal(setup.complete, true);
    assert.equal(setup.required, false);
    assert.equal(setup.source, "existing-data");
    assert.equal(setup.counts.children, 1);
    assert.equal(setup.counts.careParties, 1);
  });
});

test("supports explicit setup completion metadata for later owner bootstrap", async () => {
  await withDatabase(async (database, persistence) => {
    insertSetting(database, "setup.completedAt", "2026-07-05T11:00:00.000Z");
    insertSetting(database, "setup.completedBy", "user_owner");

    const setup = await buildSetupState(persistence.query);

    assert.equal(setup.complete, true);
    assert.equal(setup.required, false);
    assert.equal(setup.source, "explicit");
    assert.equal(setup.completedAt, "2026-07-05T11:00:00.000Z");
    assert.equal(setup.completedBy, "user_owner");
    assert.equal(setup.counts.children, 0);
    assert.equal(setup.counts.careParties, 0);
  });
});

test("owner setup token claims an owner once without completing the wizard", async () => {
  await withDatabase(async (database, persistence) => {
    const directory = mkdtempSync(join(tmpdir(), "betreuungskalender-owner-token-"));
    const tokenFile = join(directory, "owner-token");
    try {
      writeFileSync(tokenFile, "fictional-owner-secret\n", { mode: 0o600 });
      const issuedAt = new Date("2026-07-05T11:00:00.000Z");
      utimesSync(tokenFile, issuedAt, issuedAt);
      const store = new OwnerSetupTokenStore({
        tokenFile,
        ttlSeconds: 3600,
        persistence
      });
      const hash = await store.begin(
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

      await store.consumeAndClaim(
        hash,
        setupUser(),
        new Date("2026-07-05T11:20:00.000Z")
      );
      assert.equal(await membershipRoleForUser("local-dev", persistence.query), "admin");
      assert.equal((await buildSetupState(persistence.query)).complete, false);

      await assert.rejects(
        store.begin(
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

test("owner setup rolls back user, membership, token, and owner state after a late failure", async () => {
  await withDatabase(async (database, persistence) => {
    const directory = mkdtempSync(join(tmpdir(), "betreuungskalender-owner-rollback-"));
    const tokenFile = join(directory, "owner-token");
    try {
      writeFileSync(tokenFile, "fictional-owner-rollback-secret\n", { mode: 0o600 });
      const issuedAt = new Date("2026-07-05T11:00:00.000Z");
      utimesSync(tokenFile, issuedAt, issuedAt);
      const store = new OwnerSetupTokenStore({ tokenFile, ttlSeconds: 3600, persistence });
      const hash = await store.begin(
        "fictional-owner-rollback-secret",
        new Date("2026-07-05T11:05:00.000Z")
      );
      const unknownUser = { ...setupUser(), id: "missing-owner", externalSubject: "missing-owner" };
      database.exec(`
        CREATE TRIGGER reject_test_owner_setting
        BEFORE INSERT ON settings
        WHEN NEW.key = 'setup.ownerUserId'
        BEGIN
          SELECT RAISE(ABORT, 'forced owner setup failure');
        END
      `);

      await assert.rejects(
        store.consumeAndClaim(hash, unknownUser, new Date("2026-07-05T11:10:00.000Z")),
        /forced owner setup failure/
      );

      assert.deepEqual(database.prepare(`
        SELECT consumed_at AS consumedAt, consumed_by AS consumedBy
        FROM owner_setup_tokens
        WHERE token_hash = ?
      `).get(hash), { consumedAt: null, consumedBy: null });
      assert.equal(settingValue(database, "setup.ownerUserId"), undefined);
      const membershipCount = database.prepare(`
        SELECT COUNT(*) AS count
        FROM app_memberships
        WHERE user_id = 'missing-owner'
      `).get() as { count: number };
      assert.equal(membershipCount.count, 0);
      const userCount = database.prepare(`
        SELECT COUNT(*) AS count
        FROM app_users
        WHERE id = 'missing-owner'
      `).get() as { count: number };
      assert.equal(userCount.count, 0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("owner setup token claims an owner for existing data without changing domain records", async () => {
  await withDatabase(async (database, persistence) => {
    insertChild(database);
    insertCareParty(database);
    const before = {
      child: database.prepare("SELECT * FROM children WHERE id = ?").get("child-setup-state"),
      careParty: database.prepare("SELECT * FROM care_parties WHERE id = ?").get("party-setup-state")
    };
    const directory = mkdtempSync(join(tmpdir(), "betreuungskalender-existing-owner-token-"));
    const tokenFile = join(directory, "owner-token");
    try {
      writeFileSync(tokenFile, "fictional-existing-owner-secret\n", { mode: 0o600 });
      const issuedAt = new Date("2026-07-05T11:00:00.000Z");
      utimesSync(tokenFile, issuedAt, issuedAt);
      const store = new OwnerSetupTokenStore({ tokenFile, ttlSeconds: 3600, persistence });
      const hash = await store.begin(
        "fictional-existing-owner-secret",
        new Date("2026-07-05T11:05:00.000Z")
      );

      await store.consumeAndClaim(hash, setupUser(), new Date("2026-07-05T11:10:00.000Z"));

      assert.equal(settingValue(database, "setup.ownerUserId"), "local-dev");
      assert.equal((await buildSetupState(persistence.query)).source, "existing-data");
      assert.deepEqual(
        database.prepare("SELECT * FROM children WHERE id = ?").get("child-setup-state"),
        before.child
      );
      assert.deepEqual(
        database.prepare("SELECT * FROM care_parties WHERE id = ?").get("party-setup-state"),
        before.careParty
      );
      assert.equal(settingValue(database, "setup.completedAt"), undefined);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("owner setup rejects a pending context after the mounted token rotates", async () => {
  await withDatabase(async (database, persistence) => {
    const directory = mkdtempSync(join(tmpdir(), "betreuungskalender-owner-rotation-"));
    const tokenFile = join(directory, "owner-token");
    try {
      const issuedAt = new Date("2026-07-05T11:00:00.000Z");
      writeFileSync(tokenFile, "fictional-owner-secret-a\n", { mode: 0o600 });
      utimesSync(tokenFile, issuedAt, issuedAt);
      const store = new OwnerSetupTokenStore({ tokenFile, ttlSeconds: 3600, persistence });
      const hash = await store.begin("fictional-owner-secret-a", new Date("2026-07-05T11:05:00.000Z"));

      writeFileSync(tokenFile, "fictional-owner-secret-b\n", { mode: 0o600 });
      utimesSync(tokenFile, issuedAt, issuedAt);

      await assert.rejects(
        store.consumeAndClaim(hash, setupUser(), new Date("2026-07-05T11:10:00.000Z")),
        (error) => error instanceof OwnerSetupTokenError && error.code === "owner_setup_invalid"
      );
      assert.equal(await membershipRoleForUser("local-dev", persistence.query), "admin");
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

test("owner setup rejects a pending context after the mounted token is removed", async () => {
  await withDatabase(async (database, persistence) => {
    const directory = mkdtempSync(join(tmpdir(), "betreuungskalender-owner-removal-"));
    const tokenFile = join(directory, "owner-token");
    try {
      const issuedAt = new Date("2026-07-05T11:00:00.000Z");
      writeFileSync(tokenFile, "fictional-owner-secret\n", { mode: 0o600 });
      utimesSync(tokenFile, issuedAt, issuedAt);
      const store = new OwnerSetupTokenStore({ tokenFile, ttlSeconds: 3600, persistence });
      const hash = await store.begin("fictional-owner-secret", new Date("2026-07-05T11:05:00.000Z"));

      unlinkSync(tokenFile);

      await assert.rejects(
        store.consumeAndClaim(hash, setupUser(), new Date("2026-07-05T11:10:00.000Z")),
        (error) => error instanceof OwnerSetupTokenError && error.code === "owner_setup_invalid"
      );
      assert.equal(await membershipRoleForUser("local-dev", persistence.query), "admin");
      assert.equal(settingValue(database, "setup.ownerUserId"), undefined);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("completes first-use setup with owner, care parties, multiple children, and defaults", async () => {
  await withDatabase(async (database, persistence) => {
    const result = await completeFirstUseSetup(
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
        children: [
          {
            name: "Child A",
            birthMonth: 4,
            birthYear: 2017,
            color: "#0d9488"
          },
          {
            name: "Child B",
            birthMonth: 9,
            birthYear: 2019,
            color: "#6d5bd0"
          },
          {
            name: "Child C",
            birthMonth: 12,
            birthYear: 2021,
            color: "#e68000"
          }
        ]
      },
      persistence,
      "2026-07-05T12:30:00.000Z"
    );

    const setup = await buildSetupState(persistence.query);
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
    const children = database.prepare(`
      SELECT id, name, birth_month AS birthMonth, birth_year AS birthYear
      FROM children
      WHERE deleted_at IS NULL
      ORDER BY name
    `).all() as Array<{
      id: string;
      name: string;
      birthMonth: number;
      birthYear: number;
    }>;
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
    assert.equal(await membershipRoleForUser("local-dev", persistence.query), "admin");
    assert.equal(setup.complete, true);
    assert.equal(setup.required, false);
    assert.equal(setup.counts.children, 3);
    assert.equal(setup.counts.careParties, 2);
    assert.deepEqual(careParties.map((party) => [party.name, party.kind]), [
      ["Other parent", "mother"],
      ["Primary care", "other"]
    ]);
    assert.deepEqual(children.map((child) => [child.name, child.birthMonth, child.birthYear]), [
      ["Child A", 4, 2017],
      ["Child B", 9, 2019],
      ["Child C", 12, 2021]
    ]);
    assert.equal(result.created.childIds.length, 3);
    assert.equal(result.created.childId, result.created.childIds[0]);
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

test("accepts the legacy child input but rejects ambiguous child forms", () => {
  const common = {
    ownerConfirmed: true as const,
    careParty: { name: "Care party", kind: "other" as const },
    defaultCareParty: "primary" as const
  };
  const child = {
    name: "Child A",
    birthMonth: 4,
    birthYear: 2017,
    color: "#0d9488"
  };

  const legacy = setupFirstUseInputSchema.parse({ ...common, child });
  assert.deepEqual(legacy.children, [child]);
  const current = setupFirstUseInputSchema.parse({ ...common, children: [child] });
  assert.deepEqual(current.children, [child]);
  assert.equal(setupFirstUseInputSchema.safeParse({ ...common, child, children: [child] }).success, false);
});

test("validates every setup child and limits the initial child list", () => {
  const common = {
    ownerConfirmed: true as const,
    careParty: { name: "Care party", kind: "other" as const },
    defaultCareParty: "primary" as const
  };
  const child = {
    name: "Child",
    birthMonth: 4,
    birthYear: 2017,
    color: "#0d9488"
  };

  assert.equal(setupFirstUseInputSchema.safeParse({
    ...common,
    children: [child, { ...child, birthMonth: 13 }]
  }).success, false);
  assert.equal(setupFirstUseInputSchema.safeParse({
    ...common,
    children: Array.from({ length: 21 }, (_, index) => ({ ...child, name: `Child ${index + 1}` }))
  }).success, false);
});

test("allows first-use setup without children", async () => {
  await withDatabase(async (_database, persistence) => {
    const result = await completeFirstUseSetup(
      setupUser(),
      {
        careParty: { name: "Care party", kind: "other" },
        defaultCareParty: "primary",
        children: []
      },
      persistence,
      "2026-07-05T12:30:00.000Z"
    );

    assert.deepEqual(result.created.childIds, []);
    assert.equal(result.created.childId, undefined);
    assert.equal((await buildSetupState(persistence.query)).counts.children, 0);
  });
});

test("rolls back the complete first-use setup when one child cannot be stored", async () => {
  await withDatabase(async (database, persistence) => {
    await assert.rejects(completeFirstUseSetup(
      setupUser(),
      {
        careParty: { name: "Care party", kind: "other" },
        defaultCareParty: "primary",
        children: [
          { name: "Child A", birthMonth: 4, birthYear: 2017, color: "#0d9488" },
          { name: "Invalid child", birthMonth: 13, birthYear: 2019, color: "#6d5bd0" }
        ]
      },
      persistence,
      "2026-07-05T12:30:00.000Z"
    ));

    const childCount = database.prepare("SELECT COUNT(*) AS count FROM children").get() as { count: number };
    const carePartyCount = database.prepare("SELECT COUNT(*) AS count FROM care_parties").get() as { count: number };
    assert.equal(childCount.count, 0);
    assert.equal(carePartyCount.count, 0);
    assert.equal((await buildSetupState(persistence.query)).complete, false);
  });
});
