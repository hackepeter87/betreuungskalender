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

## Runtime security and CORS

Run the production-style HTTP assertions locally with:

```bash
npm run test:security-runtime
```

The test starts the Fastify runtime with a temporary SQLite path and verifies
the documented health response, Helmet headers, allowed and disallowed origins,
preflight behavior, and non-sensitive error responses. Temporary directories
and the runtime process are removed automatically.

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
- `Container / validate`: Docker startup, restart, persistence, and cleanup.
