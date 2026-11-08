import { createHash } from "node:crypto";
import { config } from "../config.js";
import { availableMigrationVersions } from "../db/migrationRunner.js";
import type { DatabaseExecutor } from "../db/runtime.js";
import { buildSetupState } from "./setupState.js";
import type { ApiInstanceReadiness } from "../../shared/api.js";
import { readDemoResetState } from "./demoReset.js";

type ReadinessConfig = Pick<
  typeof config,
  | "authMode"
  | "demoModeEnabled"
  | "demoDatasetsEnabled"
  | "nodeEnv"
  | "recoveryAdminEnabled"
  | "requireAuth"
  | "trustProxyAuth"
  | "version"
  | "webPushPrivateKey"
  | "webPushPublicKey"
>;

async function appliedMigrations(database: DatabaseExecutor) {
  return database.selectFrom("schema_migrations")
    .select(["version", "applied_at as appliedAt"])
    .orderBy("version")
    .execute();
}

function stableInstanceId(migrations: Array<{ version: string; appliedAt: string }>): string {
  const seed = migrations[0]
    ? `${migrations[0].version}:${migrations[0].appliedAt}`
    : "uninitialized";
  return `inst_${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}

export async function buildInstanceReadiness(
  database: DatabaseExecutor,
  runtime: ReadinessConfig = config,
  now = new Date()
): Promise<ApiInstanceReadiness> {
  const migrations = await appliedMigrations(database);
  const available = availableMigrationVersions();
  const latestApplied = migrations.at(-1)?.version;
  const latestAvailable = available.at(-1);
  const setup = await buildSetupState(database);
  const demoReset = runtime.demoModeEnabled
    ? await readDemoResetState(database)
    : undefined;
  const demoStatus = demoReset?.status ?? "unavailable";
  const demoWriteLocked = demoStatus !== "ready" ||
    !Number.isFinite(Date.parse(demoReset?.nextResetAt ?? "")) ||
    Date.parse(demoReset?.nextResetAt ?? "") <= now.getTime();

  return {
    instanceId: stableInstanceId(migrations),
    version: runtime.version,
    environment: runtime.nodeEnv,
    authMode: runtime.authMode,
    requireAuth: runtime.requireAuth,
    serverTime: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "unknown",
    database: {
      reachable: true,
      migrationsApplied: migrations.length,
      ...(latestApplied ? { latestAppliedMigration: latestApplied } : {}),
      ...(latestAvailable ? { latestAvailableMigration: latestAvailable } : {}),
      upToDate: Boolean(latestApplied && latestAvailable && latestApplied === latestAvailable)
    },
    setup: {
      complete: setup.complete,
      children: setup.counts.children,
      careParties: setup.counts.careParties,
      appUsers: setup.counts.appUsers
    },
    features: {
      demoDatasetsEnabled: runtime.demoDatasetsEnabled,
      nativeOidc: runtime.authMode === "native-oidc",
      trustedProxy: runtime.trustProxyAuth,
      recoveryAdminEnabled: runtime.recoveryAdminEnabled,
      pushConfigured: Boolean(runtime.webPushPublicKey && runtime.webPushPrivateKey)
    },
    ...(runtime.demoModeEnabled
      ? {
          demoLifecycle: {
            status: demoStatus,
            writeLocked: demoWriteLocked,
            ...(demoReset?.lastSuccessfulResetAt
              ? { lastSuccessfulResetAt: demoReset.lastSuccessfulResetAt }
              : {}),
            ...(demoReset?.nextResetAt ? { nextResetAt: demoReset.nextResetAt } : {}),
            ...(demoReset?.errorCode === "demo_reset_failed"
              ? { errorCode: demoReset.errorCode }
              : {})
          }
        }
      : {})
  };
}
