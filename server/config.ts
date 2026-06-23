import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function booleanEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
}

function numberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNumberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function packageVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as { version?: string };
    return packageJson.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  host: process.env.HOST ?? "127.0.0.1",
  port: numberEnv(process.env.PORT, 3000),
  databasePath: resolve(process.cwd(), process.env.DATABASE_PATH ?? "./data/app.sqlite"),
  backupDir: resolve(process.cwd(), process.env.BACKUP_DIR ?? "./backups"),
  requireAuth: booleanEnv(process.env.REQUIRE_AUTH),
  trustProxyAuth: booleanEnv(process.env.TRUST_PROXY_AUTH),
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? "http://localhost:5173",
  logLevel: process.env.LOG_LEVEL ?? (
    process.env.NODE_ENV === "production" ? "info" : "debug"
  ),
  rateLimitMax: positiveNumberEnv(process.env.RATE_LIMIT_MAX, 120),
  rateLimitWriteMax: positiveNumberEnv(process.env.RATE_LIMIT_WRITE_MAX, 20),
  rateLimitSensitiveMax: positiveNumberEnv(process.env.RATE_LIMIT_SENSITIVE_MAX, 5),
  rateLimitExportMax: positiveNumberEnv(process.env.RATE_LIMIT_EXPORT_MAX, 15),
  rateLimitWindowMs: positiveNumberEnv(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  version: packageVersion()
} as const;
