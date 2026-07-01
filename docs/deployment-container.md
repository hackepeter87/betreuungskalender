# Container deployment

The repository supports three container paths:

- `Dockerfile` plus root-level `compose.yaml` for local evaluation and CI-style
  container checks from a checkout.
- `Dockerfile.release` plus `deploy/compose.yml` for the supported release
  archive runtime and managed update layout.
- `Dockerfile.release` plus `deploy/compose.oidc.yml` for the release archive
  runtime behind oauth2-proxy on one exposed host port.
- Published GHCR release images for operators that want to pull an immutable
  image instead of building the release runtime from an extracted archive.

Both runtime images use Node.js 22 LTS, install production dependencies only,
run as the unprivileged `node` user, and include a healthcheck.

GitHub Actions builds the image and starts a disposable container on relevant
pull requests and pushes. Validation succeeds only after the container's
`/api/health` endpoint confirms that SQLite is reachable. CI does not push the
image to a registry and does not require deployment secrets.

Published GitHub releases from `v1.2.0` onward may also include a GHCR image
digest asset. The archive-based update path remains the primary documented
production path because it validates the release archive, backup, migration,
runtime version, and rollback as one operation. GHCR image deployment is useful
when image distribution is preferred, but operators must still keep the same
configuration, persistence, backup, and auth-boundary checks.

## Local checkout Docker Compose

```bash
docker compose build
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
```

The root-level `compose.yaml` binds only to `127.0.0.1:3000` and uses named
volumes for `/data` and `/backups`. Its authentication is disabled for a local
single-user start with `AUTH_MODE=local`. Change these values before exposing
the service.

For a persistent production installation, use the separate stable bind-mount
layout in [update.md](update.md), which installs `deploy/compose.yml` as
`/opt/svc_betreuung/betreuungskalender/compose.yml`. It keeps `data/`,
`backups/`, `.env`, and the active versioned release outside the runtime image
and is the only layout managed by `npm run update`.

The release Compose file requires `APP_RELEASE_VERSION`, `APP_RELEASE_DIR`,
`HOST_BIND_ADDRESS`, and `HOST_PORT` in `.env`; these values are included in
`.env.example`. `APP_RELEASE_VERSION` is the package version without the leading
`v`, for example `1.2.0`. `APP_RELEASE_DIR` points at the extracted release
directory, for example
`/opt/svc_betreuung/betreuungskalender/releases/v1.2.0`.

The generic `.env.example` is safe for the direct `deploy/compose.yml` path and
therefore sets `TRUST_PROXY_AUTH=false`. Do not enable trusted proxy auth while
the app service itself publishes a host port unless another reviewed boundary
prevents all direct client access. For oauth2-proxy/OIDC deployments, use
`deploy/.env.oidc.example` and `deploy/compose.oidc.yml` instead.

Do not set host filesystem paths for `DATABASE_PATH` or `BACKUP_DIR` in the
release `.env`. The release Compose file intentionally fixes those values inside
the container as `/data/app.sqlite` and `/backups`; persist them through the
host-side `./data:/data` and `./backups:/backups` bind mounts.

## Release archive with native OIDC

For a fresh OIDC deployment without oauth2-proxy, use `deploy/compose.yml` with
`AUTH_MODE=native-oidc`. In this mode the app owns the OIDC login, callback,
logout, and server-side session lifecycle. It must sit behind an existing HTTPS
reverse proxy, but that proxy must not be treated as an authentication source.

The native OIDC setup is documented in
[native-oidc-keycloak-podman.md](native-oidc-keycloak-podman.md). The short
shape is:

```dotenv
AUTH_MODE=native-oidc
REQUIRE_AUTH=true
TRUST_PROXY_AUTH=false
OIDC_ISSUER_URL=https://idp.example.net/realms/example
OIDC_CLIENT_ID=betreuungskalender
OIDC_CLIENT_SECRET=CHANGE_ME
OIDC_REDIRECT_URI=https://app.example.net/auth/callback
OIDC_SCOPES=openid email profile
OIDC_GROUPS_CLAIM=groups
OIDC_REQUIRE_ROLE_CLAIM=true
ALLOWED_ORIGIN=https://app.example.net
```

Use `HOST_BIND_ADDRESS=127.0.0.1` when the TLS reverse proxy runs on the same
host. With rootless Podman behind a proxy on another host or VM, bind to the VM
address or all interfaces only when firewall or proxy policy restricts access
to the intended path.

## Release archive with oauth2-proxy

For an internet-facing OIDC deployment, prefer `deploy/compose.oidc.yml` over
publishing the app container directly. Install it as `compose.oidc.yml` next to
the private `.env`, `oauth2-proxy.cfg`, persistent `data/`, persistent
`backups/`, and extracted releases:

```text
/opt/svc_betreuung/betreuungskalender/
  compose.oidc.yml
  .env
  oauth2-proxy.cfg
  data/
  backups/
  releases/
    v1.2.0/
      Dockerfile.release
      dist/
      dist-server/
      scripts/
      package.json
      package-lock.json
```

This deployment mode requires a release artifact that actually contains
`deploy/compose.oidc.yml`, `deploy/.env.oidc.example`, and
`deploy/oauth2-proxy.cfg.example`. The published `v1.0.0-rc.1` archive was cut
before these files existed. Do not treat copying deployment files from `main`
into an older release archive as the normal production path; use `v1.0.0` or a
newer verified release artifact that includes the files.

Use `deploy/.env.oidc.example` as the starting point for `.env` and
`deploy/oauth2-proxy.cfg.example` as the starting point for
`oauth2-proxy.cfg`. Keep both private and out of Git after editing. The OIDC
Compose file exposes only oauth2-proxy:

```dotenv
HOST_BIND_ADDRESS=0.0.0.0
HOST_PORT=8080
ALLOWED_ORIGIN=https://app.example.net
AUTH_MODE=trusted-proxy
REQUIRE_AUTH=true
TRUST_PROXY_AUTH=true
```

The app service uses `expose: 3000` for Compose networking and has no host
`ports:` entry in this mode. oauth2-proxy forwards authenticated traffic to
`http://betreuungskalender:3000` over the private Compose network. This is the
safe shape when `TRUST_PROXY_AUTH=true`, because direct client access to the app
would allow forged identity headers.

For an external TLS reverse proxy, point the backend to the Compose host and
oauth2-proxy port, for example `app-host.example.net:8080` or
`192.0.2.10:8080`. The public URL must match `ALLOWED_ORIGIN` and the Keycloak
redirect URI. If the proxy runs on the same host, loopback may be sufficient.
With rootless Podman behind an external proxy or VM boundary, bind to the VM IP
or all interfaces and restrict access at the firewall or proxy layer:

```dotenv
HOST_BIND_ADDRESS=0.0.0.0
HOST_PORT=8080
ALLOWED_ORIGIN=https://app.example.net
```

For example, with a public URL of `https://app.example.net`, configure the
Keycloak redirect URI as `https://app.example.net/oauth2/callback`, set the web
origin to `https://app.example.net`, and forward the external reverse proxy to
the Compose host on `HOST_PORT`, for example `192.0.2.10:8080`.

Start the OIDC stack with Docker Compose or a compatible Podman Compose
installation:

```bash
sudo docker compose \
  --project-directory /opt/svc_betreuung/betreuungskalender \
  --env-file /opt/svc_betreuung/betreuungskalender/.env \
  -f /opt/svc_betreuung/betreuungskalender/compose.oidc.yml up -d --build
```

For rootless Podman with `podman-compose` 1.0.x, run the commands from the
deployment directory and avoid Docker-specific `--project-directory` flags:

```bash
cd /opt/svc_betreuung/betreuungskalender
podman-compose --env-file .env -f compose.oidc.yml config
podman-compose --env-file .env -f compose.oidc.yml up -d --build
podman-compose --env-file .env -f compose.oidc.yml ps
```

Validate that only oauth2-proxy has a host port, the app is healthy, and the
public URL redirects to `/oauth2/start` before authenticating back to the app.
Keep `./data:/data` and `./backups:/backups` as the persistence boundary; do not
replace them with host paths in `DATABASE_PATH` or `BACKUP_DIR`.

### Rootless Podman config-file permissions

`oauth2-proxy.cfg` contains client and cookie secrets, so it should not be
world-readable. At the same time, the oauth2-proxy container runs as a nonroot
user. With rootless Podman, a host-owned `0600` bind-mounted file can be
unreadable inside the user namespace even though the path exists. The container
then exits with a config-read or parse error.

Use this reproducible ownership handoff after editing the config. Read the
container user from the configured image; if your image inspect output is empty,
check the image documentation before choosing a fallback UID/GID.

```bash
cd /opt/svc_betreuung/betreuungskalender
OAUTH2_PROXY_IMAGE="${OAUTH2_PROXY_IMAGE:-quay.io/oauth2-proxy/oauth2-proxy:v7.15.3}"
OAUTH2_PROXY_USER="$(podman image inspect "$OAUTH2_PROXY_IMAGE" --format '{{.Config.User}}')"
test -n "$OAUTH2_PROXY_USER" || OAUTH2_PROXY_USER="2000:2000"

# Edit as the deployment operator.
podman unshare chown "$(id -u):$(id -g)" oauth2-proxy.cfg
chmod 0600 oauth2-proxy.cfg
${EDITOR:-vi} oauth2-proxy.cfg

# Hand read access back to the container user without making secrets public.
podman unshare chown "$OAUTH2_PROXY_USER" oauth2-proxy.cfg
chmod 0400 oauth2-proxy.cfg
podman unshare ls -ln oauth2-proxy.cfg
```

To edit it later, repeat the first three commands, then restore ownership and
mode before starting oauth2-proxy. Do not use `chmod 0644` as a shortcut for
secret-bearing config files.

Generate a valid oauth2-proxy cookie secret with exactly 32 ASCII characters:

```bash
COOKIE_SECRET="$(openssl rand -hex 16)"
printf '%s\n' "$COOKIE_SECRET"
test "${#COOKIE_SECRET}" -eq 32
```

Paste that value into `cookie_secret`. Generate `client_secret` in Keycloak.
Never commit either value.

### Rootless Podman health and validation

Podman/Buildah can warn that a Dockerfile `HEALTHCHECK` is ignored for OCI
image format, and Podman Compose health-state handling can differ from Docker
Compose. Do not rely only on `podman ps` health output. Validate each layer:

```bash
cd /opt/svc_betreuung/betreuungskalender
podman-compose --env-file .env -f compose.oidc.yml ps

# App health from inside the private network/container.
podman exec betreuungskalender_betreuungskalender_1 node scripts/healthcheck.js

# oauth2-proxy listener on the single exposed local host port.
curl -fsSI http://127.0.0.1:8080/oauth2/start

# The app entrypoint should redirect unauthenticated traffic toward OIDC.
curl -fsSI http://127.0.0.1:8080/
```

Container names can differ by Compose implementation. Use
`podman ps --format '{{.Names}}'` if the generated names are different.

### OIDC troubleshooting checklist

- App container health: run `podman exec APP_CONTAINER node scripts/healthcheck.js`
  and inspect `podman inspect APP_CONTAINER`.
- oauth2-proxy config parse errors: run `podman start -a OAUTH2_CONTAINER` to
  see the foreground startup error, then fix `oauth2-proxy.cfg`.
- Cookie secret length errors: regenerate with `openssl rand -hex 16` and
  confirm `test "${#COOKIE_SECRET}" -eq 32`.
- Config file permission errors: check `podman unshare ls -ln
  oauth2-proxy.cfg`, then restore ownership to the image `Config.User` value
  and mode `0400`.
- Keycloak discovery errors: confirm `oidc_issuer_url` is reachable from the
  container host and points at the exact realm issuer.
- Redirect URI mismatch: confirm Keycloak allows the exact public callback URL,
  for example `https://app.example.net/oauth2/callback`.
- Local listener: run `curl -fsSI http://127.0.0.1:<hostport>/oauth2/start`
  on the container host.
- External proxy reachability: verify the TLS reverse proxy backend points to
  the container host and `HOST_PORT`, and that firewall rules allow that path.

`podman logs` is useful, but it is not the only diagnostic path. `podman
start -a CONTAINER` shows immediate foreground startup failures, and
`podman inspect CONTAINER` shows mounts, network attachments, and exit codes.

## Podman

```bash
podman build -t betreuungskalender:local .
podman run --rm -d --name betreuungskalender \
  -p 127.0.0.1:3000:3000 \
  -e AUTH_MODE=local \
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

The same host binding rule applies to `deploy/compose.oidc.yml`. In OIDC mode,
the exposed host port belongs to oauth2-proxy, while the app remains reachable
only on the Compose network.

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

## Registry publication

Published GitHub releases also publish a release runtime image to GitHub
Container Registry:

```text
ghcr.io/hackepeter87/betreuungskalender:vX.Y.Z
ghcr.io/hackepeter87/betreuungskalender:X.Y.Z
ghcr.io/hackepeter87/betreuungskalender:latest
```

`latest` is updated only for non-prerelease releases. Prefer the immutable
digest reference recorded in the release asset
`betreuungskalender-vX.Y.Z.image-digest.txt` when deploying from GHCR.

For `v1.2.0`, the digest was backfilled manually and recorded in
`betreuungskalender-v1.2.0.image-digest.txt` on the GitHub release. The
published tags are:

```text
ghcr.io/hackepeter87/betreuungskalender:v1.2.0
ghcr.io/hackepeter87/betreuungskalender:1.2.0
```

Because `v1.2.0` was backfilled through a manual workflow dispatch, `latest`
was not updated for that release. Future non-prerelease releases published
through the normal release event update `latest` automatically.

The archive-based update flow remains the primary documented production update
path because it validates the checksum, migration readiness, backup, rollback,
and runtime version together. Keep registry credentials outside the repository.

With Podman, pull by digest and keep the same runtime environment and bind
mounts as the release archive container:

```bash
podman pull ghcr.io/hackepeter87/betreuungskalender@sha256:<digest>
podman run --rm -d --name betreuungskalender \
  -p 127.0.0.1:3000:3000 \
  -e NODE_ENV=production \
  -e HOST=0.0.0.0 \
  -e PORT=3000 \
  -e DATABASE_PATH=/data/app.sqlite \
  -e BACKUP_DIR=/backups \
  -e AUTH_MODE=local \
  -e REQUIRE_AUTH=true \
  -e TRUST_PROXY_AUTH=false \
  -e ALLOWED_ORIGIN=https://betreuungskalender.example.net \
  -v ./data:/data \
  -v ./backups:/backups \
  ghcr.io/hackepeter87/betreuungskalender@sha256:<digest>
```

For the trusted-header OIDC topology, keep the app container private and expose
only oauth2-proxy, just as in `deploy/compose.oidc.yml`. If using Compose with
the GHCR image, create a private deployment-specific Compose file by copying
`deploy/compose.yml` or `deploy/compose.oidc.yml`, replacing the local image
name with the immutable GHCR reference, and deleting the `build:` block. Keep
that file outside the repository when it contains local deployment values.

After starting an image-based deployment, run the same runtime verification as
for archive deployments:

```bash
podman exec betreuungskalender npm run verify:runtime -- --expected-version X.Y.Z
```

The image does not remove the need for a verified SQLite backup, restore test,
auth-boundary check, and rollback plan before production updates.

For reverse-proxy authentication, remove the public port mapping where possible
and attach the app only to a private proxy network.
