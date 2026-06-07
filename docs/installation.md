# Installation

## Requirements

- Node.js 22 LTS or a newer supported LTS release
- npm
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

## Important storage distinction

The current React UI stores its working data in browser local storage. The
SQLite API is a separate persistence surface and is not automatically
synchronized with that browser data. Back up browser data with the JSON export,
and back up API data with `npm run backup`.
