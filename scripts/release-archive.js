import { createHash } from "node:crypto";
import { createReadStream, existsSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const RELEASE_ARCHIVE_INPUTS = [
  "dist",
  "dist-server",
  "scripts/backup.js",
  "scripts/restore-check.js",
  "scripts/healthcheck.js",
  "scripts/runtime-verify.js",
  "scripts/update.js",
  "deploy/compose.yml",
  "deploy/compose.postgres.yml",
  "deploy/compose.testing.yml",
  "deploy/compose.production.yml",
  "deploy/app.env.demo.example",
  "deploy/postgres/init/001-create-application-role.sh",
  "charts",
  "Dockerfile.release",
  "package.json",
  "package-lock.json",
  ".env.example",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "docs",
  "artifacts/compliance"
];

function normalizeArchiveEntry(entry) {
  return entry.replace(/^\.\//u, "").replace(/\/$/u, "");
}

export function validateReleaseArchiveEntries(entries, releaseTag) {
  const normalized = entries.map(normalizeArchiveEntry).filter(Boolean);
  const belongsToInput = (entry, input) =>
    entry === input || entry.startsWith(`${input}/`);
  const missing = RELEASE_ARCHIVE_INPUTS.filter(
    (input) => !normalized.some((entry) => belongsToInput(entry, input))
  );
  const unexpected = normalized.filter(
    (entry) => !RELEASE_ARCHIVE_INPUTS.some((input) => belongsToInput(entry, input))
  );
  const releaseNotesPath = `docs/release-notes/${releaseTag}.md`;
  const releaseNotesPresent = normalized.includes(releaseNotesPath);

  return { missing, unexpected, releaseNotesPath, releaseNotesPresent };
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function runTar(args, cwd) {
  const result = spawnSync("tar", args, { cwd, encoding: "utf8", shell: false });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `tar ${args[0]} failed`);
  }
  return result.stdout;
}

export async function createReleaseArchive({ cwd, output, releaseTag }) {
  if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(releaseTag)) {
    throw new Error(`Invalid release tag: ${releaseTag}`);
  }
  const missingInputs = RELEASE_ARCHIVE_INPUTS.filter(
    (input) => !existsSync(resolve(cwd, input))
  );
  if (missingInputs.length > 0) {
    throw new Error(`Missing release archive inputs: ${missingInputs.join(", ")}`);
  }

  runTar(["-czf", output, ...RELEASE_ARCHIVE_INPUTS], cwd);
  const entries = runTar(["-tzf", output], cwd).split(/\r?\n/u).filter(Boolean);
  const validation = validateReleaseArchiveEntries(entries, releaseTag);
  if (
    validation.missing.length > 0 ||
    validation.unexpected.length > 0 ||
    !validation.releaseNotesPresent
  ) {
    throw new Error(
      `Invalid release archive: missing=${validation.missing.join(",") || "none"}; ` +
      `unexpected=${validation.unexpected.join(",") || "none"}; ` +
      `releaseNotes=${validation.releaseNotesPresent ? "present" : validation.releaseNotesPath}`
    );
  }

  const digest = await sha256(resolve(cwd, output));
  writeFileSync(
    resolve(cwd, `${output}.sha256`),
    `${digest}  ${basename(output)}\n`,
    "utf8"
  );
}

const entryPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === entryPath) {
  const [output, releaseTag] = process.argv.slice(2);
  if (!output || !releaseTag) {
    console.error("Usage: node scripts/release-archive.js <output.tar.gz> <vX.Y.Z>");
    process.exitCode = 2;
  } else {
    createReleaseArchive({ cwd: process.cwd(), output, releaseTag }).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
