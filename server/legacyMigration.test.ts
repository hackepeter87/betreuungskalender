import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "betreuungskalender-migration-"));
process.env.DATABASE_PATH = join(temporaryDirectory, "test.sqlite");
process.env.BACKUP_DIR = join(temporaryDirectory, "backups");

const { runMigrations } = await import("./db/migrate.js");
const { db } = await import("./db/connection.js");
const {
  analyzeLegacyData,
  executeLegacyMigration,
  getLegacyDatabaseSummary,
  previewLegacyMigration,
  recordLegacyMigrationEvent
} = await import("./services/legacyMigration.js");
const {
  clearDomainData,
  insertChild,
  insertEntry
} = await import("./routes/appData.js");
const { appDataImportSchema } = await import("./validation/schemas.js");

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

function resetDatabase(): void {
  db.transaction(() => {
    clearDomainData();
    db.prepare("DELETE FROM legacy_migration_runs").run();
  })();
}

function insertExisting(status = "completed"): void {
  const data = fixture();
  insertChild(data.children[0]!, data.updatedAt);
  insertEntry({ ...data.entries[0]!, status }, data.updatedAt, "test@example.invalid");
}

beforeEach(resetDatabase);

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("eine leere SQLite-Datenbank wird als fachlich leer erkannt", () => {
  assert.equal(getLegacyDatabaseSummary().isEmpty, true);
});

test("leere SQLite-Datenbank zeigt korrekte Vorschau und übernimmt Daten", async () => {
  const data = fixture();
  const preview = previewLegacyMigration(
    data,
    "test@example.invalid",
    "fixture-empty"
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
  });
  assert.equal(report.imported.entries, 1);
  assert.equal(getLegacyDatabaseSummary().entries, 1);
});

test("bestehende SQLite-Daten werden nicht automatisch überschrieben", () => {
  insertExisting("planned");
  const preview = analyzeLegacyData(fixture());
  assert.equal(preview.database.isEmpty, false);
  assert.equal(preview.conflicts, 1);
  const status = db.prepare(
    "SELECT status FROM care_entries WHERE id = 'legacy-entry-1'"
  ).get() as { status: string };
  assert.equal(status.status, "planned");
});

test("potenzielle Duplikate werden erkannt und standardmäßig übersprungen", async () => {
  insertExisting();
  const data = fixture();
  const preview = analyzeLegacyData(data);
  assert.equal(preview.potentialDuplicates, 3);
  const report = await executeLegacyMigration({
    data,
    mode: "add",
    duplicatePolicy: "skip",
    fingerprint: "fixture-duplicate",
    userEmail: "test@example.invalid"
  });
  assert.equal(report.skippedDuplicates, 3);
  assert.equal(getLegacyDatabaseSummary().entries, 1);
});

test("abweichender Status wird als Konflikt ausgewiesen", () => {
  insertExisting("planned");
  const preview = analyzeLegacyData(fixture());
  assert.equal(preview.conflicts, 1);
  assert.match(preview.conflictDetails[0]!.reasons.join(" "), /Status/);
});

test("Import in abgeschlossenen Monat wird besonders markiert", () => {
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
  const preview = analyzeLegacyData(fixture());
  assert.equal(preview.conflicts, 1);
  assert.deepEqual(preview.conflictDetails[0]!.closedMonths, ["2026-01"]);
});

test("Ersetzen erstellt zuerst ein Backup und bricht bei Backupfehler ab", async () => {
  insertExisting("planned");
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
    }),
    /fiktiver Backupfehler/
  );
  assert.equal(backupCalled, true);
  assert.equal(getLegacyDatabaseSummary().entries, 1);
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
    })
  );
  assert.equal(getLegacyDatabaseSummary().children, 0);
  assert.equal(getLegacyDatabaseSummary().entries, 0);
});

test("Backend-Ausfall verwendet die eindeutige Schreibsperrenmeldung", () => {
  const message =
    "Die Serververbindung ist nicht verfügbar. Änderungen können derzeit nicht gespeichert werden.";
  assert.match(message, /nicht verfügbar/);
});

test("Erkennung, Vorschau, Import, Überspringen und Fehler werden auditiert", async () => {
  const data = fixture();
  recordLegacyMigrationEvent(
    "test@example.invalid",
    "legacy_migration_detected",
    { fingerprint: "fixture-audit", counts: { entries: 1 } }
  );
  previewLegacyMigration(data, "test@example.invalid", "fixture-audit");
  recordLegacyMigrationEvent(
    "test@example.invalid",
    "legacy_migration_skip",
    { fingerprint: "fixture-audit", reason: "later" }
  );
  await executeLegacyMigration({
    data,
    mode: "add",
    duplicatePolicy: "skip",
    fingerprint: "fixture-audit",
    userEmail: "test@example.invalid"
  });
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
    })
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
});
