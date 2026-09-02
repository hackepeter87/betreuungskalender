# ADR 0007: Database persistence drivers

## Status

Accepted for staged implementation.

## Context

The server currently shares one synchronous `better-sqlite3` connection.
Routes and services prepare SQL directly, migrations contain SQLite-specific
SQL, and backup and readiness behavior assume a local database file. Replacing
only that connection would hide incompatible transaction, migration and error
semantics instead of creating a dependable driver boundary.

SQLite must remain the zero-configuration default. A later optional PostgreSQL
driver must use the same domain rules and HTTP API without implying that several
application replicas are safe. Rate limiting and scheduled work remain local to
one process, so the existing single-replica boundary continues to apply.

## Decision

### Persistence boundary

- Introduce one asynchronous `PersistenceRuntime` for startup, migrations,
  readiness, transactions and shutdown.
- Use Kysely as the typed SQL layer. A complete `DatabaseSchema` describes the
  application tables; an empty or untyped schema is not an accepted endpoint of
  the migration.
- Define `DatabaseExecutor` as either the runtime query context or an active
  transaction. Services receive an executor explicitly and do not import a
  global driver connection.
- Keep transaction ownership explicit. A unit of work receives its transaction
  context and cannot silently open another connection or commit partial work.
- Keep driver selection, connection details and driver-specific operations in
  the persistence package. Raw SQL outside migrations and adapter-specific code
  is limited to reviewed complex queries with parity coverage.
- Map driver failures to stable application categories such as constraint
  violation, database unavailable and generic database error. Driver codes,
  SQL, connection details and credentials are not public API or log fields.
- Preserve canonical application values at the boundary: IDs remain strings,
  timestamps remain ISO-8601 UTC strings, and nullable and Boolean values keep
  identical API behavior.

### SQLite contract for v1.27.0

- `sqlite` remains the only released driver and continues to use
  `DATABASE_PATH`, WAL, foreign keys, the current busy timeout and the native
  SQLite backup mechanism.
- The migration may use a deprecated compatibility bridge while services are
  converted in reviewed slices. The bridge must be removed before the v1.27.0
  parity gate.
- Existing SQLite migrations in `server/migrations/` remain immutable. Release
  validation records and checks their ordered SHA-256 fingerprints.
- v1.27.0 does not change the application schema and therefore adds no database
  migration.
- Startup runs migrations before readiness. Health and readiness expose only
  abstract availability and migration state.

### Future driver and migration contract

- PostgreSQL is added only after the complete SQLite implementation passes the
  common persistence contract. Selecting it will always be explicit.
- PostgreSQL receives a separate dialect-specific migration set with the same
  version identifiers. Future schema changes must provide migrations for every
  supported driver in the same pull request.
- PostgreSQL migration execution must be transactional and serialized. The
  application role owns only its installation database and does not require
  superuser access.
- Driver changes use portable export, mandatory dry run and atomic import.
  Direct file conversion, dual writes and automatic identity mapping are not
  supported.
- SQLite native backups remain SQLite-specific. PostgreSQL requires a documented
  logical backup and tested restore process; portable exports do not replace an
  operational backup.

### Deployment boundary

- One application replica with the `Recreate` strategy remains supported for
  every driver until a separate scaling decision covers shared rate limiting,
  exclusive scheduled work, rolling migrations and load testing.
- Compose and Helm continue to default to SQLite. v1.27.0 adds no environment
  variable, secret, container, chart value or deployment mode.
- A future embedded PostgreSQL Helm workload is evaluation-only. External
  PostgreSQL is the intended operational form of that optional driver.

## Delivery sequence

1. v1.27.0 introduces the persistence boundary and converts the complete server
   while retaining SQLite-only runtime behavior.
2. v1.28.0 adds PostgreSQL migrations, the PostgreSQL adapter, cross-driver
   contract tests and opt-in deployment paths.
3. Horizontal scaling requires a separate architecture decision.

## Verification contract

The common persistence suite covers:

- fresh migrations and migration-version reporting;
- reads, writes, constraints, soft deletion, ordering and pagination;
- successful transactions and complete rollback after a failed write;
- setup, authentication, membership, invitations, calendar behavior, reports,
  audit history, feeds, backups and portable transfers;
- startup failure, readiness failure and redacted error logging.

SQLite compatibility additionally requires generating a database at the last
released migration level with fictional data, opening it with v1.27.0 and
comparing domain snapshots. Because v1.27.0 changes no schema, an isolated copy
must also remain readable by v1.26.1 after the compatibility run.

## Consequences

- Server persistence APIs become asynchronous even though SQLite executes
  synchronously inside its adapter.
- The refactor touches most server services and must be delivered in reviewed
  slices with parity tests before PostgreSQL is introduced.
- Maintaining multiple SQL dialects later increases migration and release work,
  but keeps driver-specific behavior visible and testable.
- SQLite installations receive no new required configuration, schema change or
  deployment dependency.
- PostgreSQL will provide another storage topology, not automatic horizontal
  application scaling.

## Relationship to ADR 0006

[ADR 0006](0006-kubernetes-helm-deployment.md) remains the operative deployment
decision for v1.27.0. This ADR defines a future optional storage boundary while
preserving ADR 0006's single-replica and secret-management requirements.
