# Keycloak and oauth2-proxy

## Keycloak client

Create an OpenID Connect confidential client:

- Client ID: `betreuungskalender`
- Standard Flow: enabled
- Direct Access Grants: disabled
- Valid redirect URI:
  `https://app.example.net/oauth2/callback`
- Web origin: `https://app.example.net`
- Client authentication: enabled
- MFA: recommended for all users

Restrict access to an explicit Keycloak group or role where possible.

## Release Compose mode

The supported release-archive OIDC mode is `deploy/compose.oidc.yml`. It starts
two services on one private Compose network:

- `oauth2-proxy` publishes the only host port, normally `HOST_PORT=8080`.
- `betreuungskalender` exposes port `3000` only to Compose services and does
  not publish a host port.

For an external TLS reverse proxy, point the backend to the Compose host and
oauth2-proxy port, for example `app-host.example.net:8080` or
`192.0.2.10:8080`. The public URL must match `ALLOWED_ORIGIN` and the Keycloak
redirect URI.

For example, with a public URL of `https://app.example.net`, configure the
Keycloak redirect URI as `https://app.example.net/oauth2/callback`, set the web
origin to `https://app.example.net`, and forward the external reverse proxy to
the Compose host on `HOST_PORT`, for example `192.0.2.10:8080`.

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
redirect_url = "https://app.example.net/oauth2/callback"

email_domains = [ "*" ]
http_address = "0.0.0.0:4180"
upstreams = [ "http://betreuungskalender:3000" ]
trusted_ips = [ "127.0.0.1/32", "192.0.2.10/32" ]

cookie_secret = "CHANGE_ME_32_BYTE_BASE64"
cookie_secure = true
cookie_httponly = true
cookie_samesite = "lax"

reverse_proxy = true
set_xauthrequest = true
set_authorization_header = false
pass_access_token = false
pass_authorization_header = false
```

Generate `client_secret` in Keycloak. Generate a 32-character cookie secret
that oauth2-proxy accepts, then paste it into `oauth2-proxy.cfg`:

```bash
COOKIE_SECRET="$(openssl rand -hex 16)"
printf '%s\n' "$COOKIE_SECRET"
test "${#COOKIE_SECRET}" -eq 32
```

Never reuse the example strings.

`reverse_proxy = true` must be paired with a narrow `trusted_ips` list. Replace
the placeholder `192.0.2.10/32` with the actual IP address or CIDR of the
trusted upstream TLS reverse proxy. Do not use `0.0.0.0/0`; clients must not be
allowed to inject or spoof forwarded headers.

## Identity and authorization headers

Betreuungskalender accepts trusted claim-derived headers when
`TRUST_PROXY_AUTH=true`. Configure the app to read the same headers that
oauth2-proxy sends:

```dotenv
OIDC_USER_ID_HEADER=x-auth-request-user
OIDC_EMAIL_HEADER=x-auth-request-email
OIDC_DISPLAY_NAME_HEADER=x-auth-request-preferred-username
OIDC_GROUPS_HEADER=x-auth-request-groups
OIDC_ADMIN_GROUP=/betreuungskalender/admins
OIDC_PARENT_GROUP=/betreuungskalender/parents
OIDC_READONLY_GROUP=/betreuungskalender/readers
OIDC_REQUIRE_ROLE_CLAIM=false
```

The user ID header must contain a stable subject value that does not change
when an email address or display name changes. The app maps that subject to an
internal `app_users` row and refreshes display name, email, and group data on
each request.

Permissions are derived from the configured group values and enforced by the
Fastify API:

- `OIDC_ADMIN_GROUP`: full read/write access plus import, clear-data, and
  legacy-migration endpoints
- `OIDC_PARENT_GROUP`: ordinary read/write access
- `OIDC_READONLY_GROUP`: read-only access

For a compatibility rollout from the pre-v1.1.0 single-user proxy mode, keep
`OIDC_REQUIRE_ROLE_CLAIM=false` temporarily. In that mode, authenticated users
without a recognized group receive parent-level permissions. Switch it to
`true` once the Keycloak mapper emits the expected groups header.

The browser UI reads `/api/session` and displays a compact signed-in name
derived from the trusted display-name or email header. It does not expose raw
token content.

## Logout

Betreuungskalender does not manage the oauth2-proxy browser session itself. Set
`AUTH_LOGOUT_URL=/oauth2/sign_out` so the app shell can show a logout action
that hands control back to oauth2-proxy. If your deployment uses a custom
sign-out path or post-logout redirect, configure that reviewed same-origin path
privately in `.env`.

## Required app settings

```dotenv
REQUIRE_AUTH=true
TRUST_PROXY_AUTH=true
AUTH_LOGOUT_URL=/oauth2/sign_out
ALLOWED_ORIGIN=https://app.example.net
OIDC_USER_ID_HEADER=x-auth-request-user
OIDC_EMAIL_HEADER=x-auth-request-email
OIDC_DISPLAY_NAME_HEADER=x-auth-request-preferred-username
OIDC_GROUPS_HEADER=x-auth-request-groups
OIDC_ADMIN_GROUP=/betreuungskalender/admins
OIDC_PARENT_GROUP=/betreuungskalender/parents
OIDC_READONLY_GROUP=/betreuungskalender/readers
OIDC_REQUIRE_ROLE_CLAIM=false
```

If the app runs in a container, bind it only to a private container network
reachable by oauth2-proxy. `deploy/compose.oidc.yml` does this by using
`expose: 3000` on the app service and `ports:` only on oauth2-proxy.
Switch `OIDC_REQUIRE_ROLE_CLAIM=true` only after Keycloak/oauth2-proxy group
headers have been confirmed against the configured group values.

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
5. Create or update a harmless test record and confirm the audit identity is a
   stable internal user ID.
6. Confirm direct access to the app container port is not reachable from the
   client network.
7. Test a read-only user: reads should work, writes should return `403`.
