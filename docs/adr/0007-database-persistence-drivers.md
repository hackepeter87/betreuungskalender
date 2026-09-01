# ADR 0007: Database persistence drivers

## Status

Accepted for staged implementation.

## Context

The application currently uses one synchronous `better-sqlite3` connection.
Routes and services prepare SQL statements directly, migrations contain SQLite
dialect features, and backup and readiness behavior assume a local database
file. Replacing only the connection object would hide incompatible execution,
transaction, migration, and error semantics instead of providing a reliable
database choice.

SQLite must remain the zero-configuration default. An optional PostgreSQL
backend should use the same domain rules and public API without implying that
multiple application replicas are safe. Rate limiting and scheduled work remain
process-local and therefore retain the existing single-replica boundary.

## Decision

### Persistence boundary

- Introduce one asynchronous, typed persistence runtime used by application
  services, startup, readiness, migrations, and shutdown.
- Use a typed SQL layer with SQLite and PostgreSQL dialect adapters. Driver
  selection and connection details remain inside the persistence package.
- Inject the runtime or an active transaction into services. Routes and domain
  services must not import a global driver connection.
- Keep transaction ownership explicit. A unit of work receives one transaction
  context and cannot silently open a second connection or commit partial work.
- Map driver errors to stable application error categories. SQLite or PostgreSQL
  error codes are not part of route behavior or public responses.
- Preserve canonical application types at the boundary: IDs remain strings,
  timestamps leave the server as ISO-8601 UTC values, and nullable and Boolean
  values have identical API behavior on both drivers.

### Driver and migration contract

- `sqlite` remains the default driver and continues to use `DATABASE_PATH`, WAL,
  foreign keys, the configured busy timeout, and the existing native backup.
- PostgreSQL is added only after the SQLite implementation passes the common
  persistence contract. Selecting PostgreSQL is always explicit.
- Existing released SQLite migrations remain immutable in
  `server/migrations/`. PostgreSQL receives a separate dialect-specific
  migration set with matching version identifiers.
- Every future schema change must provide both dialect migrations in the same
  pull request. Release validation rejects missing versions or changed released
  migrations.
- Migrations run before readiness. PostgreSQL migration execution is
  transaction-bound and serialized with an advisory lock; the application role
  owns only its installation database and does not require superuser access.
- Health and readiness report only abstract availability and migration state.
  Connection strings, hostnames, credentials, SQL, and driver error details are
  not returned or logged.

### Deployment and data movement

- One application replica with the `Recreate` strategy remains the supported
  contract for both drivers. PostgreSQL support does not by itself introduce
  horizontal scaling.
- The default Compose and Helm configurations remain SQLite-based. PostgreSQL
  deployment options are opt-in and must consume credentials from files or
  existing secrets.
- Existing installations change drivers through portable export, dry run, and
  atomic import. Direct database-file conversion, dual writes, and automatic
  identity mapping are not supported.
- SQLite native backups remain SQLite-specific. PostgreSQL uses a documented
  logical backup and tested restore procedure. Portable domain exports do not
  replace an operational database backup.
- An embedded PostgreSQL Helm workload is evaluation-only. External PostgreSQL
  is the supported operational form of that driver.

## Delivery sequence

1. `v1.27.0` introduces the persistence boundary and converts the complete
   application while retaining SQLite-only runtime behavior.
2. `v1.28.0` adds PostgreSQL migrations, the PostgreSQL adapter, cross-driver
   contract tests, and opt-in Compose and Helm deployment paths.
3. Horizontal application scaling requires a separate decision covering a
   shared rate-limit store, exclusive scheduled-work execution, rolling
   migrations, and load testing.

The staged delivery prevents a partially converted application from presenting
PostgreSQL as supported and keeps each release independently reversible at its
documented backup boundary.

## Verification contract

The common persistence suite must run the same scenarios against every driver:

- fresh migration and current migration-version reporting;
- reads, writes, constraints, soft deletion, ordering, and pagination;
- successful transactions and complete rollback after a failed write;
- setup, authentication, membership, invitation, calendar, reporting, audit,
  feed, and portable-transfer behavior;
- startup failure, readiness failure, migration serialization, and redacted
  error logging.

SQLite compatibility additionally requires restoring and upgrading a database
created by the last release before the refactor. PostgreSQL acceptance requires
round-trip portable transfers between both drivers and container and Helm smoke
tests.

## Consequences

- The server persistence API becomes asynchronous even though the SQLite driver
  remains synchronous internally.
- The refactor touches most server services and must be delivered in reviewed
  slices with parity tests before PostgreSQL is introduced.
- Maintaining two SQL dialects increases migration and release work but keeps
  driver-specific behavior visible and testable.
- SQLite installations receive no new required configuration or deployment
  dependency.
- PostgreSQL enables a different storage topology but does not change the
  application's process-level scaling guarantee.

## Relationship to ADR 0006

[ADR 0006](0006-kubernetes-helm-deployment.md) remains the operative deployment
decision for released SQLite versions. This ADR qualifies it by defining the
future optional PostgreSQL path while preserving its single-replica and secret
management requirements. ADR 0006 is not superseded until a released and
validated PostgreSQL deployment contract explicitly updates it.
