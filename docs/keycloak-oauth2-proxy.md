# Keycloak and oauth2-proxy

## Keycloak client

Create an OpenID Connect confidential client:

- Client ID: `betreuungskalender`
- Standard Flow: enabled
- Direct Access Grants: disabled
- Valid redirect URI:
  `https://bk.example.net/oauth2/callback`
- Web origin: `https://bk.example.net`
- Client authentication: enabled
- MFA: recommended for all users

Restrict access to an explicit Keycloak group or role where possible.

## Release Compose mode

The supported release-archive OIDC mode is `deploy/compose.oidc.yml`. It starts
two services on one private Compose network:

- `oauth2-proxy` publishes the only host port, normally `HOST_PORT=8080`.
- `betreuungskalender` exposes port `3000` only to Compose services and does
  not publish a host port.

For an OPNsense HAProxy frontend with TLS, point the backend to the Compose host
and oauth2-proxy port, for example `ct28:8080`. The public URL must match
`ALLOWED_ORIGIN` and the Keycloak redirect URI.

For the `https://bk.huneck.net` deployment, configure the Keycloak redirect URI
as `https://bk.huneck.net/oauth2/callback`, set the web origin to
`https://bk.huneck.net`, and forward OPNsense HAProxy to `ct28:8080`.

Use `deploy/.env.oidc.example` as the starting point for the release `.env` and
`deploy/oauth2-proxy.cfg.example` as the starting point for
`oauth2-proxy.cfg`.

## oauth2-proxy example

Store this configuration outside the repository and protect it with mode
`0600`. The release artifact includes the same placeholder-only example at
`deploy/oauth2-proxy.cfg.example`.

```ini
provider = "keycloak-oidc"
oidc_issuer_url = "https://idp.example.net/realms/example"
client_id = "betreuungskalender"
client_secret = "CHANGE_ME"
redirect_url = "https://bk.example.net/oauth2/callback"

email_domains = [ "*" ]
http_address = "0.0.0.0:4180"
upstreams = [ "http://betreuungskalender:3000" ]

cookie_secret = "CHANGE_ME_32_BYTE_BASE64"
cookie_secure = true
cookie_httponly = true
cookie_samesite = "lax"

reverse_proxy = true
set_xauthrequest = true
pass_access_token = false
pass_authorization_header = false
```

Generate `client_secret` in Keycloak. Generate `cookie_secret` using the
oauth2-proxy documentation. Never reuse the example strings.

## Identity headers

Betreuungskalender accepts these headers when `TRUST_PROXY_AUTH=true`:

- `X-Auth-Request-Email`
- `X-Forwarded-Email`
- `X-Auth-Request-User`
- `X-Forwarded-User`

Prefer email only if it is stable and required for your audit policy. The
application stores the asserted identity in API audit records.

## Required app settings

```dotenv
REQUIRE_AUTH=true
TRUST_PROXY_AUTH=true
ALLOWED_ORIGIN=https://bk.example.net
```

If the app runs in a container, bind it only to a private container network
reachable by oauth2-proxy. `deploy/compose.oidc.yml` does this by using
`expose: 3000` on the app service and `ports:` only on oauth2-proxy.

## Critical warning

Identity headers can be forged by any client that reaches the app directly.
Authentication is secure only when firewall, listener address, or private
container networking prevents bypassing oauth2-proxy. Strip incoming
`X-Auth-Request-*` and `X-Forwarded-*User/Email` headers at the public edge.

## Validation checklist

After starting the OIDC Compose stack:

1. Confirm `docker compose ps` shows a host port only on oauth2-proxy.
2. Confirm the app healthcheck is healthy inside Compose.
3. Open the public URL and confirm unauthenticated access redirects through
   `/oauth2/start`.
4. Confirm Keycloak returns to `/oauth2/callback`.
5. Create or update a harmless test record and confirm the audit identity is
   the expected proxy-authenticated user.
6. Confirm direct access to the app container port is not reachable from the
   client network.
