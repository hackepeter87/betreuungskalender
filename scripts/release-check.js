import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const requiredFiles = [
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "CHANGELOG.md",
  ".env.example",
  "Dockerfile",
  "compose.yaml"
];

function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} ist fehlgeschlagen.`);
  }
}

function checkRequiredFiles() {
  const missing = requiredFiles.filter((file) => !existsSync(resolve(file)));
  if (missing.length) {
    throw new Error(`Erforderliche Dateien fehlen: ${missing.join(", ")}`);
  }
}

function checkTrackedSensitiveFiles() {
  if (!existsSync(".git")) {
    console.warn("Kein Git-Metadatenverzeichnis gefunden; Prüfung getrackter Dateien übersprungen.");
    return;
  }
  const result = spawnSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    shell: false
  });
  if (result.status !== 0) {
    throw new Error("Getrackte Dateien konnten nicht geprüft werden.");
  }
  const tracked = result.stdout.split("\0").filter(Boolean);
  const forbidden = tracked.filter((file) => {
    const lower = file.toLowerCase();
    return (
      (lower.startsWith(".env") && lower !== ".env.example") ||
      /\.(sqlite|db|pdf|csv)$/.test(lower) ||
      lower.startsWith("backups/") ||
      lower.startsWith("exports/") ||
      lower.startsWith("secrets/") ||
      /^betreuungskalender-backup-.*\.json$/.test(lower)
    );
  });
  if (forbidden.length) {
    throw new Error(
      `Sensible oder erzeugte Dateien sind getrackt: ${forbidden.join(", ")}`
    );
  }
}

function checkMigrationSources() {
  const migrations = readdirSync("server/migrations").filter((file) =>
    file.endsWith(".sql")
  );
  if (!migrations.length) throw new Error("Keine Datenbankmigrationen gefunden.");
}

try {
  checkRequiredFiles();
  checkTrackedSensitiveFiles();
  checkMigrationSources();
  run("npm", ["ci"]);
  run("npm", ["run", "lint", "--if-present"]);
  run("npm", ["run", "test", "--if-present"]);
  run("npm", ["run", "build"]);
  console.log("\nRelease-Prüfung erfolgreich.");
} catch (error) {
  console.error(
    `\nRelease-Prüfung fehlgeschlagen: ${error instanceof Error ? error.message : "unbekannter Fehler"}`
  );
  process.exitCode = 1;
}
