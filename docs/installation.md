# Installation

## Requirements

- Node.js 24 LTS or a newer supported LTS release
- npm 11 or newer
- Build tools required by `better-sqlite3` if a prebuilt binary is unavailable
- A writable directory for SQLite and backups

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

Fresh self-hosted installations are detected from server-side SQLite state.
After the first successful sign-in, the app can guide the initial owner through
setup, child and care-party defaults, and calendar/feed discovery. Member
administration and invitations are handled inside Settings after setup.

Read the complete setup and member-administration guide:
[self-hosted-onboarding.md](self-hosted-onboarding.md).

## Important storage distinction

The SQLite API is the single persistence surface for current domain data. The
React UI uses the API for every domain read and write; browser local storage is
limited to UI preferences. Use the JSON export as a portable additional export,
and `npm run backup` plus `npm run restore:check` for the authoritative
operational backup.
