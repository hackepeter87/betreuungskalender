# Configuration

Configuration is read from environment variables. `dotenv` loads a local
`.env` file when present. Never commit production `.env` files.

| Variable | Purpose | Example | Required | Default | Security relevance |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | Runtime mode and production error handling | `production` | Recommended | `development` | Production hides internal error details |
| `HOST` | Listener address | `127.0.0.1` | Optional | `127.0.0.1` | Use loopback when a local proxy is in front |
| `PORT` | HTTP port | `3000` | Optional | `3000` | Expose only through the intended firewall/proxy |
| `APP_RELEASE_VERSION` | Release Compose image tag | `1.2.0` | Required for `deploy/compose.yml` | None | Must match the extracted release package version |
| `APP_RELEASE_DIR` | Release Compose build context | `/opt/svc_betreuung/betreuungskalender/releases/v1.2.0` | Required for `deploy/compose.yml` | None | Must point at the verified extracted release directory |
| `APP_COMPOSE_FILE` | Compose file managed by the update tool | `compose.oidc.yml` | Required only when not using `compose.yml` | `compose.yml` | Must be `compose.yml` or `compose.oidc.yml` |
| `OAUTH2_PROXY_IMAGE` | oauth2-proxy image used by `deploy/compose.oidc.yml` | `quay.io/oauth2-proxy/oauth2-proxy:v7.15.3` | Optional for OIDC Compose | Same | Pin and review oauth2-proxy updates like other runtime dependencies |
| `HOST_BIND_ADDRESS` | Host address published by release Compose | `127.0.0.1` | Recommended for `deploy/compose.yml` | `127.0.0.1` | Use loopback only when the reverse proxy is on the same host |
| `HOST_PORT` | Host port published by release Compose | `3000` | Recommended for `deploy/compose.yml` | `3000` | Expose only through the intended firewall/proxy |
| `DATABASE_PATH` | SQLite database file | `/var/lib/betreuungskalender/app.sqlite` | Recommended | `./data/app.sqlite` | Contains sensitive API data; protect permissions and disk |
| `BACKUP_DIR` | Destination for SQLite backups | `/var/backups/betreuungskalender` | Recommended | `./backups` | Contains sensitive copies; use mode `0700` |
| `AUTH_MODE` | Authentication implementation mode | `trusted-proxy` | Optional | Derived from `TRUST_PROXY_AUTH` | Selects the only authentication implementation the API will accept |
| `REQUIRE_AUTH` | Require a trusted identity for API routes | `true` | Recommended in production | `false` | Must be `true` for protected reverse-proxy operation |
| `TRUST_PROXY_AUTH` | Legacy trusted-proxy switch and header-trust flag | `true` | Required with `AUTH_MODE=trusted-proxy` | `false` | Only valid for trusted-proxy auth; never enable when clients can directly reach the app |
| `AUTH_LOGOUT_URL` | Optional browser logout path shown in the app shell | `/oauth2/sign_out` | Optional with external auth | None | Keep same-origin or reviewed by the operator |
| `OIDC_ISSUER_URL` | Native OIDC issuer URL | `https://idp.example.net/realms/family` | Required for `AUTH_MODE=native-oidc` | None | Must match the provider issuer exactly |
| `OIDC_CLIENT_ID` | Native OIDC client ID | `betreuungskalender` | Required for `AUTH_MODE=native-oidc` | None | Register the exact redirect URI with this client |
| `OIDC_CLIENT_SECRET` | Native OIDC client secret | Secret value | Required for confidential native OIDC clients | None | Secret; keep only in private environment files |
| `OIDC_REDIRECT_URI` | Native OIDC callback URI | `https://betreuung.example.net/auth/callback` | Required for `AUTH_MODE=native-oidc` | None | Must be same-origin and pre-registered at the provider |
| `OIDC_POST_LOGOUT_REDIRECT_URI` | Native OIDC post-logout URI | `https://betreuung.example.net/` | Optional for `AUTH_MODE=native-oidc` | App origin derived from `OIDC_REDIRECT_URI` | Must be pre-registered as a valid post-logout redirect URI in Keycloak |
| `OIDC_SCOPES` | Native OIDC scopes requested at login | `openid email profile` | Optional for `AUTH_MODE=native-oidc` | `openid email profile` | Keep minimal; add only the provider scopes required to emit configured claims |
| `OIDC_GROUPS_CLAIM` | Native OIDC claim containing group or role values | `groups` | Recommended for `AUTH_MODE=native-oidc` | `groups` | Used for server-side native authorization |
| `OIDC_LOGIN_STATE_TTL_SECONDS` | Native OIDC login transaction lifetime | `600` | Optional for `AUTH_MODE=native-oidc` | `600` | Short-lived state, nonce, and PKCE verifier records limit replay windows |
| `SESSION_COOKIE_NAME` | Native OIDC opaque session cookie name | `betreuungskalender_session` | Optional for `AUTH_MODE=native-oidc` | `betreuungskalender_session` | Cookie value is opaque and never stores claims or tokens |
| `SESSION_TTL_SECONDS` | Native OIDC server-side session lifetime | `2419200` | Optional for `AUTH_MODE=native-oidc` | `2419200` | Limits how long an unreused opaque session can remain valid |
| `OIDC_USER_ID_HEADER` | Trusted header containing the stable OIDC subject or user ID | `x-auth-request-user` | Recommended with OIDC | `x-auth-request-user` | Must be stable across email/name changes |
| `OIDC_EMAIL_HEADER` | Trusted header containing the OIDC email claim | `x-auth-request-email` | Optional with OIDC | `x-auth-request-email` | Stored on the internal user record when present |
| `OIDC_DISPLAY_NAME_HEADER` | Trusted header containing the OIDC display-name claim | `x-auth-request-preferred-username` | Optional with OIDC | `x-auth-request-preferred-username` | Shown compactly in the app shell |
| `OIDC_GROUPS_HEADER` | Trusted header containing group or role claims | `x-forwarded-groups` | Recommended with OIDC | `x-auth-request-groups` | Used for server-side authorization |
| `OIDC_ADMIN_GROUP` | Group that grants read, write, and administrative permissions | `/betreuungskalender/admins` | Recommended with OIDC | Same | Required for imports, destructive app-data operations, and migration endpoints |
| `OIDC_PARENT_GROUP` | Group that grants normal read and write permissions | `/betreuungskalender/parents` | Recommended with OIDC | Same | Allows ordinary app data editing |
| `OIDC_READONLY_GROUP` | Group that grants read-only access | `/betreuungskalender/readers` | Optional with OIDC | Same | Allows viewing/export reads but blocks writes |
| `OIDC_REQUIRE_ROLE_CLAIM` | Reject users without a matching configured group | `true` | Recommended after rollout | `false` for local/trusted-proxy, `true` for native OIDC | `false` preserves existing single-user proxy deployments during migration; native OIDC fails closed by default |
| `ALLOWED_ORIGIN` | Single permitted browser origin for CORS | `https://betreuung.example.net` | Recommended | `http://localhost:5173` | Prevents cross-origin browser API use |
| `LOG_LEVEL` | Fastify/Pino log level | `info` | Optional | `info` in production, `debug` otherwise | Avoid `debug` in production unless investigating |
| `RATE_LIMIT_MAX` | Maximum API requests per client and time window | `120` | Optional | `120` | Baseline protection for every API route, including health and readiness |
| `RATE_LIMIT_WRITE_MAX` | Maximum write requests per client and time window | `20` | Optional | `20` | Restricts POST, PUT, PATCH, and DELETE operations |
| `RATE_LIMIT_SENSITIVE_MAX` | Maximum import and migration requests per client and time window | `5` | Optional | `5` | Protects expensive or state-replacing operations |
| `RATE_LIMIT_EXPORT_MAX` | Maximum export requests per client and time window | `15` | Optional | `15` | Restricts potentially expensive export generation |
| `RATE_LIMIT_WINDOW_MS` | Shared rate-limit window in milliseconds | `60000` | Optional | `60000` | Keep a bounded window; values must be positive integers |
| `DEMO_DATASETS_ENABLED` | Enable admin-only synthetic demo dataset loaders | `true` on demo only | Optional for demo/staging | `false` | Never enable on production; loading a dataset replaces domain data |
| `BACKUP_RETENTION_DAYS` | Remove generated SQLite backups older than this | `14` | Optional | `14` | Set `0` to disable automatic age pruning |
| `HEALTHCHECK_URL` | URL used by `npm run healthcheck` | `http://127.0.0.1:3000/api/health` | Optional | Same | Use an internal URL; no credentials are required |

`DATABASE_PATH` and `BACKUP_DIR` are operator-editable for direct Node.js or
systemd deployments. The release `deploy/compose.yml` intentionally fixes those
paths inside the container as `/data/app.sqlite` and `/backups`; configure the
host-side persistence with the `./data:/data` and `./backups:/backups` bind
mounts instead.

`deploy/compose.oidc.yml` uses the same fixed container paths. In that mode,
`HOST_BIND_ADDRESS` and `HOST_PORT` publish oauth2-proxy only; the app service
uses `expose: 3000` and does not publish a host port.

The root `.env.example` is intentionally direct-compose safe and keeps
`TRUST_PROXY_AUTH=false`. Use `deploy/.env.oidc.example` for the OIDC Compose
topology where oauth2-proxy is the only service with a host port.

In the release OIDC Compose topology, oauth2-proxy forwards group claims to the
app upstream as `X-Forwarded-Groups`; set
`OIDC_GROUPS_HEADER=x-forwarded-groups` and verify `/api/session` reports the
expected role before enabling `OIDC_REQUIRE_ROLE_CLAIM=true`.

## Authentication modes

`AUTH_MODE` accepts `local`, `trusted-proxy`, or `native-oidc`. It is the
authoritative authentication mode: the API only accepts credentials from the
selected mode. When `AUTH_MODE` is not set, the app preserves the existing
behavior and derives the mode from `TRUST_PROXY_AUTH`: `trusted-proxy` when
trusted proxy auth is enabled, otherwise `local`.

`TRUST_PROXY_AUTH=true` is only valid with `AUTH_MODE=trusted-proxy`. Do not
leave it enabled while testing `AUTH_MODE=native-oidc`; native mode must not
accept proxy identity headers as an authentication bypass.

### Local development

```dotenv
AUTH_MODE=local
REQUIRE_AUTH=false
TRUST_PROXY_AUTH=false
```

Audit records created through the API use `local-dev` as identity. Production
starts that intentionally run without authentication must set `AUTH_MODE=local`
explicitly; the default production examples keep `REQUIRE_AUTH=true` so an
accidental direct deployment fails closed.

### Trusted reverse proxy

```dotenv
AUTH_MODE=trusted-proxy
REQUIRE_AUTH=true
TRUST_PROXY_AUTH=true
```

The app accepts the first non-empty value from:

- `X-Auth-Request-Email`
- `X-Forwarded-Email`
- `X-Auth-Request-User`
- `X-Forwarded-User`

These headers are authentication assertions, not user input. Direct client
access to the app must be blocked by binding to loopback, container networking,
or firewall policy.

When trusted identity headers are available, the app maps the stable subject
from `OIDC_USER_ID_HEADER` to an internal `app_users` row. Display name, email,
and groups are refreshed on every API request. API audit fields use the stable
internal user ID rather than mutable names or email addresses.

Authorization is enforced on the server:

- admin: read, write, app-data restore/clear, and legacy migration endpoints
- parent: read and ordinary write operations
- readonly: read-only API access

When `OIDC_REQUIRE_ROLE_CLAIM=false`, an authenticated proxy user without a
matching configured group receives `parent` permissions for compatibility with
existing single-user deployments. Set it to `true` after the identity provider
emits the expected group claim.

`/api/session` returns compact session metadata for the app shell. The UI shows
a short display name and, when `AUTH_LOGOUT_URL` is configured, a logout link.
With oauth2-proxy this is usually `/oauth2/sign_out`.

The release OIDC Compose mode enforces the intended boundary by publishing only
oauth2-proxy. Do not add an app `ports:` mapping while `TRUST_PROXY_AUTH=true`.

### Native OIDC

`AUTH_MODE=native-oidc` is the target architecture for the v1.4 workstream. It
validates Authorization Code + PKCE callbacks with `openid-client`, stores
short-lived server-side login state, and creates server-side sessions with an
opaque browser cookie. The browser cookie contains only a random session token;
SQLite stores only the token hash plus session metadata.

Native mode requires `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, and
`OIDC_REDIRECT_URI` at startup. In production it also requires
`REQUIRE_AUTH=true`. Keep `TRUST_PROXY_AUTH=false`; trusted proxy headers are
ignored by native mode and conflicting configuration is rejected.

Native OIDC callback handling must not expose ID tokens, access tokens,
refresh tokens, authorization codes, state, nonce, PKCE verifiers, raw claims,
client secrets, or session identifiers to frontend JavaScript or logs.

Native OIDC maps the stable `sub` claim to `app_users.external_subject`.
`OIDC_GROUPS_CLAIM` selects the claim used for authorization and defaults to
`groups`. Values may be emitted as an array or as comma, semicolon, or
newline-separated strings. The same `OIDC_ADMIN_GROUP`, `OIDC_PARENT_GROUP`,
and `OIDC_READONLY_GROUP` settings are used in trusted-proxy and native mode.
When no configured group matches, native OIDC rejects the callback with `403`
by default and does not create a browser session.

In native mode, unauthenticated `/api/session` responses include
`loginUrl: "/auth/login"`. Authenticated native sessions include
`logoutUrl: "/auth/logout"`, which the frontend calls with `POST`. The route
revokes the app session, clears the app cookie, and returns a Keycloak
end-session redirect URL so the browser can also end the upstream SSO session.

For a fresh Keycloak and Podman Compose installation, follow
[native-oidc-keycloak-podman.md](native-oidc-keycloak-podman.md). Native OIDC
uses `deploy/compose.yml`; `deploy/compose.oidc.yml` remains the oauth2-proxy
trusted-header topology.

## CORS and same-origin operation

Production should normally serve frontend and API from the same origin.
`ALLOWED_ORIGIN` must exactly match the public scheme, host, and optional port.
Requests without an `Origin` header, such as internal healthchecks, are allowed.

## Rate limiting

The Fastify runtime applies an in-memory rate limit to every `/api/` route by
client IP address. The proxy setting controls whether Fastify derives that IP
from trusted forwarding headers. Import, migration, export routes, and
personal calendar feed reads have stricter limits than ordinary API reads,
while every write route has a lower limit than the default. Exceeding a limit
returns HTTP `429` with standard rate-limit and retry headers plus a
non-sensitive JSON error.

The default store is process-local. For a horizontally scaled deployment, use
a shared rate-limit store as part of a separately reviewed deployment change.
