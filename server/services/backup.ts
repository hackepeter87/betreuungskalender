import { chmod, mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { config } from "../config.js";
import { db } from "../db/connection.js";

function timestampForFilename(date: Date): string {
  return date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

export async function createSqliteBackup(now = new Date()): Promise<string> {
  await mkdir(config.backupDir, { recursive: true, mode: 0o700 });
  await chmod(config.backupDir, 0o700);
  const destination = resolve(
    config.backupDir,
    `betreuungskalender-sqlite-${timestampForFilename(now)}.sqlite`
  );
  await db.backup(destination);
  await chmod(destination, 0o600);
  return basename(destination);
}
