# Updates and rollback

The supported production update path is Docker Compose with immutable,
checksummed release archives. The update tool is intentionally external to the
running application: it verifies the archive, creates and validates a SQLite
backup, changes the active release, waits for readiness, and rolls back both
the runtime and the matching database backup if validation fails.

It never attempts reverse database migrations.

## Supported paths

| Path | Status | Update method |
| --- | --- | --- |
| Docker Compose | Primary production path | `npm run update` / `scripts/update.js` |
| Docker without Compose | Supported runtime | Follow the same archive, backup, and rollback checks manually |
| systemd/direct Node.js | Fallback and development path | Stop service, retain prior release, backup, install, validate, and restore manually |
| Podman Compose | Tested compatibility only | Validate the equivalent commands in a non-production environment first |

The automated tool only manages the Compose layout below. Do not point it at a
development checkout, a named-volume evaluation setup, or a live systemd
installation.

## Stable Compose layout

Use a dedicated directory owned by the deployment operator. Configuration and
data remain outside every versioned release:

```text
/opt/svc_betreuung/betreuungskalender/
  compose.yml
  .env
  data/
    app.sqlite
  backups/
  releases/
    vX.Y.Z/
```

`compose.yml` is installed once from `deploy/compose.yml`. For the OIDC
single-port deployment, install `deploy/compose.oidc.yml` as
`compose.oidc.yml` and add `oauth2-proxy.cfg` next to `.env`. `.env` must
include the active release path and version, in addition to the normal
application configuration. Keep `.env` and `oauth2-proxy.cfg` private and out
of Git.

```dotenv
APP_RELEASE_VERSION=X.Y.Z
APP_RELEASE_DIR=/opt/svc_betreuung/betreuungskalender/releases/vX.Y.Z
HOST_BIND_ADDRESS=127.0.0.1
HOST_PORT=3000
REQUIRE_AUTH=true
TRUST_PROXY_AUTH=true
ALLOWED_ORIGIN=https://betreuung.example.net
LOG_LEVEL=info
RATE_LIMIT_MAX=120
RATE_LIMIT_WRITE_MAX=20
RATE_LIMIT_SENSITIVE_MAX=5
RATE_LIMIT_EXPORT_MAX=15
RATE_LIMIT_WINDOW_MS=60000
BACKUP_RETENTION_DAYS=14
```

When using `compose.oidc.yml`, also set:

```dotenv
APP_COMPOSE_FILE=compose.oidc.yml
```

For the first Compose installation, verify and extract the release archive,
copy `deploy/compose.yml` to
`/opt/svc_betreuung/betreuungskalender/compose.yml`, create the private `.env`,
then create `data/`, `backups/`, and `releases/`. The release Compose file
keeps the SQLite and backup paths fixed inside the container as
`/data/app.sqlite` and `/backups`. Operators should persist those paths through
the host-side bind mounts `./data:/data` and `./backups:/backups`, not by
setting `DATABASE_PATH` or `BACKUP_DIR` in `.env`. The container runs as the
`node` user, so bind-mounted `data/` and `backups/` must be writable by that
container user. Start it with:

```bash
sudo docker compose \
  --project-directory /opt/svc_betreuung/betreuungskalender \
  --env-file /opt/svc_betreuung/betreuungskalender/.env \
  -f /opt/svc_betreuung/betreuungskalender/compose.yml up -d --build
```

For the OIDC deployment, copy `deploy/compose.oidc.yml` to
`/opt/svc_betreuung/betreuungskalender/compose.oidc.yml`, copy
`deploy/.env.oidc.example` to `.env`, copy `deploy/oauth2-proxy.cfg.example` to
`oauth2-proxy.cfg`, replace every placeholder and secret, and start:

```bash
sudo docker compose \
  --project-directory /opt/svc_betreuung/betreuungskalender \
  --env-file /opt/svc_betreuung/betreuungskalender/.env \
  -f /opt/svc_betreuung/betreuungskalender/compose.oidc.yml up -d --build
```

In OIDC mode, `HOST_PORT` is the oauth2-proxy host port, not the app port. The
app service has no host port and is reachable only through
`http://betreuungskalender:3000` on the Compose network.

Replace `X.Y.Z` with the package version, for example `1.0.0-rc.1`, and
`vX.Y.Z` with the matching release tag, for example `v1.0.0-rc.1`.

If a rootless Podman or Docker host is behind a reverse proxy running on a
different host or VM, `HOST_BIND_ADDRESS=127.0.0.1` may not be reachable by that
proxy. Bind to the VM IP or all interfaces and restrict access at the firewall
or proxy layer, for example:

```dotenv
HOST_BIND_ADDRESS=0.0.0.0
HOST_PORT=8080
ALLOWED_ORIGIN=https://betreuungskalender.example.net
```

## Obtain and verify a release artifact

Download a versioned archive and its `.sha256` sidecar only from the matching
release workflow or trusted release location. Do not use an archive from an
unverified mirror. Verify it before extracting or executing its helper:

```bash
sha256sum --check betreuungskalender-vX.Y.Z.tar.gz.sha256
tar -tzf betreuungskalender-vX.Y.Z.tar.gz | less
```

On macOS, compare `shasum -a 256 betreuungskalender-vX.Y.Z.tar.gz` with the
recorded checksum. The archive contains the built frontend/backend, a minimal
runtime `Dockerfile.release`, and the operational scripts. It does not contain
`.env`, SQLite data, backups, exports, or secrets.

## Managed Compose update

Use the updater from a previously installed release. During first adoption,
after validating the checksum, it is also acceptable to extract only
`scripts/update.js` from the target archive into a protected temporary path and
delete that temporary file after the run.

First run a non-writing preflight with local archive files:

```bash
sudo node /opt/svc_betreuung/betreuungskalender/releases/vCURRENT/scripts/update.js \
  --root /opt/svc_betreuung/betreuungskalender \
  --version X.Y.Z \
  --artifact /srv/releases/betreuungskalender-vX.Y.Z.tar.gz \
  --checksum /srv/releases/betreuungskalender-vX.Y.Z.tar.gz.sha256 \
  --dry-run
```

Run the same command without `--dry-run` after reviewing release notes. HTTPS
downloads can be supplied with `--artifact-url` and `--checksum-url`; a dry run
with remote URLs reports the planned download but does not retrieve or modify
anything.

`vCURRENT` is the already installed release that provides the updater.
`X.Y.Z` is the target version without the leading `v`; for the first release
candidate, use `1.0.0-rc.1` with
`betreuungskalender-v1.0.0-rc.1.tar.gz`. The target directory
`releases/vX.Y.Z/` must not already exist. If it does, stop and decide whether
it is a previous failed extraction, a manually installed release, or an active
runtime before retrying.

The tool performs these ordered steps:

1. checks the active layout, Docker Compose availability, disk space, release
   directory, and the update lock;
2. validates the archive checksum, contents, and package version;
3. runs `npm run backup` and `npm run restore:check` inside the current
   container, then stores a mode-`0600` snapshot of `.env` and metadata next
   to the verified SQLite backup. The metadata never contains configuration
   values, but the private configuration snapshot may contain secrets;
4. extracts the verified archive to `releases/vX.Y.Z`, updates only
   `APP_RELEASE_DIR` and `APP_RELEASE_VERSION`, and starts Compose;
5. repeatedly runs `npm run verify:runtime` in the container. This confirms
   `/api/health`, `/api/ready`, the expected version, SQLite integrity, and
   recorded migrations; and
6. records the successfully verified runtime state.

The update lock prevents concurrent operations. A lock older than two hours is
not removed automatically. Investigate the operator and running processes
first; use `--clear-stale-lock` only after confirming that no update is active.

Output consists of JSON lines suitable for an operator log. Exit codes are:

| Code | Meaning |
| --- | --- |
| `2` | Invalid command arguments |
| `10` | Preflight failed |
| `11` | Existing update lock |
| `12` | Artifact or checksum verification failed |
| `13` | Backup or restore validation failed |
| `14` | Runtime extraction or switch failed |
| `15` | New runtime did not become valid in time |
| `16` | Automatic rollback failed |

## Automatic and manual rollback

After the runtime path changes, every failed start or verification triggers an
automatic rollback. It stops the changed Compose stack, replaces
`data/app.sqlite` with the verified pre-update backup, removes only the matching
SQLite WAL/SHM sidecars, restores the previous release path, and verifies that
previous runtime again. This is deliberately a runtime-and-database pair; a
container-only rollback is not sufficient after forward migrations.

If automatic rollback reports exit code `16`, keep the generated log and do
not retry the update blindly. Recover manually:

1. stop the Compose stack without deleting bind mounts;
2. run `npm run restore:check -- BACKUP_FILE` in a trusted runtime;
3. replace the database with that verified backup while the service is stopped;
4. remove only the matching `app.sqlite-wal` and `app.sqlite-shm` sidecars;
5. set `APP_RELEASE_DIR` and `APP_RELEASE_VERSION` back to the prior verified
   release in `.env`;
6. start Compose and run `npm run verify:runtime -- --expected-version X.Y.Z`;
7. retain the failed archive, backup metadata, and update log for diagnosis.

Never delete migration rows or edit SQLite files while the service is running.

## Direct Node.js/systemd fallback

For the documented systemd/LXC path, use the same order manually: review the
release, make and validate a SQLite backup, stop the service, retain the prior
application directory, install the exact release, start it, check health and
readiness, and restore both prior runtime and backup if validation fails. The
systemd path does not support the Compose updater. Its full setup remains in
[deployment-lxc.md](deployment-lxc.md).

Application maintainers preparing a new version should follow the separate
[release workflow](release.md), including the strict sensitive-artifact check
before creating a tag.
