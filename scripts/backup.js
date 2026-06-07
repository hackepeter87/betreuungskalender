import "dotenv/config";
import Database from "better-sqlite3";
import { chmod, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { basename, resolve } from "node:path";

const databasePath = resolve(
  process.cwd(),
  process.env.DATABASE_PATH ?? "./data/app.sqlite"
);
const backupDir = resolve(
  process.cwd(),
  process.env.BACKUP_DIR ?? "./backups"
);
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? "14");

function timestampForFilename(date) {
  return date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

async function pruneOldBackups(now) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  let removed = 0;

  for (const entry of await readdir(backupDir, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      !entry.name.startsWith("betreuungskalender-sqlite-") ||
      !entry.name.endsWith(".sqlite")
    ) {
      continue;
    }
    const path = resolve(backupDir, entry.name);
    if ((await stat(path)).mtimeMs < cutoff) {
      await unlink(path);
      removed += 1;
    }
  }
  return removed;
}

async function main() {
  const now = new Date();
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  await chmod(backupDir, 0o700);

  const destination = resolve(
    backupDir,
    `betreuungskalender-sqlite-${timestampForFilename(now)}.sqlite`
  );

  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true
  });

  try {
    await database.backup(destination);
  } finally {
    database.close();
  }

  await chmod(destination, 0o600);
  const removed = await pruneOldBackups(now);
  console.log(
    `SQLite-Backup erstellt: ${basename(destination)}${removed ? ` (${removed} alte Sicherung(en) entfernt)` : ""}`
  );
}

main().catch((error) => {
  console.error(
    `SQLite-Backup fehlgeschlagen: ${error instanceof Error ? error.message : "unbekannter Fehler"}`
  );
  process.exitCode = 1;
});
