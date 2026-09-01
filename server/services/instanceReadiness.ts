import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { config } from "../config.js";
import { db } from "../db/connection.js";
import type { PersistenceExecutor } from "../db/runtime.js";
import { availableMigrationVersions } from "../db/migrationRunner.js";
import { buildSetupState } from "./setupState.js";
import type { ApiInstanceReadiness } from "../../shared/api.js";

type ReadinessConfig = Pick<
  typeof config,
  | "authMode"
  | "demoDatasetsEnabled"
  | "nodeEnv"
  | "recoveryAdminEnabled"
  | "requireAuth"
  | "trustProxyAuth"
  | "version"
  | "webPushPrivateKey"
  | "webPushPublicKey"
>;

function appliedMigrations(database: Database.Database): Array<{ version: string; appliedAt: string }> {
  return database.prepare(`
    SELECT version, applied_at AS appliedAt
    FROM schema_migrations
    ORDER BY version
  `).all() as Array<{ version: string; appliedAt: string }>;
}

function stableInstanceId(migrations: Array<{ version: string; appliedAt: string }>): string {
  const seed = migrations[0]
    ? `${migrations[0].version}:${migrations[0].appliedAt}`
    : "uninitialized";
  return `inst_${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}

export async function buildInstanceReadiness(
  database: Database.Database = db,
  runtime: ReadinessConfig = config,
  persistence?: PersistenceExecutor
): Promise<ApiInstanceReadiness> {
  const migrations = appliedMigrations(database);
  const available = availableMigrationVersions();
  const latestApplied = migrations.at(-1)?.version;
  const latestAvailable = available.at(-1);
  if (!persistence) {
    throw new Error("Readiness persistence is not configured.");
  }
  const setup = await buildSetupState(persistence);

  return {
    instanceId: stableInstanceId(migrations),
    version: runtime.version,
    environment: runtime.nodeEnv,
    authMode: runtime.authMode,
    requireAuth: runtime.requireAuth,
    serverTime: new Date().toISOString(),
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
    }
  };
}
