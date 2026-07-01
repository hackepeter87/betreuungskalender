# Betreuungskalender

Betreuungskalender is a self-hosted React/TypeScript application for neutral,
traceable documentation of planned and actual childcare periods, related
travel, costs, holidays, and unavailable periods.

> **Status:** Stable self-hosted release. The application is intended for
> private documentation. It does not provide legal advice, create an official
> record, or guarantee that generated material will be accepted by a court,
> authority, lawyer, or other recipient.

## Project status

- Latest release: [v1.3.0](docs/release-notes/v1.3.0.md)
- Current `main`: SQLite/API domain persistence, language packs, external
  read-only calendar overlays, trusted OIDC claim authorization,
  multi-parent audit metadata, personal calendar feeds, responsive mobile
  support, backup/restore tooling, release archives, and GHCR release images
- Roadmap and work tracking: [GitHub milestones and issues](https://github.com/hackepeter87/betreuungskalender/milestones)
- Stability target: stable self-hosted release line with roadmap work tracked in
  GitHub milestones

## Screenshot

![Betreuungskalender dashboard with fictional demo data](docs/assets/screenshots/dashboard-desktop.png)

Example dashboard using fictional demonstration data. No real personal data is
included in repository screenshots.

[Features](#features) · [Development](#development-quick-start) ·
[Container](#container-quick-start) · [Image Promotion](docs/image-promotion.md) · [Updates](docs/update.md) · [systemd/LXC](#lxcsystemd-quick-start) ·
[Configuration](docs/configuration.md) · [Security](docs/security.md) ·
[Backup](docs/backup-restore.md) · [Legacy migration](docs/migration.md) ·
[Calendar feed](docs/personal-calendar-feed.md) ·
[Testing](docs/testing.md) ·
[Internationalization](docs/internationalization.md)

## Features

- Children, planned/completed/cancelled care entries, factual cancellation
  reasons, overnight stays, handovers, locations, notes, and evidence references
- Mobile agenda, tablet/desktop calendar, responsive forms, PWA manifest, and
  touch-friendly help for all input fields
- Configurable biweekly Friday-to-Sunday target schedule and
  planned-versus-actual analysis
- Additional care, holiday blocks and allocation, and actual holiday statistics
- Duty-related and other unavailable periods with overlap notices
- Multiple trips and costs per care entry with period statistics
- Monthly closure, data-quality checks, soft delete, and field-level audit log
- JSON backup/import, separate CSV exports, neutral PDF report, and A4 print view
- Local `.ics` holiday calendar import with source visibility and read-only
  overlays; imported events do not affect care statistics or reports
- Revocable personal iCalendar subscription feed for care entries created by
  the signed-in user
- Fastify API with SQLite, migrations, validation, auth-proxy support, health
  endpoints, and production security headers

The application documents user-entered facts and does not evaluate another
person's conduct.

## Architecture and data storage

```text
React + TypeScript + Vite
        |
        +-- Fastify API
                |
                +-- SQLite (domain source of truth)
```

The browser UI loads and stores children, care entries, holidays, contact
patterns, trips, costs, unavailable periods, settings, monthly closings, and
audit records exclusively through the API in SQLite. `localStorage` is not
used for current domain persistence. When the API is unavailable, the
application displays a server error and blocks write actions.

Existing data from older browser-only versions is read solely as a legacy
migration source. The [migration assistant](docs/migration.md) previews the
data, identifies potential duplicates and conflicts, and imports it
transactionally into SQLite.

There is no cloud synchronization, analytics, or external tracking.

## Development quick start

Requirements: Node.js 22 LTS, npm, and a build environment supported by
`better-sqlite3`.

```bash
npm ci
cp .env.example .env
```

Change `.env` for local development:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
DATABASE_PATH=./data/app.sqlite
BACKUP_DIR=./backups
REQUIRE_AUTH=false
TRUST_PROXY_AUTH=false
ALLOWED_ORIGIN=http://localhost:5173
LOG_LEVEL=debug
```

Then start:

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- API: `http://127.0.0.1:3000`
- Health: `http://127.0.0.1:3000/api/health`

Full instructions: [docs/installation.md](docs/installation.md)

## Production build

```bash
npm ci
npm run lint
npm run test
npm run build
NODE_ENV=production npm run start
```

`npm run start` serves the built frontend and `/api` from one Fastify process.
Migrations run at startup.

## Container quick start

```bash
docker compose build
docker compose up -d
curl --fail http://127.0.0.1:3000/api/health
```

The included Compose configuration binds only to loopback, uses persistent
named volumes for `/data` and `/backups`, and starts without authentication for
local evaluation. Enable external authentication before any network exposure.
Published releases also provide a GHCR runtime image; use the release digest
asset when deploying by image instead of rebuilding from the release archive.

Docker and rootless Podman instructions:
[docs/deployment-container.md](docs/deployment-container.md)

## LXC/systemd quick start

Recommended paths:

- Application: `/opt/betreuungskalender`
- SQLite: `/var/lib/betreuungskalender/app.sqlite`
- Backups: `/var/backups/betreuungskalender`
- Configuration: `/etc/betreuungskalender/.env`

After installing and building as the dedicated `betreuung` account:

```bash
sudo cp docs/systemd/betreuungskalender.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now betreuungskalender
curl --fail http://127.0.0.1:3000/api/health
```

Complete guide: [docs/deployment-lxc.md](docs/deployment-lxc.md)

## Configuration

All settings are environment based. `.env.example` contains production-shaped
example values for the direct Compose/systemd path using `example.net` only. Use
`deploy/.env.oidc.example` instead for the oauth2-proxy/OIDC Compose topology.
For native OIDC without oauth2-proxy, keep the direct Compose path and set
`AUTH_MODE=native-oidc`.

Key variables:

| Variable | Typical production value |
| --- | --- |
| `DATABASE_PATH` | `/var/lib/betreuungskalender/app.sqlite` |
| `BACKUP_DIR` | `/var/backups/betreuungskalender` |
| `REQUIRE_AUTH` | `true` |
| `TRUST_PROXY_AUTH` | `false` for direct app exposure, `true` behind a trusted private proxy only |
| `ALLOWED_ORIGIN` | `https://betreuung.example.net` |
| `LOG_LEVEL` | `info` |
| `RATE_LIMIT_MAX` | `120` requests per client per minute |

Every variable, default, and security implication is documented in
[docs/configuration.md](docs/configuration.md).

## Authentication and reverse proxy

Local mode:

```dotenv
REQUIRE_AUTH=false
TRUST_PROXY_AUTH=false
```

Protected mode behind oauth2-proxy:

```dotenv
REQUIRE_AUTH=true
TRUST_PROXY_AUTH=true
AUTH_LOGOUT_URL=/oauth2/sign_out
OIDC_USER_ID_HEADER=x-auth-request-user
OIDC_EMAIL_HEADER=x-auth-request-email
OIDC_DISPLAY_NAME_HEADER=x-auth-request-preferred-username
OIDC_GROUPS_HEADER=x-forwarded-groups
OIDC_ADMIN_GROUP=/betreuungskalender/admins
OIDC_PARENT_GROUP=/betreuungskalender/parents
OIDC_READONLY_GROUP=/betreuungskalender/readers
OIDC_REQUIRE_ROLE_CLAIM=false
```

The API maps the trusted OIDC subject header to an internal user and derives
server-side permissions from configured group claims. Admin users may use
import, migration, and clear-data endpoints; parent users may read and write
ordinary app data; readonly users can only read. These headers can be forged if
users can reach the app directly, so the app port must be private or bound to
loopback. For the first live rollout, keep `OIDC_REQUIRE_ROLE_CLAIM=false` and
switch it to `true` only after Keycloak/oauth2-proxy group headers are
confirmed. When trusted identity is available, the app shell shows a compact
signed-in user indicator and a logout link if `AUTH_LOGOUT_URL` is configured.
Do not use `TRUST_PROXY_AUTH=true` with the direct `deploy/compose.yml` app
port unless another reviewed proxy boundary prevents all direct client access.

- HAProxy, nginx, Caddy, and Traefik:
  [docs/reverse-proxy.md](docs/reverse-proxy.md)
- Native OIDC with Keycloak and Podman:
  [docs/native-oidc-keycloak-podman.md](docs/native-oidc-keycloak-podman.md)
- Migration from oauth2-proxy to native OIDC:
  [docs/native-oidc-migration-rollback.md](docs/native-oidc-migration-rollback.md)
- Detailed Keycloak and oauth2-proxy setup:
  [docs/keycloak-oauth2-proxy.md](docs/keycloak-oauth2-proxy.md)

## Health and readiness

```bash
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/ready
npm run healthcheck
```

Health output includes status, application version, database reachability, and
timestamp. It does not expose database paths or secrets.

## Backup and restore

Create and verify an online-safe SQLite backup:

```bash
npm run backup
npm run restore:check
```

The script uses SQLite's backup API, stores restrictive files in `BACKUP_DIR`,
and removes backups older than `BACKUP_RETENTION_DAYS` (default 14). Keep
additional encrypted off-host generations.

The in-app JSON export contains the complete domain data loaded from SQLite and
can be restored transactionally through the API. A verified SQLite backup
remains the authoritative operational and disaster-recovery backup. CSV and
PDF files are reporting formats, not complete backups.

Restore procedure and testing:
[docs/backup-restore.md](docs/backup-restore.md)

## Updates

The supported self-hosted production path uses a checksummed release archive
and a Compose-first update tool. It checks preconditions, creates and verifies
a SQLite backup, switches only to a versioned release directory, verifies
health/readiness, version, migrations, and database integrity, and restores
both the prior runtime and matching backup when validation fails.

Run the documented `--dry-run` before every update and retain prior releases
and verified backups. Full bootstrap, lock handling, exit codes, manual
recovery, and direct Node.js fallback guidance:
[docs/update.md](docs/update.md).

## Mobile, iPhone, iPad, and PWA

- iPhone uses a compact agenda and safe-area-aware bottom navigation.
- iPad and desktop retain calendar and side navigation layouts.
- Forms use native date/time inputs and touch targets.
- Export actions are available on mobile; saving behavior depends on the iOS
  browser and Files/Share Sheet.
- The service worker provides an offline frontend shell. When the API is
  unavailable, the application switches to an explicit read-only mode:
  existing data can be viewed and exported, while create, update, delete,
  import, and monthly closing actions remain blocked.
- API requests are always network-only and are never served from the service
  worker cache.

## Exports and reports

- JSON: complete domain export/import of the SQLite-backed application data
- CSV: care entries, trips, costs, holidays, and unavailable periods
- PDF: neutral selected-period report with report ID, data state, statistics,
  daily list, notes, cancellation reasons, and optional audit history

Exports can contain sensitive personal data. Store them encrypted and never
attach them to public GitHub issues.

## Privacy and security

SQLite files, backups, exports, and reports may contain
sensitive family data. The operator is responsible for:

- TLS and authentication
- Host and dependency updates
- Firewall and reverse-proxy correctness
- Disk encryption and filesystem permissions
- Backup encryption, retention, restore tests, and deletion
- Restricting access to the application host and generated files

See [docs/security.md](docs/security.md) and [SECURITY.md](SECURITY.md).

## Legal and evidentiary limits

The app is a documentation aid, not an official record. Audit history, report
IDs, monthly closure, and backups improve internal traceability but do not
create a qualified signature, trusted timestamp, or tamper-proof archive.

Read the full [legal disclaimer](docs/legal-disclaimer.md).

## Release Check

Before a release, verify that the repository contains no local databases,
exports, backups, or secrets:

```bash
npm run release:check
npm run release:check:strict
```

The check blocks real artifacts such as `.sqlite`, `.db`, `.pdf`, `.csv`,
`.env`, and backup/export JSON files. Source and documentation files whose
names contain words such as `backup` or `export` remain allowed.

The strict command additionally requires a clean working tree, verifies
package, lockfile, changelog, release-note, and tag consistency, and runs build,
lint, and tests. A pushed `v*` tag also builds a checksummed runtime archive and
smoke-tests the container without publishing it. See the complete
[release workflow](docs/release.md).

## Project checks

```bash
npm run lint
npm run test
npm run build
npm run release:check
```

CI runs install, static checks, tests, and production build. A separate workflow
builds the container, starts it, and verifies the API health endpoint.

## Language packs

German is the default UI language. The app includes an initial English language
pack for the application shell, settings, reports, and PDF output. Remaining
screens fall back to German while they are migrated incrementally. Language is
a browser UI preference and does not change API or SQLite data.

See [docs/internationalization.md](docs/internationalization.md).

## License

Licensed under the [MIT License](LICENSE).

## Contributing and support

Read [CONTRIBUTING.md](CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before contributing.

Use GitHub Issues for bugs and feature requests. Never post real names,
addresses, schedules, court documents, screenshots with personal data,
backups, SQLite files, PDFs, CSVs, authentication tokens, or secrets.
