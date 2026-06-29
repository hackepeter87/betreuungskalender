import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EXIT = {
  USAGE: 2,
  PREFLIGHT: 10,
  LOCK: 11,
  VERIFY: 12,
  BACKUP: 13,
  UPDATE: 14,
  VALIDATION: 15,
  ROLLBACK: 16
};

const REQUIRED_ARCHIVE_PATHS = [
  "package.json",
  "Dockerfile.release",
  "dist/",
  "dist-server/",
  "scripts/update.js",
  "scripts/runtime-verify.js"
];

class UpdateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function event(level, name, details = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, event: name, ...details }));
}

function safeUrl(value) {
  const url = new URL(value);
  return `${url.protocol}//${url.host}${url.pathname}`;
}

function fail(code, message) {
  throw new UpdateError(code, message);
}

function requiredValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(EXIT.USAGE, `${name} requires a value.`);
  return value;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) fail(EXIT.USAGE, `${name} must be a positive integer.`);
  return parsed;
}

export function normalizeVersion(value) {
  const normalized = value?.replace(/^v/, "");
  if (!normalized || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)) {
    fail(EXIT.USAGE, "--version must be a SemVer version such as 0.5.0.");
  }
  return normalized;
}

export function parseArguments(args) {
  const options = {
    root: "/opt/betreuungskalender",
    service: "betreuungskalender",
    staleLockMinutes: 120,
    minFreeKb: 1_048_576,
    healthRetries: 12,
    healthDelayMs: 5_000,
    dryRun: false,
    clearStaleLock: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--clear-stale-lock") options.clearStaleLock = true;
    else if (argument === "--root") options.root = requiredValue(args, index++, argument);
    else if (argument === "--service") options.service = requiredValue(args, index++, argument);
    else if (argument === "--version") options.version = normalizeVersion(requiredValue(args, index++, argument));
    else if (argument === "--artifact") options.artifact = requiredValue(args, index++, argument);
    else if (argument === "--checksum") options.checksum = requiredValue(args, index++, argument);
    else if (argument === "--artifact-url") options.artifactUrl = requiredValue(args, index++, argument);
    else if (argument === "--checksum-url") options.checksumUrl = requiredValue(args, index++, argument);
    else if (argument === "--stale-lock-minutes") options.staleLockMinutes = positiveInteger(requiredValue(args, index++, argument), argument);
    else if (argument === "--min-free-kb") options.minFreeKb = positiveInteger(requiredValue(args, index++, argument), argument);
    else if (argument === "--health-retries") options.healthRetries = positiveInteger(requiredValue(args, index++, argument), argument);
    else if (argument === "--health-delay-ms") options.healthDelayMs = positiveInteger(requiredValue(args, index++, argument), argument);
    else fail(EXIT.USAGE, `Unsupported argument: ${argument}`);
  }

  if (!options.version) fail(EXIT.USAGE, "--version is required.");
  const local = Boolean(options.artifact || options.checksum);
  const remote = Boolean(options.artifactUrl || options.checksumUrl);
  if (local === remote || (local && (!options.artifact || !options.checksum)) || (remote && (!options.artifactUrl || !options.checksumUrl))) {
    fail(EXIT.USAGE, "Provide either --artifact with --checksum, or --artifact-url with --checksum-url.");
  }
  if (remote && (!options.artifactUrl.startsWith("https://") || !options.checksumUrl.startsWith("https://"))) {
    fail(EXIT.USAGE, "Remote release files must use HTTPS URLs.");
  }
  return options;
}

function command(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    shell: false
  });
  if (result.error || result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    throw new Error(`${commandName} ${args.join(" ")} failed${output ? `: ${output}` : ""}`);
  }
  return result.stdout ?? "";
}

function composeArguments(options, args) {
  return [
    "compose",
    "--project-directory", options.root,
    "--env-file", resolve(options.root, ".env"),
    "-f", resolve(options.root, "compose.yml"),
    ...args
  ];
}

function compose(options, args) {
  return command("docker", composeArguments(options, args));
}

async function sleep(milliseconds) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function parseEnv(content) {
  const values = new Map();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

export function updateEnv(content, values) {
  const remaining = new Set(Object.keys(values));
  const lines = content.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || !(match[2] in values)) return line;
    remaining.delete(match[2]);
    return `${match[1]}${match[2]}=${values[match[2]]}`;
  });
  for (const key of remaining) lines.push(`${key}=${values[key]}`);
  return `${lines.filter((line, index, all) => line || index < all.length - 1).join("\n")}\n`;
}

export function parseChecksum(content) {
  const match = content.match(/\b([a-fA-F0-9]{64})\b/);
  if (!match) fail(EXIT.VERIFY, "The checksum file does not contain a SHA-256 value.");
  return match[1].toLowerCase();
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function archiveEntries(archivePath) {
  return command("tar", ["-tzf", archivePath])
    .split(/\r?\n/)
    .filter(Boolean);
}

async function verifyArchive(archivePath, checksumPath, version) {
  if (!existsSync(archivePath) || !existsSync(checksumPath)) {
    fail(EXIT.VERIFY, "The release archive or checksum file is missing.");
  }
  const expectedChecksum = parseChecksum(await readFile(checksumPath, "utf8"));
  if ((await sha256(archivePath)) !== expectedChecksum) {
    fail(EXIT.VERIFY, "The release archive checksum does not match.");
  }
  const entries = archiveEntries(archivePath);
  if (entries.some((entry) => entry.startsWith("/") || entry.split("/").includes(".."))) {
    fail(EXIT.VERIFY, "The release archive contains an unsafe path.");
  }
  for (const requiredPath of [...REQUIRED_ARCHIVE_PATHS, `docs/release-notes/v${version}.md`]) {
    if (!entries.some((entry) => entry === requiredPath || entry.startsWith(requiredPath))) {
      fail(EXIT.VERIFY, `The release archive is missing ${requiredPath}.`);
    }
  }
  let packageJson;
  try {
    packageJson = JSON.parse(command("tar", ["-xOf", archivePath, "package.json"]));
  } catch {
    fail(EXIT.VERIFY, "The release archive package.json could not be read.");
  }
  if (packageJson.version !== version) {
    fail(EXIT.VERIFY, `The archive version ${packageJson.version ?? "unknown"} does not match ${version}.`);
  }
  const releaseNotes = command("tar", ["-xOf", archivePath, `docs/release-notes/v${version}.md`]);
  const releaseNotesHeading = new RegExp(
    `^# v${escapeRegExp(version)}(?:\\s|$)`,
    "m"
  );
  if (!releaseNotesHeading.test(releaseNotes)) {
    fail(EXIT.VERIFY, `The release notes in the archive do not identify v${version}.`);
  }
}

async function fetchToFile(url, destination) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) fail(EXIT.VERIFY, `Download failed with HTTP ${response.status}.`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
}

async function materializeArtifact(options) {
  if (options.artifact) {
    return {
      archivePath: resolve(options.artifact),
      checksumPath: resolve(options.checksum),
      temporaryPaths: []
    };
  }
  if (options.dryRun) {
    event("info", "download_would_run", {
      artifactUrl: safeUrl(options.artifactUrl),
      checksumUrl: safeUrl(options.checksumUrl)
    });
    return { archivePath: null, checksumPath: null, temporaryPaths: [] };
  }
  const incoming = resolve(options.root, "releases", ".incoming");
  await mkdir(incoming, { recursive: true, mode: 0o700 });
  const archivePath = resolve(incoming, `betreuungskalender-v${options.version}-${process.pid}.tar.gz`);
  const checksumPath = `${archivePath}.sha256`;
  await fetchToFile(options.artifactUrl, archivePath);
  await fetchToFile(options.checksumUrl, checksumPath);
  return { archivePath, checksumPath, temporaryPaths: [archivePath, checksumPath] };
}

async function acquireLock(options) {
  const lockPath = resolve(options.root, ".update-lock");
  if (existsSync(lockPath)) {
    const lockInfo = await stat(lockPath);
    const ageMinutes = (Date.now() - lockInfo.mtimeMs) / 60_000;
    if (ageMinutes > options.staleLockMinutes && options.clearStaleLock) {
      await rm(lockPath, { recursive: true, force: true });
      event("warn", "stale_lock_cleared", { ageMinutes: Math.floor(ageMinutes) });
    } else {
      fail(EXIT.LOCK, `An update lock exists. It is ${Math.floor(ageMinutes)} minutes old; use --clear-stale-lock only after confirming that no update is running.`);
    }
  }
  if (options.dryRun) return null;
  await mkdir(lockPath, { mode: 0o700 });
  await writeFile(resolve(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n", { mode: 0o600 });
  return lockPath;
}

async function checkDisk(options) {
  const output = command("df", ["-Pk", options.root]);
  const columns = output.trim().split(/\r?\n/).at(-1)?.trim().split(/\s+/) ?? [];
  const availableKb = Number(columns[3]);
  if (!Number.isFinite(availableKb) || availableKb < options.minFreeKb) {
    fail(EXIT.PREFLIGHT, `Only ${Number.isFinite(availableKb) ? availableKb : "unknown"} KB is free; ${options.minFreeKb} KB is required.`);
  }
  return availableKb;
}

async function activeRelease(options) {
  const envPath = resolve(options.root, ".env");
  if (!existsSync(envPath)) fail(EXIT.PREFLIGHT, `${envPath} is missing.`);
  const envContent = await readFile(envPath, "utf8");
  const releasePath = parseEnv(envContent).get("APP_RELEASE_DIR");
  if (!releasePath) fail(EXIT.PREFLIGHT, "APP_RELEASE_DIR is not set in .env.");
  const resolvedRelease = resolve(releasePath);
  const packagePath = resolve(resolvedRelease, "package.json");
  if (!existsSync(packagePath)) fail(EXIT.PREFLIGHT, `The active release at ${resolvedRelease} is incomplete.`);
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  return { envContent, envPath, path: resolvedRelease, version: packageJson.version ?? "unknown" };
}

async function preflight(options, previous) {
  const composePath = resolve(options.root, "compose.yml");
  const dataPath = resolve(options.root, "data", "app.sqlite");
  const backupsPath = resolve(options.root, "backups");
  if (!existsSync(composePath)) fail(EXIT.PREFLIGHT, `${composePath} is missing.`);
  if (!existsSync(dataPath)) fail(EXIT.PREFLIGHT, `${dataPath} is missing.`);
  if (!existsSync(backupsPath)) fail(EXIT.PREFLIGHT, `${backupsPath} is missing.`);
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
    fail(EXIT.PREFLIGHT, "Node.js 22 or newer is required for the update tool.");
  }
  try {
    await access(backupsPath, constants.R_OK | constants.W_OK);
  } catch {
    fail(EXIT.PREFLIGHT, `${backupsPath} is not readable and writable by the update operator.`);
  }
  try {
    command("docker", ["compose", "version"]);
    compose(options, ["config", "-q"]);
  } catch (error) {
    fail(EXIT.PREFLIGHT, error instanceof Error ? error.message : "Docker Compose is unavailable.");
  }
  const availableKb = await checkDisk(options);
  const releaseDirectory = resolve(options.root, "releases", `v${options.version}`);
  if (existsSync(releaseDirectory)) fail(EXIT.PREFLIGHT, `Release directory ${releaseDirectory} already exists.`);
  event("info", "preflight_passed", {
    activeVersion: previous.version,
    targetVersion: options.version,
    availableKb
  });
}

async function latestBackup(backupsPath, before) {
  const entries = (await readdir(backupsPath))
    .filter((name) => name.startsWith("betreuungskalender-sqlite-") && name.endsWith(".sqlite") && !before.has(name))
    .sort()
    .reverse();
  if (!entries[0]) fail(EXIT.BACKUP, "The backup command did not create a new SQLite backup.");
  return entries[0];
}

async function createVerifiedBackup(options, previous) {
  const backupsPath = resolve(options.root, "backups");
  const before = new Set(await readdir(backupsPath));
  try {
    compose(options, ["exec", "-T", options.service, "npm", "run", "backup"]);
    const backupFile = await latestBackup(backupsPath, before);
    compose(options, ["exec", "-T", options.service, "npm", "run", "restore:check", "--", `/backups/${backupFile}`]);
    const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
    const configFile = `update-${timestamp}.env`;
    const metadataFile = `update-${timestamp}.json`;
    const configPath = resolve(backupsPath, configFile);
    const metadataPath = resolve(backupsPath, metadataFile);
    await copyFile(previous.envPath, configPath);
    await chmod(configPath, 0o600);
    await writeFile(metadataPath, JSON.stringify({
      createdAt: new Date().toISOString(),
      backupFile,
      configFile,
      activeVersion: previous.version,
      targetVersion: options.version
    }, null, 2) + "\n", { mode: 0o600 });
    await chmod(metadataPath, 0o600);
    event("info", "backup_verified", { backupFile, activeVersion: previous.version });
    return { backupFile, path: resolve(backupsPath, backupFile), configFile };
  } catch (error) {
    fail(EXIT.BACKUP, error instanceof Error ? error.message : "The pre-update backup failed.");
  }
}

async function extractRelease(options, archivePath) {
  const releasesPath = resolve(options.root, "releases");
  const stagingPath = resolve(releasesPath, `.staging-v${options.version}-${process.pid}`);
  const releasePath = resolve(releasesPath, `v${options.version}`);
  await mkdir(stagingPath, { recursive: true, mode: 0o700 });
  try {
    command("tar", ["-xzf", archivePath, "--no-same-owner", "--no-same-permissions", "-C", stagingPath]);
    await rename(stagingPath, releasePath);
    return releasePath;
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });
    fail(EXIT.UPDATE, error instanceof Error ? error.message : "Release extraction failed.");
  }
}

async function switchRelease(options, previous, releasePath) {
  const nextEnv = updateEnv(previous.envContent, {
    APP_RELEASE_DIR: releasePath,
    APP_RELEASE_VERSION: options.version
  });
  await writeFile(previous.envPath, nextEnv, { mode: 0o600 });
  await chmod(previous.envPath, 0o600);
  compose(options, ["up", "-d", "--build", "--remove-orphans"]);
  event("info", "runtime_switched", { targetVersion: options.version });
}

async function verifyRuntime(options, version) {
  let lastError;
  for (let attempt = 1; attempt <= options.healthRetries; attempt += 1) {
    try {
      compose(options, ["exec", "-T", options.service, "npm", "run", "verify:runtime", "--", "--expected-version", version]);
      event("info", "runtime_verified", { version, attempt });
      return;
    } catch (error) {
      lastError = error;
      event("warn", "runtime_not_ready", { version, attempt, retries: options.healthRetries });
      if (attempt < options.healthRetries) await sleep(options.healthDelayMs);
    }
  }
  fail(EXIT.VALIDATION, lastError instanceof Error ? lastError.message : "The updated runtime did not become healthy.");
}

async function restoreDatabase(options, backupPath) {
  const dataPath = resolve(options.root, "data", "app.sqlite");
  const temporaryPath = `${dataPath}.rollback-${process.pid}`;
  await copyFile(backupPath, temporaryPath);
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, dataPath);
  await Promise.all([
    rm(`${dataPath}-wal`, { force: true }),
    rm(`${dataPath}-shm`, { force: true })
  ]);
}

async function rollback(options, previous, backup) {
  event("warn", "rollback_started", { version: previous.version, backupFile: backup.backupFile });
  try {
    try {
      compose(options, ["down"]);
    } catch {
      event("warn", "rollback_stop_failed");
    }
    await restoreDatabase(options, backup.path);
    await writeFile(previous.envPath, previous.envContent, { mode: 0o600 });
    await chmod(previous.envPath, 0o600);
    compose(options, ["up", "-d", "--build", "--remove-orphans"]);
    await verifyRuntime(options, previous.version);
    event("info", "rollback_completed", { version: previous.version, backupFile: backup.backupFile });
  } catch (error) {
    fail(EXIT.ROLLBACK, error instanceof Error ? error.message : "Rollback failed.");
  }
}

async function writeState(options, releasePath, backup) {
  const statePath = resolve(options.root, ".update-state.json");
  await writeFile(statePath, JSON.stringify({
    activeRelease: releasePath,
    activeVersion: options.version,
    verifiedAt: new Date().toISOString(),
    rollbackBackup: backup.backupFile,
    configurationBackup: backup.configFile
  }, null, 2) + "\n", { mode: 0o600 });
  await chmod(statePath, 0o600);
}

export async function runUpdate(options) {
  options.root = resolve(options.root);
  const previous = await activeRelease(options);
  let materialized = { temporaryPaths: [] };
  let lockPath;
  let switched = false;
  let backup;
  try {
    lockPath = await acquireLock(options);
    await preflight(options, previous);
    materialized = await materializeArtifact(options);
    if (materialized.archivePath) await verifyArchive(materialized.archivePath, materialized.checksumPath, options.version);
    if (options.dryRun) {
      event("info", "dry_run_complete", { activeVersion: previous.version, targetVersion: options.version });
      return;
    }
    backup = await createVerifiedBackup(options, previous);
    const releasePath = await extractRelease(options, materialized.archivePath);
    try {
      switched = true;
      await switchRelease(options, previous, releasePath);
      await verifyRuntime(options, options.version);
      await writeState(options, releasePath, backup);
      event("info", "update_completed", { version: options.version, backupFile: backup.backupFile });
    } catch (error) {
      if (switched && backup) await rollback(options, previous, backup);
      throw error;
    }
  } finally {
    if (lockPath) await rm(lockPath, { recursive: true, force: true });
    await Promise.all(materialized.temporaryPaths.map((path) => rm(path, { force: true })));
  }
}

export async function main(args = process.argv.slice(2)) {
  try {
    await runUpdate(parseArguments(args));
  } catch (error) {
    const code = error instanceof UpdateError ? error.code : EXIT.UPDATE;
    event("error", "update_failed", {
      code,
      message: error instanceof Error ? error.message : "Unknown update error"
    });
    process.exitCode = code;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
