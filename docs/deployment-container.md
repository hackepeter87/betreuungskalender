# Container deployment

The repository contains a multi-stage `Dockerfile` and `compose.yaml`. The
runtime image uses Node.js 22 LTS, installs production dependencies only, runs
as the unprivileged `node` user, and includes a healthcheck.

GitHub Actions builds the image and starts a disposable container on relevant
pull requests and pushes. Validation succeeds only after the container's
`/api/health` endpoint confirms that SQLite is reachable. CI does not push the
image to a registry and does not require deployment secrets.

## Docker Compose

```bash
docker compose build
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
```

The default Compose file binds only to `127.0.0.1:3000` and uses named volumes
for `/data` and `/backups`. Its authentication is disabled for a local
single-user start. Change these values before exposing the service.

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

## Backup

```bash
docker compose exec betreuungskalender npm run backup
docker compose exec betreuungskalender npm run restore:check
```

Copy backups to protected external storage according to the container engine's
volume procedures. Browser-local JSON exports remain a separate backup.

## Update

1. Export browser JSON and create an SQLite backup.
2. Pull or check out the intended version.
3. Run `docker compose build --pull`.
4. Run `docker compose up -d`.
5. Check container health and perform a UI smoke test.

For tagged versions, verify the release workflow and archive checksum described
in [release.md](release.md) before rebuilding or replacing a running container.
Keep the prior image or source checkout available until the smoke test passes.

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
