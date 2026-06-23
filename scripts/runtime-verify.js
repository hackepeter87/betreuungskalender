import "dotenv/config";
import Database from "better-sqlite3";
import { resolve } from "node:path";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const expectedVersion = argumentValue("--expected-version");
const databasePath = resolve(
  process.cwd(),
  process.env.DATABASE_PATH ?? "./data/app.sqlite"
);
const healthUrl = process.env.HEALTHCHECK_URL ?? "http://127.0.0.1:3000/api/health";
const readyUrl = healthUrl.replace(/\/health(?:\?.*)?$/, "/ready");

async function responseBody(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(4_000)
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return body;
}

async function main() {
  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true
  });

  try {
    const integrity = database.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error("SQLite integrity_check was not successful.");
    const migrations = database
      .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
      .get();
    if (!migrations || Number(migrations.count) < 1) {
      throw new Error("No database migrations are recorded.");
    }
  } finally {
    database.close();
  }

  const health = await responseBody(healthUrl);
  const ready = await responseBody(readyUrl);
  if (health.status !== "ok" || health.databaseReachable !== true) {
    throw new Error("The health endpoint did not confirm database availability.");
  }
  if (ready.status !== "ready" || ready.migrationsApplied !== true) {
    throw new Error("The readiness endpoint did not confirm completed migrations.");
  }
  if (expectedVersion && health.version !== expectedVersion) {
    throw new Error(
      `Runtime version ${health.version ?? "unknown"} does not match ${expectedVersion}.`
    );
  }

  console.log(
    `Runtime verification successful: version ${health.version ?? "unknown"}, ${migrationsLabel(ready)}.`
  );
}

function migrationsLabel(ready) {
  return ready.migrationsApplied === true ? "migrations applied" : "migrations unavailable";
}

main().catch((error) => {
  console.error(
    `Runtime verification failed: ${error instanceof Error ? error.message : "unknown error"}`
  );
  process.exitCode = 1;
});
