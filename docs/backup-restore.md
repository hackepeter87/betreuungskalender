# Backup and restore

Betreuungskalender keeps all current domain data in SQLite. The authoritative
operational backup is therefore `npm run backup`. The in-app JSON export is a
portable application-data export and an additional user-facing safeguard; it
does not replace a verified SQLite backup. Browser local storage contains only
UI preferences and is not an operational data store.

## SQLite backup

The backup script uses the `better-sqlite3` backup API. It does not copy the
live database file byte-for-byte while the application is running.

```bash
DATABASE_PATH=/var/lib/betreuungskalender/app.sqlite \
BACKUP_DIR=/var/backups/betreuungskalender \
npm run backup
```

The destination directory is set to mode `0700` and new backup files to `0600`.
Files older than `BACKUP_RETENTION_DAYS` are removed; the default is 14 days.
Use additional weekly/monthly external retention if required.

Verify the latest backup:

```bash
npm run restore:check
```

Or verify a specific file:

```bash
npm run restore:check -- /var/backups/betreuungskalender/example.sqlite
```

The check runs SQLite `integrity_check` and verifies required tables. It does
not print family data.

The documented Compose update procedure runs both commands before switching a
release. See [update.md](update.md) for the complete update and rollback
procedure.

The minimal release container does not include npm. Run the same scripts there
directly:

```bash
podman exec APP_CONTAINER /nodejs/bin/node scripts/backup.js
podman exec APP_CONTAINER /nodejs/bin/node scripts/restore-check.js
```

## Restore procedure

1. Stop the application service.
2. Create a final backup of the current database if it is readable.
3. Run `npm run restore:check -- BACKUP_FILE`.
4. Copy the verified backup to the configured `DATABASE_PATH`.
5. Set owner and mode, for example:
   `chown betreuung:betreuung app.sqlite && chmod 600 app.sqlite`.
6. Remove stale `app.sqlite-wal` and `app.sqlite-shm` files only while the
   service is stopped and only after retaining the original directory.
7. Start the service.
8. Check `/api/health` and `/api/ready`.
9. Open the app and perform a known-data smoke test.

Test restoration periodically in an isolated environment. A successful backup
command alone does not prove recoverability.

## Portable instance transfer

The in-app transfer export is intended for moving complete domain data between
self-hosted installations whose OIDC identities may differ. It includes domain
records, audit history, and portable historical actor snapshots. It excludes
sessions, OIDC subjects and claims, invitation and setup tokens, personal feed
tokens, push subscriptions, recovery credentials, runtime secrets, and private
external-calendar feed URLs.

Every import follows this sequence:

1. Initialize the target installation and establish its owner normally.
2. Select the transfer JSON file in **Export & Import**.
3. Run **Import testen**. The server validates the checksum, relationships,
   limits, and current schema in a temporary SQLite database without changing
   the target database. A short-lived confirmation binds the later import to
   this exact tested package; after a server restart or expiry, run the test
   again.
4. Resolve blocked results before continuing. Review and explicitly accept any
   warnings.
5. Confirm the complete replacement of target domain data. The server validates
   the same package again, verifies its dry-run fingerprint, and imports it in
   one transaction.
6. Explicitly map historical actors to existing target members or create new
   invitations. No actor is granted access based on a matching name or email.
7. Reconfigure personal calendar feeds, push subscriptions, and external feed
   connections on the target installation.

The transfer mechanism does not merge two independent data sets. Keep the
source SQLite backup until the target has been checked. Legacy application JSON
exports remain accepted, but they also require a dry run and do not contain the
new historical actor snapshots.

JSON, CSV, and PDF files may contain sensitive personal data. Encrypt transfer
files at rest and in transit, remove temporary copies after verification, and
never attach them to public issues.
