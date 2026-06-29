# Configuration

Configuration is read from environment variables. `dotenv` loads a local
`.env` file when present. Never commit production `.env` files.

| Variable | Purpose | Example | Required | Default | Security relevance |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | Runtime mode and production error handling | `production` | Recommended | `development` | Production hides internal error details |
| `HOST` | Listener address | `127.0.0.1` | Optional | `127.0.0.1` | Use loopback when a local proxy is in front |
| `PORT` | HTTP port | `3000` | Optional | `3000` | Expose only through the intended firewall/proxy |
| `APP_RELEASE_VERSION` | Release Compose image tag | `1.0.0` | Required for `deploy/compose.yml` | None | Must match the extracted release package version |
| `APP_RELEASE_DIR` | Release Compose build context | `/opt/svc_betreuung/betreuungskalender/releases/v1.0.0` | Required for `deploy/compose.yml` | None | Must point at the verified extracted release directory |
| `APP_COMPOSE_FILE` | Compose file managed by the update tool | `compose.oidc.yml` | Required only when not using `compose.yml` | `compose.yml` | Must be `compose.yml` or `compose.oidc.yml` |
| `OAUTH2_PROXY_IMAGE` | oauth2-proxy image used by `deploy/compose.oidc.yml` | `quay.io/oauth2-proxy/oauth2-proxy:v7.15.3` | Optional for OIDC Compose | Same | Pin and review oauth2-proxy updates like other runtime dependencies |
| `HOST_BIND_ADDRESS` | Host address published by release Compose | `127.0.0.1` | Recommended for `deploy/compose.yml` | `127.0.0.1` | Use loopback only when the reverse proxy is on the same host |
| `HOST_PORT` | Host port published by release Compose | `3000` | Recommended for `deploy/compose.yml` | `3000` | Expose only through the intended firewall/proxy |
| `DATABASE_PATH` | SQLite database file | `/var/lib/betreuungskalender/app.sqlite` | Recommended | `./data/app.sqlite` | Contains sensitive API data; protect permissions and disk |
| `BACKUP_DIR` | Destination for SQLite backups | `/var/backups/betreuungskalender` | Recommended | `./backups` | Contains sensitive copies; use mode `0700` |
| `REQUIRE_AUTH` | Require a trusted identity for API routes | `true` | Recommended in production | `false` | Must be `true` for protected reverse-proxy operation |
| `TRUST_PROXY_AUTH` | Trust supported identity headers and proxy addresses | `true` | Required with external auth | `false` | Never enable when clients can directly reach the app |
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
