import type Database from "better-sqlite3";
import { chmod, mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

function timestampForFilename(date: Date): string {
  return date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

export async function backupDatabase(
  database: Database.Database,
  backupDirectory: string,
  now = new Date()
): Promise<string> {
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await chmod(backupDirectory, 0o700);
  const destination = resolve(
    backupDirectory,
    `betreuungskalender-sqlite-${timestampForFilename(now)}.sqlite`
  );
  await database.backup(destination);
  await chmod(destination, 0o600);
  return basename(destination);
}
