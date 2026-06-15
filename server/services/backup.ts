import { config } from "../config.js";
import { db } from "../db/connection.js";
import { backupDatabase } from "./sqliteBackup.js";

export async function createSqliteBackup(now = new Date()): Promise<string> {
  return backupDatabase(db, config.backupDir, now);
}
