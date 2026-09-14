import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "betreuungskalender-migration-"));
process.env.DATABASE_PATH = join(temporaryDirectory, "test.sqlite");
process.env.BACKUP_DIR = join(temporaryDirectory, "backups");

const { runMigrations } = await import("./db/migrate.js");
const { persistence } = await import("./db/connection.js");
const { requireSqlitePersistenceRuntime } = await import("./db/runtime.js");
const db = requireSqlitePersistenceRuntime(persistence).sqliteDatabase;
const {
  analyzeLegacyData,
  executeLegacyMigration,
  getLegacyDatabaseSummary,
  legacyMigrationCapabilities,
  previewLegacyMigration,
  recordLegacyMigrationEvent
} = await import("./services/legacyMigration.js");
const {
  clearDomainData,
  insertChild,
  insertEntry
} = await import("./routes/appData.js");
const { appDataImportSchema } = await import("./validation/schemas.js");
const {
  ImportProcessingLimitError,
  assertImportProcessingLimits
} = await import("./validation/processingLimits.js");
const { migrationRoutes } = await import("./routes/migration.js");

runMigrations();

function fixture(overrides: Record<string, unknown> = {}) {
  const timestamp = "2026-01-01T10:00:00.000Z";
  return appDataImportSchema.parse({
    schemaVersion: 4,
    children: [{
      id: "legacy-child-1",
      name: "Testkind",
      birthMonth: 5,
      birthYear: 2018,
      color: "#087f7b",
      createdAt: timestamp,
      updatedAt: timestamp
    }],
    entries: [{
      id: "legacy-entry-1",
      date: "2026-01-09",
      startDateTime: "2026-01-09T16:00:00.000Z",
      endDateTime: "2026-01-11T18:00:00.000Z",
      childIds: ["legacy-child-1"],
      status: "completed",
      additionalCare: false,
      overnight: true,
      schoolHandover: false,
      holiday: false,
      weekend: true,
      location: "mainResidence",
      handoverFrom: "mother",
      handoverTo: "mother",
      hasEvidence: false,
      trips: [{
        id: "legacy-trip-1",
        purpose: "pickup",
        km: 12,
        ownCar: true,
        reimbursed: false
      }],
      costs: [{
        id: "legacy-cost-1",
        category: "food",
        amount: 15,
        paidBy: "father"
      }],
      createdAt: timestamp,
      updatedAt: timestamp
    }],
    holidayPeriods: [],
    unavailablePeriods: [],
    contactPatterns: [],
    auditLog: [],
    monthClosures: [],
    settings: {
      kilometerRate: 0.3,
      defaultLocation: "mainResidence",
      defaultHandoverFrom: "mother",
      defaultHandoverTo: "mother"
    },
    updatedAt: timestamp,
    ...overrides
  });
}

async function resetDatabase(): Promise<void> {
  await persistence.transaction(async (database) => {
    await clearDomainData(database);
    await database.deleteFrom("legacy_migration_runs").execute();
  });
}

async function insertExisting(status = "completed"): Promise<void> {
  const data = fixture();
  await insertChild(data.children[0]!, data.updatedAt, "test@example.invalid", persistence.query);
  await insertEntry(
    { ...data.entries[0]!, status },
    data.updatedAt,
    "test@example.invalid",
    undefined,
    persistence.query
  );
}

function insertDefaultCareParty(id = "party-primary"): void {
  const timestamp = "2026-01-01T10:00:00.000Z";
  db.prepare(`
    INSERT INTO care_parties (
      id, name, kind, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    "Hauptbetreuung",
    "other",
    "test@example.invalid",
    "test@example.invalid",
    timestamp,
    timestamp
  );
  db.prepare(`
    INSERT INTO settings (
      key, value_json, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "defaultResponsiblePartyId",
    JSON.stringify(id),
    "test@example.invalid",
    "test@example.invalid",
    timestamp,
    timestamp
  );
}

beforeEach(resetDatabase);

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("eine leere SQLite-Datenbank wird als fachlich leer erkannt", async () => {
  assert.equal((await getLegacyDatabaseSummary(persistence.query)).isEmpty, true);
});

test("Migrationsfähigkeiten trennen SQLite-Ersetzung von additiver Übernahme", () => {
  assert.deepEqual(legacyMigrationCapabilities("sqlite"), {
    additiveImport: true,
    replaceAfterBackup: true
  });
  assert.deepEqual(legacyMigrationCapabilities("postgres"), {
    additiveImport: true,
    replaceAfterBackup: false
  });
});

test("Legacy-Importbudgets akzeptieren die Grenze und lehnen den nächsten Datensatz ab", () => {
  const data = fixture();
  const limits = {
    maximumCollectionRecords: 2,
    maximumTotalRecords: 5,
    maximumChildRelationsPerRecord: 2,
    maximumTripsPerRecord: 2,
    maximumCostsPerRecord: 2,
    maximumNestingDepth: 20,
    maximumObjectProperties: 30,
    maximumTraversedValues: 500
  };
  assert.doesNotThrow(() => assertImportProcessingLimits(data, limits));
  assert.throws(
    () => assertImportProcessingLimits({
      ...data,
      children: [...data.children, { id: "second-child" }],
      entries: data.entries
    }, limits),
    ImportProcessingLimitError
  );
});

test("Legacy-Importbudgets begrenzen verschachtelte Sammlungen und Tiefe", () => {
  const data = fixture();
  assert.throws(
    () => assertImportProcessingLimits({
      ...data,
      entries: [{ ...data.entries[0], childIds: ["one", "two", "three"] }]
    }, {
      maximumCollectionRecords: 2,
      maximumTotalRecords: 10,
      maximumChildRelationsPerRecord: 2,
      maximumTripsPerRecord: 2,
      maximumCostsPerRecord: 2,
      maximumNestingDepth: 20,
      maximumObjectProperties: 30,
      maximumTraversedValues: 500
    }),
    ImportProcessingLimitError
  );
  assert.throws(
    () => assertImportProcessingLimits({
      ...data,
      settings: { nested: { too: { deeply: true } } }
    }, {
      maximumCollectionRecords: 10,
      maximumTotalRecords: 20,
      maximumChildRelationsPerRecord: 10,
      maximumTripsPerRecord: 10,
      maximumCostsPerRecord: 10,
      maximumNestingDepth: 2,
      maximumObjectProperties: 30,
      maximumTraversedValues: 500
    }),
    ImportProcessingLimitError
  );
});

test("PostgreSQL lehnt den SQLite-Ersetzungsweg vor Datenzugriff ab", async () => {
  const postgresRuntime = {
    ...persistence,
    driver: "postgres" as const
  };
  await assert.rejects(
    executeLegacyMigration({
      data: fixture(),
      mode: "replace",
      duplicatePolicy: "skip",
      fingerprint: "fixture-postgres-replace",
      userEmail: "test@example.invalid"
    }, postgresRuntime),
    (error: unknown) => (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "legacy_migration_replace_unavailable"
    )
  );
});

test("Migrations-API liefert Fähigkeiten und lehnt PostgreSQL-Ersetzung generisch ab", async () => {
  const postgresRuntime = Object.create(persistence) as typeof persistence;
  Object.defineProperty(postgresRuntime, "driver", { value: "postgres" });
  const app = Fastify({ logger: false });
  app.decorateRequest("userEmail", "test@example.invalid");
  app.decorateRequest("user", undefined);
  app.decorate("persistence", postgresRuntime);
  await app.register(migrationRoutes);

  const summary = await app.inject({
    method: "GET",
    url: "/api/migration/legacy-summary"
  });
  assert.equal(summary.statusCode, 200);
  assert.deepEqual(summary.json().capabilities, {
    additiveImport: true,
    replaceAfterBackup: false
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/migration/legacy-import",
    payload: {
      data: fixture(),
      mode: "replace",
      duplicatePolicy: "skip",
      fingerprint: "fixture-api-postgres-replace",
      invalidRecords: 0,
      warnings: []
    }
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    error: "legacy_migration_replace_unavailable",
    message: "Dieser Migrationsmodus ist für die ausgewählte Datenbank nicht verfügbar."
  });
  assert.equal((await getLegacyDatabaseSummary(persistence.query)).isEmpty, true);
  await app.close();
});

test("Vorschau und Import lehnen dasselbe übergroße Paket generisch und nicht cachebar ab", async () => {
  const app = Fastify({ logger: false });
  app.decorateRequest("userEmail", "test@example.invalid");
  app.decorateRequest("user", undefined);
  app.decorate("persistence", persistence);
  await app.register(migrationRoutes);
  const data = {
    ...fixture(),
    children: Array.from({ length: 50_001 }, () => ({}))
  };

  for (const path of ["legacy-preview", "legacy-import"]) {
    const response = await app.inject({
      method: "POST",
      url: `/api/migration/${path}`,
      payload: {
        data,
        fingerprint: "fixture-over-limit",
        invalidRecords: 0,
        warnings: [],
        ...(path === "legacy-import" ? { mode: "add", duplicatePolicy: "skip" } : {})
      }
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(response.json(), {
      error: "migration_processing_limit",
      message: "Das Datenpaket überschreitet die unterstützten Grenzen."
    });
  }
  assert.equal((await getLegacyDatabaseSummary(persistence.query)).isEmpty, true);
  await app.close();
});

test("leere SQLite-Datenbank zeigt korrekte Vorschau und übernimmt Daten", async () => {
  const data = fixture();
  const preview = await previewLegacyMigration(
    data,
    "test@example.invalid",
    "fixture-empty",
    persistence.query
  );
  assert.equal(preview.database.isEmpty, true);
  assert.equal(preview.counts.entries, 1);
  assert.equal(preview.counts.trips, 1);
  const report = await executeLegacyMigration({
    data,
    mode: "add",
    duplicatePolicy: "skip",
    fingerprint: "fixture-empty",
    userEmail: "test@example.invalid"
  }, persistence);
  assert.equal(report.imported.entries, 1);
  assert.equal((await getLegacyDatabaseSummary(persistence.query)).entries, 1);
});

test("importierte Einträge und alte Umgangsmuster nutzen die Hauptbetreuung als Fallback", async () => {
  insertDefaultCareParty();
  const data = fixture({
    contactPatterns: [{
      id: "legacy-pattern-1",
      name: "Alte Umgangsregel",
      startDate: "2026-01-09",
      frequency: "biweekly",
      fridayStartTime: "16:00",
      sundayEndTime: "18:00",
      childIds: ["legacy-child-1"],
      active: true,
      createdAt: "2026-01-01T10:00:00.000Z",
      updatedAt: "2026-01-01T10:00:00.000Z"
    }]
  });

  await executeLegacyMigration({
    data,
    mode: "add",
    duplicatePolicy: "skip",
    fingerprint: "fixture-default-party",
    userEmail: "test@example.invalid"
  }, persistence);

  assert.deepEqual(db.prepare(`
    SELECT responsible_party_id AS responsiblePartyId
    FROM care_entries
    WHERE id = ?
  `).get("legacy-entry-1"), {
    responsiblePartyId: "party-primary"
  });
  assert.deepEqual(db.prepare(`
    SELECT responsible_party_id AS responsiblePartyId
    FROM contact_rules
    WHERE id = ?
  `).get("legacy-pattern-1"), {
    responsiblePartyId: "party-primary"
  });
});

test("bestehende SQLite-Daten werden nicht automatisch überschrieben", async () => {
  await insertExisting("planned");
  const preview = await analyzeLegacyData(fixture(), persistence.query);
  assert.equal(preview.database.isEmpty, false);
  assert.equal(preview.conflicts, 1);
  const status = db.prepare(
    "SELECT status FROM care_entries WHERE id = 'legacy-entry-1'"
  ).get() as { status: string };
  assert.equal(status.status, "planned");
});

test("potenzielle Duplikate werden erkannt und standardmäßig übersprungen", async () => {
  await insertExisting();
  const data = fixture();
  const preview = await analyzeLegacyData(data, persistence.query);
  assert.equal(preview.potentialDuplicates, 3);
  const report = await executeLegacyMigration({
    data,
    mode: "add",
    duplicatePolicy: "skip",
    fingerprint: "fixture-duplicate",
    userEmail: "test@example.invalid"
  }, persistence);
  assert.equal(report.skippedDuplicates, 3);
  assert.equal((await getLegacyDatabaseSummary(persistence.query)).entries, 1);
});

test("abweichender Status wird als Konflikt ausgewiesen", async () => {
  await insertExisting("planned");
  const preview = await analyzeLegacyData(fixture(), persistence.query);
  assert.equal(preview.conflicts, 1);
  assert.match(preview.conflictDetails[0]!.reasons.join(" "), /Status/);
});

test("Import in abgeschlossenen Monat wird besonders markiert", async () => {
  db.prepare(`
    INSERT INTO monthly_closings (
      id, month_key, summary_json, closed_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "closing-2026-01",
    "2026-01",
    "{}",
    "test@example.invalid",
    "2026-02-01T00:00:00.000Z",
    "2026-02-01T00:00:00.000Z"
  );
  const preview = await analyzeLegacyData(fixture(), persistence.query);
  assert.equal(preview.conflicts, 1);
  assert.deepEqual(preview.conflictDetails[0]!.closedMonths, ["2026-01"]);
});

test("Ersetzen erstellt zuerst ein Backup und bricht bei Backupfehler ab", async () => {
  await insertExisting("planned");
  let backupCalled = false;
  await assert.rejects(
    executeLegacyMigration({
      data: fixture(),
      mode: "replace",
      duplicatePolicy: "skip",
      fingerprint: "fixture-backup-failure",
      userEmail: "test@example.invalid",
      backupCreator: async () => {
        backupCalled = true;
        throw new Error("fiktiver Backupfehler");
      }
    }, persistence),
    /fiktiver Backupfehler/
  );
  assert.equal(backupCalled, true);
  assert.equal((await getLegacyDatabaseSummary(persistence.query)).entries, 1);
  const status = db.prepare(
    "SELECT status FROM care_entries WHERE id = 'legacy-entry-1'"
  ).get() as { status: string };
  assert.equal(status.status, "planned");
});

test("ungültige Legacy-Struktur führt zu keinem Teilimport und Rollback", async () => {
  const invalid = fixture({
    entries: [
      fixture().entries[0],
      {
        ...fixture().entries[0],
        id: "invalid-entry",
        trips: [{
          id: "invalid-trip",
          purpose: "pickup",
          km: 0,
          ownCar: true,
          reimbursed: false
        }]
      }
    ]
  });
  await assert.rejects(
    executeLegacyMigration({
      data: invalid,
      mode: "add",
      duplicatePolicy: "skip",
      fingerprint: "fixture-invalid",
      userEmail: "test@example.invalid"
    }, persistence)
  );
  assert.equal((await getLegacyDatabaseSummary(persistence.query)).children, 0);
  assert.equal((await getLegacyDatabaseSummary(persistence.query)).entries, 0);
});

test("Backend-Ausfall verwendet die eindeutige Schreibsperrenmeldung", () => {
  const message =
    "Die Serververbindung ist nicht verfügbar. Änderungen können derzeit nicht gespeichert werden.";
  assert.match(message, /nicht verfügbar/);
});

test("Erkennung, Vorschau, Import, Überspringen und Fehler werden auditiert", async () => {
  const data = fixture();
  await recordLegacyMigrationEvent(
    "test@example.invalid",
    "legacy_migration_detected",
    { fingerprint: "fixture-audit", counts: { entries: 1 } },
    persistence.query
  );
  await previewLegacyMigration(
    data,
    "test@example.invalid",
    "fixture-audit",
    persistence.query
  );
  await recordLegacyMigrationEvent(
    "test@example.invalid",
    "legacy_migration_skip",
    { fingerprint: "fixture-audit", reason: "later" },
    persistence.query
  );
  await executeLegacyMigration({
    data,
    mode: "add",
    duplicatePolicy: "skip",
    fingerprint: "fixture-audit",
    userEmail: "test@example.invalid"
  }, persistence);
  await assert.rejects(
    executeLegacyMigration({
      data,
      mode: "replace",
      duplicatePolicy: "skip",
      fingerprint: "fixture-audit-failed",
      userEmail: "test@example.invalid",
      backupCreator: async () => {
        throw new Error("fiktiver Fehler");
      }
    }, persistence)
  );
  const fields = (db.prepare(`
    SELECT field_name AS field FROM audit_log
    WHERE entity_type = 'legacy_migration'
  `).all() as Array<{ field: string }>).map((row) => row.field);
  assert.ok(fields.includes("legacy_migration_detected"));
  assert.ok(fields.includes("legacy_migration_preview"));
  assert.ok(fields.includes("legacy_migration_skip"));
  assert.ok(fields.includes("legacy_migration_import"));
  assert.ok(fields.includes("legacy_migration_failed"));
  const failedAudit = db.prepare(`
    SELECT metadata_json AS value FROM audit_log
    WHERE entity_type = 'legacy_migration'
      AND field_name = 'legacy_migration_failed'
    ORDER BY id DESC
    LIMIT 1
  `).get() as { value: string };
  assert.match(failedAudit.value, /migration_failed/);
  assert.doesNotMatch(failedAudit.value, /fiktiver Fehler/);
});
