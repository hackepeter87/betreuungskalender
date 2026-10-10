import type Database from "better-sqlite3";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const compiledDirectory = fileURLToPath(new URL("../migrations", import.meta.url));
const migrationsDirectory = existsSync(compiledDirectory)
  ? compiledDirectory
  : resolve(process.cwd(), "server/migrations");

export function availableMigrationVersions(directory = migrationsDirectory): string[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => basename(file, ".sql"));
}

export function migrateDatabase(
  database: Database.Database,
  directory = migrationsDirectory
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    database.prepare("SELECT version FROM schema_migrations").all().map((row) => {
      return (row as { version: string }).version;
    })
  );

  const files = availableMigrationVersions(directory).map((version) => `${version}.sql`);

  const applyMigration = database.transaction((file: string, sql: string, verifyForeignKeys: boolean) => {
    const version = basename(file, ".sql");
    database.exec(sql);
    if (verifyForeignKeys) {
      const violations = database.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) {
        throw new Error(`Migration ${version} introduced foreign key violations.`);
      }
    }
    database.prepare(
      "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)"
    ).run(version, new Date().toISOString());
  });

  for (const file of files) {
    const version = basename(file, ".sql");
    if (applied.has(version)) continue;
    const sql = readFileSync(join(directory, file), "utf8");
    const requiresForeignKeysOff = sql.startsWith("-- migration: foreign-keys-off\n");
    if (!requiresForeignKeysOff) {
      applyMigration(file, sql, false);
      continue;
    }
    database.pragma("foreign_keys = OFF");
    try {
      applyMigration(file, sql, true);
    } finally {
      database.pragma("foreign_keys = ON");
    }
  }
}
