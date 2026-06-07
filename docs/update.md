# Updates and rollback

## Before updating

1. Read `CHANGELOG.md` and release notes.
2. Export browser data as JSON.
3. Run `npm run backup` for SQLite.
4. Run `npm run restore:check`.
5. Retain the current application version and configuration.

## Source/systemd installation

```bash
sudo systemctl stop betreuungskalender
cd /opt/betreuungskalender
git fetch --tags
git checkout vX.Y.Z
sudo -u betreuung npm ci
sudo -u betreuung npm run build
sudo systemctl start betreuungskalender
curl --fail http://127.0.0.1:3000/api/health
```

Database migrations run automatically at startup. They are forward migrations;
review migration notes before downgrading.

## Smoke test

- Load the dashboard.
- Verify API/server status.
- Open a known calendar period.
- Check one report and one export action without sharing the output.
- Confirm authentication cannot be bypassed.

## Rollback

1. Stop the service.
2. Restore the previous application version.
3. If the release applied an incompatible migration, restore the pre-update
   SQLite backup.
4. Start the service and repeat health and smoke checks.
5. Restore browser JSON only when browser-local data was changed or replaced.

Never attempt a database rollback by manually deleting migration records.
