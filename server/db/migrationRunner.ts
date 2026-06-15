import type Database from "better-sqlite3";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const compiledDirectory = fileURLToPath(new URL("../migrations", import.meta.url));
const migrationsDirectory = existsSync(compiledDirectory)
  ? compiledDirectory
  : resolve(process.cwd(), "server/migrations");

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

  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const applyMigration = database.transaction((file: string) => {
    const version = basename(file, ".sql");
    database.exec(readFileSync(join(directory, file), "utf8"));
    database.prepare(
      "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)"
    ).run(version, new Date().toISOString());
  });

  for (const file of files) {
    const version = basename(file, ".sql");
    if (!applied.has(version)) applyMigration(file);
  }
}
