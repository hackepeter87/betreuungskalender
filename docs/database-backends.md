# Database backends

Betreuungskalender supports SQLite by default and PostgreSQL 16 through 18 as
an explicit alternative. Both backends implement the same application data
contract. Selecting PostgreSQL changes the storage topology; it does not add
horizontal application scaling, automatic failover, or database administration.

## Choose a backend

| Requirement | SQLite | PostgreSQL |
| --- | --- | --- |
| Initial configuration | None beyond a writable database path | Dedicated database, application role, password file, host and TLS settings |
| Application replicas | One | One |
| Schema migrations | Applied automatically at startup | Applied automatically and serialized at startup |
| Operational backup | Bundled SQLite backup and verification scripts | Operator-managed logical backup and tested restore |
| Portable transfer | Supported as source and target | Supported as source and target |

Use SQLite for a simple single-instance installation. Choose PostgreSQL when an
existing PostgreSQL operating model, storage policy, or database recovery
process makes it the better fit. Do not choose PostgreSQL solely to increase the
application replica count; scheduled work and rate limiting still assume one
application process per installation.

## PostgreSQL configuration

Set `DATABASE_DRIVER=postgres` and provide:

- `POSTGRES_HOST` and optional `POSTGRES_PORT`;
- a dedicated `POSTGRES_DATABASE`;
- a dedicated, non-superuser `POSTGRES_USER` that owns the application schema;
- `POSTGRES_PASSWORD_FILE`, pointing to a mounted password file; and
- `POSTGRES_TLS_MODE=verify-full` with `POSTGRES_CA_FILE` for a remote service.

The application rejects incomplete or contradictory settings. It does not
accept a password-bearing connection URL or a plaintext password environment
variable. `POSTGRES_TLS_MODE=disable` is intended only for a separately
protected local container network where transport encryption is deliberately
not used.

At startup the application connects to the selected database, acquires the
migration lock, applies the PostgreSQL migration set in one transaction, and
only then becomes ready. `/api/ready` reports unavailable while migrations or
database access are incomplete. Connection errors remain generic and do not
return credentials, certificate paths, or connection values.

## Deployment choices

- Compose keeps SQLite as the base configuration. The optional
  `compose.postgres.yml` overlay adds a private PostgreSQL service for a local
  single-host installation. See [container deployment](deployment-container.md).
- Helm keeps SQLite as the default. `postgres-external` references an existing
  PostgreSQL service, password Secret, and CA Secret. See
  [Kubernetes deployment](deployment-helm.md).
- Helm's `postgres-embedded-evaluation` mode is only for evaluation. It is one
  database pod with a retained claim, without an operator, automatic backup,
  failover, or a production availability contract.

The application never creates production database credentials. Keep values,
Secret manifests, certificates, dumps, and database files outside the
repository.

## PostgreSQL backup and restore

The bundled `npm run backup` and `npm run restore:check` commands are
SQLite-only and stop without changing a PostgreSQL installation. For
PostgreSQL, the operator must maintain a logical backup and restore procedure
using provider tooling or compatible `pg_dump` and `pg_restore` versions.

A minimum procedure is:

1. Create a logical dump before every application or database update.
2. Store it encrypted with restricted access outside the database failure
   domain.
3. Restore it into an isolated, empty test database with `--exit-on-error` and
   `--single-transaction`.
4. Start the same application version against that restored database.
5. Verify `/api/health`, `/api/ready`, authentication, expected aggregate
   record counts, and one known application workflow.
6. Record the test time and retain the last verified pre-update generation
   according to the operator's retention policy.

For example, a custom-format dump can be created without placing a password in
the command line:

```bash
PGPASSFILE=/run/secrets/postgres-password \
pg_dump --host=database.example.invalid --port=5432 \
  --username=betreuungskalender --dbname=betreuungskalender \
  --format=custom --no-owner --no-privileges \
  --file=betreuungskalender.dump
```

Test restoration only against an empty, isolated database prepared by the
operator:

```bash
PGPASSFILE=/run/secrets/postgres-password \
pg_restore --host=database.example.invalid --port=5432 \
  --username=betreuungskalender --dbname=betreuungskalender_restore_test \
  --exit-on-error --single-transaction --no-owner --no-privileges \
  betreuungskalender.dump
```

These commands are examples, not a retention or disaster-recovery service.
Managed PostgreSQL products may require their own snapshot and point-in-time
recovery controls in addition to a logical dump. Never test a restore over the
active database.

## Updates and rollback

PostgreSQL installations use a manual update gate:

1. Review the target release and its database notes.
2. Create and test a current logical backup.
3. Retain the previous application image or release directory.
4. Start exactly one target application instance and wait for `/api/ready`.
5. Verify the runtime version, authentication, and a known read/write workflow.

The archive update helper is intentionally SQLite-only and refuses PostgreSQL.
Reverting an image or Helm release does not reverse database migrations. If a
new schema is incompatible with the previous application, stop the application
and restore the verified pre-update database into an empty replacement database
before starting the previous application version. Do not delete migration rows,
edit schema objects manually, or run old and new application versions together.

## Portable instance transfer

Portable transfer is the supported way to move domain data between SQLite and
PostgreSQL installations. It is not an operational database backup and does not
merge independent data sets.

1. Initialize the target installation and establish its owner.
2. Export the source package from **Export & Import** and protect the file as
   sensitive personal data.
3. On the target, run **Import prüfen**. The mandatory dry run validates the
   checksum, format, references, limits, and expected replacement counts without
   changing the target database.
4. Resolve blocked checks and review every warning. The import requires the
   exact package fingerprint and the short-lived dry-run confirmation.
5. Confirm the replacement. The server validates the package again and commits
   the domain replacement atomically.
6. Map historical actors explicitly. Matching names or email addresses never
   grant access automatically.
7. Recreate personal feeds, push subscriptions, external feed connections, and
   other excluded runtime state.
8. Keep both source and target operational backups until the target has passed
   application verification.

OIDC subjects and claims, sessions, invitations, setup and feed tokens, push
subscriptions, recovery credentials, runtime secrets, and private external
calendar URLs are not transferred. See [backup and restore](backup-restore.md)
for the complete transfer review sequence.

## Troubleshooting

If `/api/ready` stays unavailable after selecting PostgreSQL:

1. Confirm exactly one application instance is starting.
2. Verify that the configured Secret keys exist and are mounted at the declared
   password and CA file paths; do not print their contents.
3. Check DNS, port reachability, certificate trust, certificate hostname, and
   system time from the application network boundary.
4. Confirm the database exists and the application role owns its schema without
   granting superuser privileges.
5. Review the abstract startup error category and database service logs. Do not
   enable request-body or credential logging.
6. If migration startup failed, keep the application stopped until the cause is
   understood. Do not edit migration rows or run another application version
   concurrently.

For the evaluation Helm mode, also verify the retained PVC and the referenced
password Secret. Do not expose its PostgreSQL Service outside the cluster to
work around a readiness problem.

## Unsupported operations

- direct conversion or copying between a SQLite file and PostgreSQL;
- dual writes or live replication between the two backends;
- using a portable export as the only disaster-recovery backup;
- production use of the chart's evaluation database;
- multiple application replicas for one installation; and
- assuming an application or Helm rollback reverses migrations.
