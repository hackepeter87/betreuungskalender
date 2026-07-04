import assert from "node:assert/strict";
import test from "node:test";
import { validateAuthModeConfig, type AuthModeValidationInput } from "./config.js";

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
