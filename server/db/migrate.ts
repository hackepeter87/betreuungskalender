import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./connection.js";

const compiledDirectory = fileURLToPath(new URL("../migrations", import.meta.url));
const migrationsDirectory = existsSync(compiledDirectory)
  ? compiledDirectory
  : resolve(process.cwd(), "server/migrations");

export function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((row) => {
      return (row as { version: string }).version;
    })
  );

  const files = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const applyMigration = db.transaction((file: string) => {
    const version = basename(file, ".sql");
    db.exec(readFileSync(join(migrationsDirectory, file), "utf8"));
    db.prepare(
      "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)"
    ).run(version, new Date().toISOString());
  });

  for (const file of files) {
    const version = basename(file, ".sql");
    if (!applied.has(version)) applyMigration(file);
  }
}
