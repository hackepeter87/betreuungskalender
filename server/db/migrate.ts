import { db } from "./connection.js";
import { migrateDatabase } from "./migrationRunner.js";

export function runMigrations(): void {
  migrateDatabase(db);
}
