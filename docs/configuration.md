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
| `REQUIRE_AUTH` | Require a trusted identity for API routes | `true` | Recommended in production | `false` | Must be `true` for protected reverse-proxy operation |
| `TRUST_PROXY_AUTH` | Trust supported identity headers and proxy addresses | `true` | Required with external auth | `false` | Never enable when clients can directly reach the app |
| `AUTH_LOGOUT_URL` | Optional browser logout path shown in the app shell | `/oauth2/sign_out` | Optional with external auth | None | Keep same-origin or reviewed by the operator |
| `OIDC_USER_ID_HEADER` | Trusted header containing the stable OIDC subject or user ID | `x-auth-request-user` | Recommended with OIDC | `x-auth-request-user` | Must be stable across email/name changes |
| `OIDC_EMAIL_HEADER` | Trusted header containing the OIDC email claim | `x-auth-request-email` | Optional with OIDC | `x-auth-request-email` | Stored on the internal user record when present |
| `OIDC_DISPLAY_NAME_HEADER` | Trusted header containing the OIDC display-name claim | `x-auth-request-preferred-username` | Optional with OIDC | `x-auth-request-preferred-username` | Shown compactly in the app shell |
| `OIDC_GROUPS_HEADER` | Trusted header containing group or role claims | `x-forwarded-groups` | Recommended with OIDC | `x-auth-request-groups` | Used for server-side authorization |
| `OIDC_ADMIN_GROUP` | Group that grants read, write, and administrative permissions | `/betreuungskalender/admins` | Recommended with OIDC | Same | Required for imports, destructive app-data operations, and migration endpoints |
| `OIDC_PARENT_GROUP` | Group that grants normal read and write permissions | `/betreuungskalender/parents` | Recommended with OIDC | Same | Allows ordinary app data editing |
| `OIDC_READONLY_GROUP` | Group that grants read-only access | `/betreuungskalender/readers` | Optional with OIDC | Same | Allows viewing/export reads but blocks writes |
| `OIDC_REQUIRE_ROLE_CLAIM` | Reject users without a matching configured group | `true` | Recommended after rollout | `false` | `false` preserves existing single-user proxy deployments during migration |
| `ALLOWED_ORIGIN` | Single permitted browser origin for CORS | `https://betreuung.example.net` | Recommended | `http://localhost:5173` | Prevents cross-origin browser API use |
| `LOG_LEVEL` | Fastify/Pino log level | `info` | Optional | `info` in production, `debug` otherwise | Avoid `debug` in production unless investigating |
| `RATE_LIMIT_MAX` | Maximum API requests per client and time window | `120` | Optional | `120` | Baseline protection for every API route, including health and readiness |
| `RATE_LIMIT_WRITE_MAX` | Maximum write requests per client and time window | `20` | Optional | `20` | Restricts POST, PUT, PATCH, and DELETE operations |
| `RATE_LIMIT_SENSITIVE_MAX` | Maximum import and migration requests per client and time window | `5` | Optional | `5` | Protects expensive or state-replacing operations |
| `RATE_LIMIT_EXPORT_MAX` | Maximum export requests per client and time window | `15` | Optional | `15` | Restricts potentially expensive export generation |
| `RATE_LIMIT_WINDOW_MS` | Shared rate-limit window in milliseconds | `60000` | Optional | `60000` | Keep a bounded window; values must be positive integers |
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

### Local development

```dotenv
REQUIRE_AUTH=false
TRUST_PROXY_AUTH=false
```

Audit records created through the API use `local-dev` as identity.

### Trusted reverse proxy

```dotenv
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

## CORS and same-origin operation

Production should normally serve frontend and API from the same origin.
`ALLOWED_ORIGIN` must exactly match the public scheme, host, and optional port.
Requests without an `Origin` header, such as internal healthchecks, are allowed.

## Rate limiting

The Fastify runtime applies an in-memory rate limit to every `/api/` route by
client IP address. The proxy setting controls whether Fastify derives that IP
from trusted forwarding headers. Import, migration, and export routes have
stricter limits than ordinary API reads, while every write route has a lower
limit than the default. Exceeding a limit returns HTTP `429` with standard
rate-limit and retry headers plus a non-sensitive JSON error.

The default store is process-local. For a horizontally scaled deployment, use
a shared rate-limit store as part of a separately reviewed deployment change.
