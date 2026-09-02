import { config } from "../config.js";
import { persistence } from "../db/connection.js";
import { requireSqlitePersistenceRuntime } from "../db/runtime.js";
import { backupDatabase } from "./sqliteBackup.js";

export async function createSqliteBackup(now = new Date()): Promise<string> {
  return backupDatabase(
    requireSqlitePersistenceRuntime(persistence).sqliteDatabase,
    config.backupDir,
    now
  );
}
