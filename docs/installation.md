# Installation

## Requirements

- Node.js 24.15 or newer in the supported LTS line
- npm 12 or newer
- Build tools required by `better-sqlite3` if a prebuilt binary is unavailable
- A writable directory for SQLite and backups, or a supported PostgreSQL 16-18
  database with a mounted password file

## Development

```bash
git clone https://github.com/example/betreuungskalender.git
cd betreuungskalender
npm ci
cp .env.example .env
```

Use development-safe values in `.env`:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
DATABASE_PATH=./data/app.sqlite
BACKUP_DIR=./backups
AUTH_MODE=local
REQUIRE_AUTH=false
TRUST_PROXY_AUTH=false
ALLOWED_ORIGIN=http://localhost:5173
LOG_LEVEL=debug
```

Start frontend and API:

```bash
npm run dev
```

The Vite frontend is available at `http://localhost:5173`; `/api` is proxied to
the Fastify server on `http://127.0.0.1:3000`.

## Production build

```bash
npm ci
npm run lint
npm run test
npm run build
NODE_ENV=production npm run start
```

The production Fastify process serves both `dist/` and `/api` on `PORT`.
Migrations run automatically before the listener starts.

## First-use setup

Fresh self-hosted installations are detected from the selected server-side
database state.
Native OIDC uses the one-time owner setup link before the app guides the initial
owner through setup, child and care-party defaults, and calendar/feed discovery.
Trusted-proxy and local installations use their documented first-use path.
Member administration and invitations are handled inside Settings after setup.

Read the complete setup and member-administration guide:
[self-hosted-onboarding.md](self-hosted-onboarding.md).

## Important storage distinction

The selected server-side database is the single persistence surface for current
domain data. The React UI uses the API for every domain read and write; browser
local storage is limited to UI preferences. SQLite uses `npm run backup` plus
`npm run restore:check`. PostgreSQL requires an operator-managed logical backup
and tested restore. The portable JSON transfer can move domain data between
backends but does not replace either operational backup. See
[database backends](database-backends.md).
