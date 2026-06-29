# Container deployment

The repository contains two container entry points:

- `Dockerfile` plus root-level `compose.yaml` for local evaluation and CI-style
  container checks from a checkout.
- `Dockerfile.release` plus `deploy/compose.yml` for the supported release
  archive runtime and managed update layout.

Both runtime images use Node.js 22 LTS, install production dependencies only,
run as the unprivileged `node` user, and include a healthcheck.

GitHub Actions builds the image and starts a disposable container on relevant
pull requests and pushes. Validation succeeds only after the container's
`/api/health` endpoint confirms that SQLite is reachable. CI does not push the
image to a registry and does not require deployment secrets.

## Local checkout Docker Compose

```bash
docker compose build
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
```

The root-level `compose.yaml` binds only to `127.0.0.1:3000` and uses named
volumes for `/data` and `/backups`. Its authentication is disabled for a local
single-user start. Change these values before exposing the service.

For a persistent production installation, use the separate stable bind-mount
layout in [update.md](update.md), which installs `deploy/compose.yml` as
`/opt/svc_betreuung/betreuungskalender/compose.yml`. It keeps `data/`,
`backups/`, `.env`, and the active versioned release outside the runtime image
and is the only layout managed by `npm run update`.

The release Compose file requires `APP_RELEASE_VERSION`, `APP_RELEASE_DIR`,
`HOST_BIND_ADDRESS`, and `HOST_PORT` in `.env`; these values are included in
`.env.example`. `APP_RELEASE_VERSION` is the package version without the leading
`v`, for example `1.0.0-rc.1`. `APP_RELEASE_DIR` points at the extracted release
directory, for example
`/opt/svc_betreuung/betreuungskalender/releases/v1.0.0-rc.1`.

Do not set host filesystem paths for `DATABASE_PATH` or `BACKUP_DIR` in the
release `.env`. The release Compose file intentionally fixes those values inside
the container as `/data/app.sqlite` and `/backups`; persist them through the
host-side `./data:/data` and `./backups:/backups` bind mounts.

## Podman

```bash
podman build -t betreuungskalender:local .
podman run --rm -d --name betreuungskalender \
  -p 127.0.0.1:3000:3000 \
  -e REQUIRE_AUTH=false \
  -e TRUST_PROXY_AUTH=false \
  -e ALLOWED_ORIGIN=http://localhost:3000 \
  -v betreuung-data:/data \
  -v betreuung-backups:/backups \
  betreuungskalender:local
```

Named volumes work well with rootless Podman. For bind mounts, ensure the
container's `node` user can write them. With SELinux, add `:Z` where required.
Do not solve permission problems by running the application as root.

The release `deploy/compose.yml` can also be used with Docker Compose or Podman
Compose when the host supports the Compose features used by the file. For
rootless Podman behind a reverse proxy on another host or VM,
`HOST_BIND_ADDRESS=127.0.0.1` may only bind inside the Podman host namespace.
Use the VM IP or all interfaces and restrict access externally, for example:

```dotenv
HOST_BIND_ADDRESS=0.0.0.0
HOST_PORT=8080
ALLOWED_ORIGIN=https://betreuungskalender.example.net
```

## Backup

```bash
docker compose exec betreuungskalender npm run backup
docker compose exec betreuungskalender npm run restore:check
```

Copy backups to protected external storage according to the container engine's
volume procedures. Browser-local JSON exports remain a separate backup.

## Update

For the production bind-mount layout, use the checksummed archive and managed
update procedure in [update.md](update.md). It validates a pre-update backup,
runtime version, readiness, migrations, and SQLite integrity before accepting a
new release, and restores both runtime and database on failure. Keep the prior
release directory until the new runtime has been verified.

## Rollback

1. Stop the updated container without deleting its data or backup volumes.
2. Restore the pre-update SQLite backup if a migration is not backward
   compatible.
3. Start the previously verified image or rebuild the previous tag.
4. Confirm `/api/health`, authentication boundaries, and the UI smoke test.

Never use a container rollback as a substitute for a tested database restore.

## Optional registry publication

The standard workflows intentionally build without pushing. GHCR publication
may be added later as a separate reviewed job with `packages: write`; see
[release.md](release.md). Deploy by immutable digest when a registry is used,
and keep registry credentials outside the repository.

For reverse-proxy authentication, remove the public port mapping where possible
and attach the app only to a private proxy network.
