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

function textEnv(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
}

function authModeEnv(
  value: string | undefined,
  fallback: "local" | "trusted-proxy"
): "local" | "trusted-proxy" | "native-oidc" {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  if (
    normalized === "local" ||
    normalized === "trusted-proxy" ||
    normalized === "native-oidc"
  ) {
    return normalized;
  }
  throw new Error("AUTH_MODE must be one of local, trusted-proxy, native-oidc.");
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

const trustProxyAuth = booleanEnv(process.env.TRUST_PROXY_AUTH);

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  host: process.env.HOST ?? "127.0.0.1",
  port: numberEnv(process.env.PORT, 3000),
  databasePath: resolve(process.cwd(), process.env.DATABASE_PATH ?? "./data/app.sqlite"),
  backupDir: resolve(process.cwd(), process.env.BACKUP_DIR ?? "./backups"),
  requireAuth: booleanEnv(process.env.REQUIRE_AUTH),
  trustProxyAuth,
  authMode: authModeEnv(
    process.env.AUTH_MODE,
    trustProxyAuth ? "trusted-proxy" : "local"
  ),
  authLogoutUrl: process.env.AUTH_LOGOUT_URL?.trim() || undefined,
  oidcIssuerUrl: process.env.OIDC_ISSUER_URL?.trim() || undefined,
  oidcClientId: process.env.OIDC_CLIENT_ID?.trim() || undefined,
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET?.trim() || undefined,
  oidcRedirectUri: process.env.OIDC_REDIRECT_URI?.trim() || undefined,
  oidcScopes: textEnv(process.env.OIDC_SCOPES, "openid email profile"),
  oidcLoginStateTtlSeconds: positiveNumberEnv(process.env.OIDC_LOGIN_STATE_TTL_SECONDS, 600),
  oidcUserIdHeader: textEnv(process.env.OIDC_USER_ID_HEADER, "x-auth-request-user"),
  oidcEmailHeader: textEnv(process.env.OIDC_EMAIL_HEADER, "x-auth-request-email"),
  oidcDisplayNameHeader: textEnv(process.env.OIDC_DISPLAY_NAME_HEADER, "x-auth-request-preferred-username"),
  oidcGroupsHeader: textEnv(process.env.OIDC_GROUPS_HEADER, "x-auth-request-groups"),
  oidcAdminGroup: textEnv(process.env.OIDC_ADMIN_GROUP, "/betreuungskalender/admins"),
  oidcParentGroup: textEnv(process.env.OIDC_PARENT_GROUP, "/betreuungskalender/parents"),
  oidcReadonlyGroup: textEnv(process.env.OIDC_READONLY_GROUP, "/betreuungskalender/readers"),
  oidcRequireRoleClaim: booleanEnv(process.env.OIDC_REQUIRE_ROLE_CLAIM),
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
