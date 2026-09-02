import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const compiledDirectory = fileURLToPath(
  new URL("../migrations/postgres", import.meta.url)
);
const migrationsDirectory = existsSync(compiledDirectory)
  ? compiledDirectory
  : resolve(process.cwd(), "server/migrations/postgres");

const migrationLockKey = 1_284_528_001;

export function postgresMigrationVersions(
  directory = migrationsDirectory
): string[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => basename(file, ".sql"));
}

export async function migratePostgresDatabase(
  pool: Pool,
  directory = migrationsDirectory
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtext(current_database()), $1)",
      [migrationLockKey]
    );
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    const appliedRows = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations"
    );
    const applied = new Set(appliedRows.rows.map(({ version }) => version));
    for (const version of postgresMigrationVersions(directory)) {
      if (applied.has(version)) continue;
      await client.query(readFileSync(join(directory, `${version}.sql`), "utf8"));
      await client.query(
        "INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)",
        [version, new Date().toISOString()]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.query(
      "SELECT pg_advisory_unlock(hashtext(current_database()), $1)",
      [migrationLockKey]
    )
      .catch(() => undefined);
    client.release();
  }
}
