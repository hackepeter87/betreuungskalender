import assert from "node:assert/strict";
import test from "node:test";
import {
  validateAuthModeConfig,
  validateDatabaseConfig,
  validateDemoModeConfig,
  validateMetricsConfig,
  validateOidcProxyConfig,
  type AuthModeValidationInput,
  type DatabaseValidationInput
} from "./config.js";

test("OIDC proxy validation is disabled by default", () => {
  assert.doesNotThrow(() => validateOidcProxyConfig({ authMode: "local" }));
});

test("OIDC proxy validation requires native OIDC and a pinned HTTPS issuer", () => {
  assert.throws(
    () => validateOidcProxyConfig({
      authMode: "local",
      proxyUrl: "http://oidc-proxy.internal:3128"
    }),
    /OIDC_PROXY_URL requires AUTH_MODE=native-oidc/
  );
  for (const issuerUrl of [
    "http://idp.example.test/realms/demo",
    "https://idp.example.test:8443/realms/demo",
    "https://user:secret@idp.example.test/realms/demo",
    "https://idp.example.test/realms/demo#fragment"
  ]) {
    assert.throws(
      () => validateOidcProxyConfig({
        authMode: "native-oidc",
        issuerUrl,
        proxyUrl: "http://oidc-proxy.internal:3128"
      }),
      /OIDC proxy transport requires an HTTPS OIDC_ISSUER_URL on port 443/
    );
  }
});

test("OIDC proxy validation rejects credentials and non-origin proxy URLs", () => {
  const base = {
    authMode: "native-oidc" as const,
    issuerUrl: "https://idp.example.test/realms/demo"
  };
  for (const proxyUrl of [
    "http://user:secret@oidc-proxy.internal:3128",
    "http://oidc-proxy.internal:3128/path",
    "http://oidc-proxy.internal:3128/?mode=open",
    "file:///run/proxy.sock"
  ]) {
    assert.throws(
      () => validateOidcProxyConfig({ ...base, proxyUrl }),
      /OIDC_PROXY_URL must be an HTTP\(S\) origin without credentials, path, query, or fragment/
    );
  }
  assert.doesNotThrow(() => validateOidcProxyConfig({
    ...base,
    proxyUrl: "http://oidc-proxy.internal:3128"
  }));
});

function validationInput(
  overrides: Partial<AuthModeValidationInput> = {}
): AuthModeValidationInput {
  return {
    nodeEnv: "production",
    authMode: "trusted-proxy",
    requireAuth: true,
    configuredTrustProxyAuth: true,
    explicitAuthMode: false,
    trustedProxyCidrs: [],
    ...overrides
  };
}

test("auth mode validation rejects conflicting trusted-proxy header trust", () => {
  assert.throws(
    () => validateAuthModeConfig(validationInput({
      authMode: "native-oidc",
      configuredTrustProxyAuth: true,
      explicitAuthMode: true,
      oidcIssuerUrl: "https://idp.example.test/realms/demo",
      oidcClientId: "betreuungskalender",
      oidcRedirectUri: "https://bk.example.test/auth/callback"
    })),
    /TRUST_PROXY_AUTH=true is only valid with AUTH_MODE=trusted-proxy/
  );
});

test("auth mode validation fails closed for external production modes", () => {
  assert.throws(
    () => validateAuthModeConfig(validationInput({
      authMode: "trusted-proxy",
      requireAuth: false
    })),
    /Production external authentication modes require REQUIRE_AUTH=true/
  );

  assert.throws(
    () => validateAuthModeConfig(validationInput({
      authMode: "native-oidc",
      requireAuth: false,
      configuredTrustProxyAuth: false,
      explicitAuthMode: true,
      oidcIssuerUrl: "https://idp.example.test/realms/demo",
      oidcClientId: "betreuungskalender",
      oidcRedirectUri: "https://bk.example.test/auth/callback"
    })),
    /Production external authentication modes require REQUIRE_AUTH=true/
  );
});

test("auth mode validation requires native OIDC startup configuration", () => {
  assert.throws(
    () => validateAuthModeConfig(validationInput({
      authMode: "native-oidc",
      configuredTrustProxyAuth: false,
      explicitAuthMode: true
    })),
    /AUTH_MODE=native-oidc requires OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_REDIRECT_URI/
  );
});

test("auth mode validation keeps local evaluation explicit", () => {
  assert.throws(
    () => validateAuthModeConfig(validationInput({
      authMode: "local",
      requireAuth: false,
      configuredTrustProxyAuth: false,
      explicitAuthMode: false
    })),
    /Production local auth without REQUIRE_AUTH=true requires explicit AUTH_MODE=local/
  );

  assert.doesNotThrow(() => validateAuthModeConfig(validationInput({
    authMode: "local",
    requireAuth: false,
    configuredTrustProxyAuth: false,
    explicitAuthMode: true
  })));
});

test("auth mode validation rejects invalid trusted proxy CIDR entries", () => {
  assert.throws(
    () => validateAuthModeConfig(validationInput({
      trustedProxyCidrs: ["10.0.0.0/99"]
    })),
    /Invalid trusted proxy CIDR prefix/
  );

  assert.throws(
    () => validateAuthModeConfig(validationInput({
      trustedProxyCidrs: ["not-an-address"]
    })),
    /Invalid trusted proxy address or CIDR/
  );

  assert.doesNotThrow(() => validateAuthModeConfig(validationInput({
    trustedProxyCidrs: ["127.0.0.1", "10.0.0.0/24", "::1/128"]
  })));
});

test("auth mode validation requires an explicit trusted proxy allowlist", () => {
  assert.throws(
    () => validateAuthModeConfig(validationInput()),
    /AUTH_MODE=trusted-proxy requires at least one TRUSTED_PROXY_CIDRS/
  );

  assert.doesNotThrow(() => validateAuthModeConfig(validationInput({
    trustedProxyCidrs: ["127.0.0.1/32"]
  })));
});

function databaseValidationInput(
  overrides: Partial<DatabaseValidationInput> = {}
): DatabaseValidationInput {
  return {
    driver: "sqlite",
    postgresPort: 5432,
    postgresTlsMode: "verify-full",
    ...overrides
  };
}

test("database validation keeps SQLite as the zero-configuration default", () => {
  assert.doesNotThrow(() => validateDatabaseConfig(databaseValidationInput()));
});

test("database validation requires complete PostgreSQL connection settings", () => {
  assert.throws(
    () => validateDatabaseConfig(databaseValidationInput({ driver: "postgres" })),
    /DATABASE_DRIVER=postgres requires POSTGRES_HOST, POSTGRES_DATABASE, POSTGRES_USER, POSTGRES_PASSWORD_FILE, POSTGRES_CA_FILE/
  );
});

test("database validation requires a CA for verified PostgreSQL TLS", () => {
  assert.throws(
    () => validateDatabaseConfig(databaseValidationInput({
      driver: "postgres",
      postgresHost: "database.example.test",
      postgresDatabase: "betreuungskalender",
      postgresUser: "betreuungskalender",
      postgresPasswordFile: "/run/secrets/postgres-password"
    })),
    /POSTGRES_CA_FILE/
  );

  assert.doesNotThrow(() => validateDatabaseConfig(databaseValidationInput({
    driver: "postgres",
    postgresHost: "database.example.test",
    postgresDatabase: "betreuungskalender",
    postgresUser: "betreuungskalender",
    postgresPasswordFile: "/run/secrets/postgres-password",
    postgresCaFile: "/run/secrets/postgres-ca"
  })));
});

test("database validation permits explicitly unencrypted PostgreSQL only without a CA", () => {
  assert.doesNotThrow(() => validateDatabaseConfig(databaseValidationInput({
    driver: "postgres",
    postgresHost: "postgres",
    postgresDatabase: "betreuungskalender",
    postgresUser: "betreuungskalender",
    postgresPasswordFile: "/run/secrets/postgres-password",
    postgresTlsMode: "disable"
  })));

  assert.throws(
    () => validateDatabaseConfig(databaseValidationInput({
      driver: "postgres",
      postgresHost: "postgres",
      postgresDatabase: "betreuungskalender",
      postgresUser: "betreuungskalender",
      postgresPasswordFile: "/run/secrets/postgres-password",
      postgresTlsMode: "disable",
      postgresCaFile: "/run/secrets/postgres-ca"
    })),
    /POSTGRES_CA_FILE is only valid/
  );
});

test("database validation rejects PostgreSQL settings with the SQLite driver", () => {
  assert.throws(
    () => validateDatabaseConfig(databaseValidationInput({
      postgresHost: "postgres"
    })),
    /PostgreSQL settings require DATABASE_DRIVER=postgres/
  );
  assert.throws(
    () => validateDatabaseConfig(databaseValidationInput({
      postgresPortConfigured: true
    })),
    /PostgreSQL settings require DATABASE_DRIVER=postgres/
  );
  assert.throws(
    () => validateDatabaseConfig(databaseValidationInput({
      postgresTlsModeConfigured: true
    })),
    /PostgreSQL settings require DATABASE_DRIVER=postgres/
  );
});

test("demo mode stays disabled without imposing deployment constraints", () => {
  assert.doesNotThrow(() => validateDemoModeConfig({
    enabled: false,
    databaseDriver: "postgres",
    authMode: "local",
    requireAuth: false,
    demoDatasetsEnabled: true
  }));
});

test("demo mode requires SQLite, native OIDC, authentication, and a separate seed lifecycle", () => {
  const valid = {
    enabled: true,
    databaseDriver: "sqlite" as const,
    authMode: "native-oidc" as const,
    requireAuth: true,
    demoDatasetsEnabled: false
  };
  assert.doesNotThrow(() => validateDemoModeConfig(valid));
  assert.throws(
    () => validateDemoModeConfig({ ...valid, databaseDriver: "postgres" }),
    /DEMO_MODE_ENABLED=true requires DATABASE_DRIVER=sqlite/
  );
  assert.throws(
    () => validateDemoModeConfig({ ...valid, authMode: "trusted-proxy" }),
    /DEMO_MODE_ENABLED=true requires AUTH_MODE=native-oidc/
  );
  assert.throws(
    () => validateDemoModeConfig({ ...valid, requireAuth: false }),
    /DEMO_MODE_ENABLED=true requires REQUIRE_AUTH=true/
  );
  assert.throws(
    () => validateDemoModeConfig({ ...valid, demoDatasetsEnabled: true }),
    /DEMO_DATASETS_ENABLED must remain false/
  );
});

test("metrics validation requires a file-backed secret only when enabled", () => {
  assert.doesNotThrow(() => validateMetricsConfig({ enabled: false }));
  assert.throws(
    () => validateMetricsConfig({ enabled: true }),
    /METRICS_ENABLED=true requires METRICS_BEARER_TOKEN_FILE/
  );
  assert.doesNotThrow(() => validateMetricsConfig({
    enabled: true,
    bearerTokenFile: "/run/secrets/metrics/token"
  }));
});
