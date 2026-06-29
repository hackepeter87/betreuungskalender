import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  escapeRegExp,
  parseArguments,
  parseChecksum,
  runUpdate,
  updateEnv
} from "./update.js";

async function withTemporaryDirectory(name, callback) {
  const directory = await mkdtemp(resolve(tmpdir(), `betreuungskalender-update-${name}-`));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function createArtifact(directory, version = "0.5.0") {
  const payload = resolve(directory, "payload");
  await mkdir(resolve(payload, "dist"), { recursive: true });
  await mkdir(resolve(payload, "dist-server"), { recursive: true });
  await mkdir(resolve(payload, "deploy"), { recursive: true });
  await mkdir(resolve(payload, "scripts"), { recursive: true });
  await writeFile(resolve(payload, "package.json"), JSON.stringify({ name: "betreuungskalender", version }));
  await writeFile(resolve(payload, "Dockerfile.release"), "FROM scratch\n");
  await writeFile(resolve(payload, ".env.example"), "APP_RELEASE_VERSION=0.5.0\n");
  await writeFile(resolve(payload, "deploy", ".env.oidc.example"), "APP_RELEASE_VERSION=0.5.0\n");
  await writeFile(resolve(payload, "deploy", "compose.yml"), "services: {}\n");
  await writeFile(resolve(payload, "deploy", "compose.oidc.yml"), "services: {}\n");
  await writeFile(resolve(payload, "deploy", "oauth2-proxy.cfg.example"), "upstreams = [ \"http://betreuungskalender:3000\" ]\n");
  await writeFile(resolve(payload, "dist", "index.html"), "<main>test</main>");
  await writeFile(resolve(payload, "dist-server", "server.js"), "export {};\n");
  await writeFile(resolve(payload, "scripts", "update.js"), "export {};\n");
  await writeFile(resolve(payload, "scripts", "runtime-verify.js"), "export {};\n");
  await mkdir(resolve(payload, "docs", "release-notes"), { recursive: true });
  await writeFile(resolve(payload, "docs", "release-notes", `v${version}.md`), `# v${version}\n`);
  const archive = resolve(directory, `betreuungskalender-v${version}.tar.gz`);
  const tar = spawnSync(
    "tar",
    ["-czf", archive, "-C", payload, "dist", "dist-server", "deploy", "scripts", "docs", "package.json", "Dockerfile.release", ".env.example"],
    { encoding: "utf8" }
  );
  assert.equal(tar.status, 0, tar.stderr);
  const checksum = createHash("sha256").update(await readFile(archive)).digest("hex");
  const checksumPath = `${archive}.sha256`;
  await writeFile(checksumPath, `${checksum}  ${archive.split("/").at(-1)}\n`);
  return { archive, checksumPath };
}

async function createFakeDocker(directory) {
  const fakeDocker = resolve(directory, "docker");
  await writeFile(fakeDocker, `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
if (args[0] !== "compose") process.exit(1);
if (args[1] === "version") process.exit(0);
const root = args[args.indexOf("--project-directory") + 1];
const commandIndex = args.findIndex((value) => ["config", "exec", "up", "down"].includes(value));
const command = args[commandIndex];
const env = readFileSync(resolve(root, ".env"), "utf8");
appendFileSync(resolve(root, "fake-docker.log"), args.join(" ") + "\\n");
if (command === "config" || command === "down") process.exit(0);
if (command === "up") {
  const target = env.includes("APP_RELEASE_VERSION=0.5.0");
  if (target && process.env.UPDATE_TEST_FAIL_START === "true") process.exit(1);
  process.exit(0);
}
if (command !== "exec") process.exit(1);
if (args.includes("backup")) {
  writeFileSync(resolve(root, "backups", "betreuungskalender-sqlite-2026-01-01T00-00-00Z.sqlite"), "synthetic-backup");
  process.exit(0);
}
if (args.includes("restore:check")) {
  if (process.env.UPDATE_TEST_FAIL_BACKUP === "true") process.exit(1);
  process.exit(0);
}
if (args.includes("verify:runtime")) {
  const target = env.includes("APP_RELEASE_VERSION=0.5.0");
  if (target && process.env.UPDATE_TEST_FAIL_TARGET === "true") process.exit(1);
  process.exit(0);
}
process.exit(1);
`);
  await chmod(fakeDocker, 0o755);
}

async function createInstallation(directory, options = {}) {
  const root = resolve(directory, "installation");
  const current = resolve(root, "releases", "v0.4.0");
  const composeFile = options.composeFile ?? "compose.yml";
  await mkdir(resolve(root, "data"), { recursive: true });
  await mkdir(resolve(root, "backups"), { recursive: true });
  await mkdir(current, { recursive: true });
  await writeFile(resolve(root, composeFile), "services: {}\n");
  await writeFile(resolve(root, "data", "app.sqlite"), "before-update");
  await writeFile(resolve(current, "package.json"), JSON.stringify({ version: "0.4.0" }));
  await writeFile(
    resolve(root, ".env"),
    `APP_RELEASE_DIR=${current}\nAPP_RELEASE_VERSION=0.4.0\n${options.env ?? ""}REQUIRE_AUTH=true\n`
  );
  return root;
}

function updateOptions(root, artifact, checksumPath, overrides = {}) {
  return {
    ...parseArguments([
      "--root", root,
      "--version", "0.5.0",
      "--artifact", artifact,
      "--checksum", checksumPath,
      "--health-retries", "1",
      "--health-delay-ms", "1",
      "--min-free-kb", "1"
    ]),
    ...overrides
  };
}

async function withFakeDocker(directory, callback) {
  const originalPath = process.env.PATH;
  process.env.PATH = `${directory}:${originalPath}`;
  try {
    await callback();
  } finally {
    process.env.PATH = originalPath;
    delete process.env.UPDATE_TEST_FAIL_TARGET;
    delete process.env.UPDATE_TEST_FAIL_START;
    delete process.env.UPDATE_TEST_FAIL_BACKUP;
  }
}

test("parses checksum files and preserves unrelated environment settings", () => {
  assert.equal(parseChecksum("a".repeat(64) + "  release.tar.gz"), "a".repeat(64));
  assert.match(updateEnv("REQUIRE_AUTH=true\n", { APP_RELEASE_VERSION: "0.5.0" }), /REQUIRE_AUTH=true/);
  assert.match("# v0.5.0+build.1", new RegExp(`^# v${escapeRegExp("0.5.0+build.1")}(?:\\s|$)`));
  assert.throws(() => parseArguments(["--version", "0.5.0", "--artifact", "release.tar.gz"]), /checksum/);
});

test("keeps compiled release assets in the Docker build context", async () => {
  const dockerIgnore = await readFile(resolve(process.cwd(), ".dockerignore"), "utf8");
  assert.doesNotMatch(dockerIgnore, /^dist$/m);
  assert.doesNotMatch(dockerIgnore, /^dist-server$/m);
});

test("synthetic Compose upgrade verifies backup and records the active release", async () => {
  await withTemporaryDirectory("success", async (directory) => {
    const root = await createInstallation(directory);
    const { archive, checksumPath } = await createArtifact(directory);
    await createFakeDocker(directory);
    await withFakeDocker(directory, async () => {
      await runUpdate(updateOptions(root, archive, checksumPath));
    });
    const env = await readFile(resolve(root, ".env"), "utf8");
    const state = JSON.parse(await readFile(resolve(root, ".update-state.json"), "utf8"));
    assert.match(env, /APP_RELEASE_VERSION=0.5.0/);
    assert.match(env, /REQUIRE_AUTH=true/);
    assert.equal(state.activeVersion, "0.5.0");
    assert.equal(state.rollbackBackup, "betreuungskalender-sqlite-2026-01-01T00-00-00Z.sqlite");
    assert.match(state.configurationBackup, /^update-.*\.env$/);
    assert.match(await readFile(resolve(root, "backups", state.configurationBackup), "utf8"), /REQUIRE_AUTH=true/);
  });
});

test("synthetic OIDC Compose upgrade uses APP_COMPOSE_FILE", async () => {
  await withTemporaryDirectory("oidc-compose", async (directory) => {
    const root = await createInstallation(directory, {
      composeFile: "compose.oidc.yml",
      env: "APP_COMPOSE_FILE=compose.oidc.yml\n"
    });
    const { archive, checksumPath } = await createArtifact(directory);
    await createFakeDocker(directory);
    await withFakeDocker(directory, async () => {
      await runUpdate(updateOptions(root, archive, checksumPath, { dryRun: true }));
    });
    const log = await readFile(resolve(root, "fake-docker.log"), "utf8");
    assert.match(log, /-f .*compose\.oidc\.yml config -q/);
  });
});

test("rejects unsupported Compose filenames from APP_COMPOSE_FILE", async () => {
  await withTemporaryDirectory("bad-compose-file", async (directory) => {
    const root = await createInstallation(directory, {
      env: "APP_COMPOSE_FILE=../compose.oidc.yml\n"
    });
    const { archive, checksumPath } = await createArtifact(directory);
    await assert.rejects(
      runUpdate(updateOptions(root, archive, checksumPath, { dryRun: true })),
      /APP_COMPOSE_FILE must be compose\.yml or compose\.oidc\.yml/
    );
  });
});

test("synthetic failed verification restores the prior runtime and matching SQLite backup", async () => {
  await withTemporaryDirectory("rollback", async (directory) => {
    const root = await createInstallation(directory);
    const { archive, checksumPath } = await createArtifact(directory);
    await createFakeDocker(directory);
    await withFakeDocker(directory, async () => {
      process.env.UPDATE_TEST_FAIL_TARGET = "true";
      await assert.rejects(runUpdate(updateOptions(root, archive, checksumPath)));
    });
    const env = await readFile(resolve(root, ".env"), "utf8");
    assert.match(env, /APP_RELEASE_VERSION=0.4.0/);
    assert.equal(await readFile(resolve(root, "data", "app.sqlite"), "utf8"), "synthetic-backup");
  });
});

test("synthetic startup and backup failures never leave an unverified release active", async () => {
  await withTemporaryDirectory("failure", async (directory) => {
    const root = await createInstallation(directory);
    const { archive, checksumPath } = await createArtifact(directory);
    await createFakeDocker(directory);
    await withFakeDocker(directory, async () => {
      process.env.UPDATE_TEST_FAIL_START = "true";
      await assert.rejects(runUpdate(updateOptions(root, archive, checksumPath)));
      delete process.env.UPDATE_TEST_FAIL_START;
      const backupFailureRoot = await createInstallation(resolve(directory, "backup-failure"));
      process.env.UPDATE_TEST_FAIL_BACKUP = "true";
      await assert.rejects(runUpdate(updateOptions(backupFailureRoot, archive, checksumPath)));
      assert.equal(await readFile(resolve(backupFailureRoot, "data", "app.sqlite"), "utf8"), "before-update");
      assert.match(await readFile(resolve(backupFailureRoot, ".env"), "utf8"), /APP_RELEASE_VERSION=0.4.0/);
    });
    const env = await readFile(resolve(root, ".env"), "utf8");
    assert.match(env, /APP_RELEASE_VERSION=0.4.0/);
    assert.equal(await readFile(resolve(root, "data", "app.sqlite"), "utf8"), "synthetic-backup");
  });
});

test("dry runs and update locks leave the installation unchanged", async () => {
  await withTemporaryDirectory("dry-run", async (directory) => {
    const root = await createInstallation(directory);
    const { archive, checksumPath } = await createArtifact(directory);
    await createFakeDocker(directory);
    await withFakeDocker(directory, async () => {
      await runUpdate(updateOptions(root, archive, checksumPath, { dryRun: true }));
      await mkdir(resolve(root, ".update-lock"));
      await assert.rejects(runUpdate(updateOptions(root, archive, checksumPath)), (error) => error.code === 11);
    });
    assert.equal(await readFile(resolve(root, "data", "app.sqlite"), "utf8"), "before-update");
    assert.equal(await readFile(resolve(root, ".env"), "utf8"), `APP_RELEASE_DIR=${resolve(root, "releases", "v0.4.0")}\nAPP_RELEASE_VERSION=0.4.0\nREQUIRE_AUTH=true\n`);
  });
});
