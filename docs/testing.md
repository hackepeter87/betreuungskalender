# Testing

## Standard validation

Run the usual local checks before opening a pull request:

```bash
npm ci
npm audit
npm run release:check
npm run lint
npm run build
npm test
npm run test:e2e
git diff --check
```

## Release smoke automation

Playwright covers desktop, iPhone, and iPad projects. The synthetic calendar
fixtures used by the native file-upload tests are in `e2e/fixtures/`. They are
minimal test data only and must never be replaced with real calendar files.

The external-calendar E2E test uses Playwright's `setInputFiles()` against the
real file input. It verifies import, grid and agenda overlays, read-only
behavior, visibility changes, replacement, deletion, and invalid-file
handling. The desktop export test waits for the JSON download in memory, parses
it, and checks that domain data, settings, external sources, and normalized
external events are present without raw ICS content or runtime secrets.

Generated Playwright reports, databases, and downloads remain in ignored test
output directories and must not be committed.

## Demo edge-case dataset

Demo and staging environments can opt in to synthetic edge-case data with:

```bash
DEMO_DATASETS_ENABLED=true
```

When enabled, admin users can load the edge-case dataset from settings. The
dataset intentionally replaces the current domain data and contains only
fictional records that exercise month boundaries, recurring contact rules,
cancelled entries, additional care, costs, trips, external calendar overlays,
unavailability warnings, month closures, and audit log display. Do not enable
this option in production.

## Runtime security and CORS

Run the production-style HTTP assertions locally with:

```bash
npm run test:security-runtime
```

The test starts the Fastify runtime with a temporary SQLite path and verifies
the documented health response, Helmet headers, allowed and disallowed origins,
preflight behavior, non-sensitive error responses, and central rate limits for
ordinary API reads, writes, migration/import routes, and exports. Temporary
directories and the runtime process are removed automatically.

## Update and rollback workflow

The update tests use a fully synthetic Compose command double and temporary
directories. They cover a previous-release upgrade, archive verification,
pre-update backup validation, failed startup and health verification, paired
runtime/database rollback, dry run behavior, and concurrent-update locks. They
never contact a release server, start Docker, or use real SQLite data.

```bash
npx tsx --test scripts/update.test.js
```

## Container smoke test

Docker is required for the container smoke test:

```bash
npm run test:container-smoke
```

The script builds the documented production image, uses an isolated temporary
volume, waits for `/api/health`, creates synthetic data, restarts the container,
checks persistence and migration idempotency, then stops and removes the
container, image, and volume. It does not publish ports or deploy anything.

When Docker is unavailable locally, validate the script through code review and
run the remaining checks; GitHub-hosted CI executes the container smoke test.

## CI jobs

Pull requests run these relevant jobs:

- `Validation`: dependency audit, release check, lint, build, and unit tests.
- `End-to-end tests`: desktop, iPhone, and iPad Playwright coverage.
- `Runtime security and CORS`: isolated HTTP assertions.
- `Update and rollback workflow`: synthetic verified-update and rollback scenarios.
- `Container / validate`: Docker startup, restart, persistence, and cleanup.
