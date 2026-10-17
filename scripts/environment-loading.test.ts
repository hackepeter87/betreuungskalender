import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const configModuleUrl = pathToFileURL(
  path.join(projectRoot, "server/config.ts")
).href;
const tsxLoaderUrl = import.meta.resolve("tsx");

async function readLoadedPort(
  directory: string,
  environment: NodeJS.ProcessEnv = {}
): Promise<number> {
  const script = [
    `const { config } = await import(${JSON.stringify(configModuleUrl)});`,
    "process.stdout.write(String(config.port));"
  ].join("\n");
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--import", tsxLoaderUrl, "--input-type=module", "--eval", script],
    {
      cwd: directory,
      env: {
        NODE_ENV: "test",
        AUTH_MODE: "local",
        ...environment
      }
    }
  );
  assert.equal(stderr, "");
  return Number(stdout);
}

test("explicit environment loading keeps a missing local file optional", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bk-env-missing-"));
  assert.equal(await readLoadedPort(directory), 3000);
});

test("explicit environment loading reads a synthetic local file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bk-env-file-"));
  await writeFile(path.join(directory, ".env"), "PORT=4312\n", "utf8");
  assert.equal(await readLoadedPort(directory), 4312);
});

test("process environment values take precedence over a local file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bk-env-precedence-"));
  await writeFile(path.join(directory, ".env"), "PORT=4312\n", "utf8");
  assert.equal(await readLoadedPort(directory, { PORT: "5412" }), 5412);
});

test("invalid loaded configuration still fails through validation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bk-env-invalid-"));
  await writeFile(
    path.join(directory, ".env"),
    "METRICS_ENABLED=true\n",
    "utf8"
  );
  await assert.rejects(
    readLoadedPort(directory),
    /METRICS_ENABLED=true requires METRICS_BEARER_TOKEN_FILE/
  );
});

test("maintained runtime entry points use the same explicit loading semantics", async () => {
  const entryPoints = [
    "server/config.ts",
    "scripts/backup.js",
    "scripts/restore-check.js",
    "scripts/runtime-verify.js"
  ];
  for (const entryPoint of entryPoints) {
    const source = await readFile(path.join(projectRoot, entryPoint), "utf8");
    assert.doesNotMatch(source, /dotenv\/config/u, entryPoint);
    assert.match(source, /loadEnvironment\(\{ quiet: true, override: false \}\);/u, entryPoint);
  }
});
