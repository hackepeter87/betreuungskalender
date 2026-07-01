import "dotenv/config";
import Database from "better-sqlite3";
import { readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

const backupDir = resolve(
  process.cwd(),
  process.env.BACKUP_DIR ?? "./backups"
);

const requiredTables = [
  "schema_migrations",
  "children",
  "care_parties",
  "care_entries",
  "trips",
  "costs",
  "holiday_periods",
  "contact_patterns",
  "contact_rules",
  "contact_rule_children",
  "unavailable_periods",
  "monthly_closings",
  "audit_log",
  "app_user_care_party_assignments"
];

async function latestBackup() {
  const candidates = (await readdir(backupDir))
    .filter(
      (name) =>
        name.startsWith("betreuungskalender-sqlite-") &&
        name.endsWith(".sqlite")
    )
    .sort()
    .reverse();
  if (!candidates[0]) {
    throw new Error("Keine SQLite-Sicherung im BACKUP_DIR gefunden.");
  }
  return resolve(backupDir, candidates[0]);
}

async function main() {
  const backupPath = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : await latestBackup();
  const database = new Database(backupPath, {
    readonly: true,
    fileMustExist: true
  });

  try {
    const integrity = database.pragma("integrity_check", {
      simple: true
    });
    if (integrity !== "ok") {
      throw new Error("SQLite integrity_check war nicht erfolgreich.");
    }

    const tables = new Set(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name)
    );
    const missing = requiredTables.filter((table) => !tables.has(table));
    if (missing.length) {
      throw new Error(`Erforderliche Tabellen fehlen: ${missing.join(", ")}`);
    }
  } finally {
    database.close();
  }

  console.log(`Restore-Prüfung erfolgreich: ${basename(backupPath)}`);
}

main().catch((error) => {
  console.error(
    `Restore-Prüfung fehlgeschlagen: ${error instanceof Error ? error.message : "unbekannter Fehler"}`
  );
  process.exitCode = 1;
});
