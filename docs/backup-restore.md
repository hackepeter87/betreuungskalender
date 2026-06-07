# Backup and restore

Betreuungskalender has two independent storage surfaces:

1. Browser local storage, backed up through the application's JSON export.
2. SQLite API data, backed up with `npm run backup`.

Back up both if both are in use.

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

## Browser JSON restore

Export an up-to-date JSON file before importing another one. Test JSON restore
in a separate browser profile. JSON, CSV, and PDF files may contain sensitive
data and should be encrypted at rest and never attached to public issues.
