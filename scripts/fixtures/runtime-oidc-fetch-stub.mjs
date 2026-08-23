import { createHmac } from "node:crypto";

const issuer = process.env.RUNTIME_OIDC_TEST_ISSUER;
const clientId = process.env.OIDC_CLIENT_ID;
const clientSecret = process.env.OIDC_CLIENT_SECRET;
const originalFetch = globalThis.fetch;

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function jwtPart(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function idToken({ subject, nonce }) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = jwtPart({ alg: "HS256", typ: "JWT" });
  const payload = jwtPart({
    iss: issuer,
    aud: clientId,
    sub: subject,
    nonce,
    iat: issuedAt,
    exp: issuedAt + 300,
    preferred_username: subject,
    email: `${subject}@example.invalid`,
    groups: []
  });
  const signature = createHmac("sha256", clientSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

if (issuer && clientId && clientSecret) {
  const issuerUrl = new URL(issuer);
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== issuerUrl.origin) {
      return originalFetch(input, init);
    }

    if (url.pathname.endsWith("/.well-known/openid-configuration")) {
      return jsonResponse({
        issuer,
        authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${issuer}/protocol/openid-connect/token`,
        jwks_uri: `${issuer}/protocol/openid-connect/certs`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["HS256"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"]
      });
    }

    if (url.pathname.endsWith("/protocol/openid-connect/token")) {
      const parameters = new URLSearchParams(await request.text());
      const encodedCode = parameters.get("code");
      if (!encodedCode) return jsonResponse({ error: "invalid_grant" }, 400);
      let code;
      try {
        code = JSON.parse(Buffer.from(encodedCode, "base64url").toString("utf8"));
      } catch {
        return jsonResponse({ error: "invalid_grant" }, 400);
      }
      if (typeof code?.subject !== "string" || typeof code?.nonce !== "string") {
        return jsonResponse({ error: "invalid_grant" }, 400);
      }
      return jsonResponse({
        access_token: "fictional-runtime-access-token",
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken(code)
      });
    }

    return jsonResponse({ error: "not_found" }, 404);
  };
}
