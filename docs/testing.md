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

For security-sensitive changes or release-adjacent review, run the bundled
local security baseline as well:

```bash
npm run security:check
```

It combines `npm audit --audit-level=high`,
`npm run test:security-runtime`, and `npm run release:check`.

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

The deterministic cross-page screenshot suite and its privacy rules are
documented in [Visual regression testing](visual-regression-testing.md).

The automated axe gate and the manual keyboard, VoiceOver, reflow, and touch
matrix are documented in [Accessibility testing](accessibility-testing.md).

## SQLite migration and parity gate

The standard unit-test command includes `server/sqliteParity.test.ts`. It
checks the SHA-256 manifest for every migration released through v1.26.1 and
opens a temporary synthetic database at that migration level with the current
persistence runtime. The test verifies data preservation, representative CRUD,
foreign-key enforcement, transaction rollback, integrity and migration
idempotency.

Run only this gate with:

```bash
npx tsx --test server/sqliteParity.test.ts
```

The fixture uses obviously fictional records and is deleted after the test.
Do not commit generated SQLite files or replace the fixture with exported
installation data. A new migration may be appended without changing existing
checksums; changing, removing or renaming a released migration fails the gate.

## Cross-driver application parity

CI runs the same application scenario against SQLite, PostgreSQL 16, and
PostgreSQL 18. The scenario covers first-use setup and membership boundaries,
invitations, recurring rules, conflicts, reports, audit pagination, personal
calendar feeds, notification preferences, soft deletion, constraints, and
transaction rollback. It also imports a complete portable transfer from
SQLite to PostgreSQL and from PostgreSQL to SQLite after a mandatory dry run.

The PostgreSQL jobs use an isolated service database and a temporary password
file. With equivalent local test variables, run the database adapter and
application parity suites together with:

```bash
npm run test:postgres-runtime
```

Without PostgreSQL test configuration, the standard `npm test` command still
runs the SQLite application scenario and skips only the PostgreSQL comparisons.
Fixtures are synthetic and neither database contents nor credentials may be
written to logs or committed artifacts.

## Demo edge-case dataset

Demo and staging environments can opt in to synthetic edge-case data with:

```bash
DEMO_DATASETS_ENABLED=true
```

When enabled, admin users can load the edge-case dataset from settings. The
dataset intentionally replaces the current domain data and contains only
fictional records that exercise month boundaries, recurring contact rules,
cancelled entries, additional care, costs, trips, external calendar overlays,
unavailability warnings, month closures, and audit log display. For v1.6.0 and
later, contact-rule regression checks should include non-14-day weekly rules,
monthly day rules, monthly ordinal weekday rules, multiple time spans, calendar
preview, automatic synchronization, and preserved single-occurrence
exceptions. Do not enable this option in production.

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

The optional PostgreSQL Compose path has a separate smoke test:

```bash
npm run build
npm run test:container-postgres-smoke
```

It starts an isolated SQLite source and PostgreSQL target, performs a portable
dry run and import, verifies rollback on a changed package, restarts both
containers, checks persistence, and exercises unavailable-database and invalid-
secret failures. PostgreSQL remains on an internal network without a published
host port. All generated credentials and transfer data stay in a temporary
directory and are removed after the run.

When Docker is unavailable locally, validate the script through code review and
run the remaining checks; GitHub-hosted CI executes the container smoke test.

## CI jobs

Pull requests run these relevant jobs:

- `Validation`: dependency audit, release check, lint, build, and unit tests.
- `End-to-end tests`: desktop, iPhone, and iPad Playwright coverage.
- `Runtime security and CORS`: isolated HTTP assertions.
- `PostgreSQL runtime`: PostgreSQL 16 and 18 migration, adapter, application,
  and bidirectional transfer parity.
- `Update and rollback workflow`: synthetic verified-update and rollback scenarios.
- `Container / validate`: Docker startup, restart, persistence, and cleanup.
- `Validate optional PostgreSQL Compose runtime`: opt-in Compose configuration,
  transfer, restart, persistence, failure handling, and cleanup.
