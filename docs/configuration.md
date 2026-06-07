# Configuration

Configuration is read from environment variables. `dotenv` loads a local
`.env` file when present. Never commit production `.env` files.

| Variable | Purpose | Example | Required | Default | Security relevance |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | Runtime mode and production error handling | `production` | Recommended | `development` | Production hides internal error details |
| `HOST` | Listener address | `127.0.0.1` | Optional | `127.0.0.1` | Use loopback when a local proxy is in front |
| `PORT` | HTTP port | `3000` | Optional | `3000` | Expose only through the intended firewall/proxy |
| `DATABASE_PATH` | SQLite database file | `/var/lib/betreuungskalender/app.sqlite` | Recommended | `./data/app.sqlite` | Contains sensitive API data; protect permissions and disk |
| `BACKUP_DIR` | Destination for SQLite backups | `/var/backups/betreuungskalender` | Recommended | `./backups` | Contains sensitive copies; use mode `0700` |
| `REQUIRE_AUTH` | Require a trusted identity for API routes | `true` | Recommended in production | `false` | Must be `true` for protected reverse-proxy operation |
| `TRUST_PROXY_AUTH` | Trust supported identity headers and proxy addresses | `true` | Required with external auth | `false` | Never enable when clients can directly reach the app |
| `ALLOWED_ORIGIN` | Single permitted browser origin for CORS | `https://betreuung.example.net` | Recommended | `http://localhost:5173` | Prevents cross-origin browser API use |
| `LOG_LEVEL` | Fastify/Pino log level | `info` | Optional | `info` in production, `debug` otherwise | Avoid `debug` in production unless investigating |
| `BACKUP_RETENTION_DAYS` | Remove generated SQLite backups older than this | `14` | Optional | `14` | Set `0` to disable automatic age pruning |
| `HEALTHCHECK_URL` | URL used by `npm run healthcheck` | `http://127.0.0.1:3000/api/health` | Optional | Same | Use an internal URL; no credentials are required |

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

## CORS and same-origin operation

Production should normally serve frontend and API from the same origin.
`ALLOWED_ORIGIN` must exactly match the public scheme, host, and optional port.
Requests without an `Origin` header, such as internal healthchecks, are allowed.
