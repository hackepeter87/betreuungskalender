# Container deployment

The repository supports these container paths:

- `Dockerfile` plus root-level `compose.yaml` for local evaluation and CI-style
  container checks from a checkout.
- `Dockerfile.release` plus `deploy/compose.yml` for the supported release
  archive runtime and update layout.
- Published GHCR release images for operators that want to pull an immutable
  image instead of building the release runtime from an extracted archive.
- The application Helm chart in `charts/betreuungskalender` for Kubernetes;
  see [deployment-helm.md](deployment-helm.md).
- `deploy/compose.testing.yml` and `deploy/compose.production.yml` for
  image-based testing and production channels
  where machines pull `testing` or `production` without local image builds.

Both runtime images use a digest-pinned minimal Node.js 24 runtime. Build tools,
the package manager, and a shell remain in build stages and are not copied into
the final image. The runtime installs production dependencies only, keeps the
existing numeric UID/GID `1000`, and includes a direct Node.js healthcheck. This
reduces the runtime package surface and avoids package-manager output during
normal startup.

Because the final image intentionally has no shell or package manager, run the
included maintenance scripts with `/nodejs/bin/node`. Container debugging that
requires a shell must use a separate, temporary diagnostic container; do not
add debugging tools to the application image.

GitHub Actions builds the image and starts a disposable container on relevant
pull requests and pushes. Validation succeeds only after the container's
`/api/health` endpoint confirms through the persistence runtime that the
selected database is reachable. Readiness additionally requires completed
migrations. CI does not push the image to a registry and does not require
deployment secrets.

Published GitHub releases from `v1.2.0` onward may also include a GHCR image
digest asset. The archive-based update path remains supported because it
validates the release archive, backup, migration, runtime version, and rollback
as one operation. Image-based deployments are the preferred path when operators
want stable machine configuration and updates by pulling promoted GHCR tags.
Operators must still keep the same persistence, backup, runtime verification,
and auth-boundary checks.

Operator-provided `impressum.txt` and `datenschutz.txt` can be mounted read-only
without rebuilding the image. See [operator legal information](legal-information.md)
for Docker, Compose, Podman, and identity-provider link guidance.

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
and is the layout updated by `npm run update`.

The release Compose file requires `APP_RELEASE_VERSION`, `APP_RELEASE_DIR`,
`HOST_BIND_ADDRESS`, and `HOST_PORT` in `.env`; these values are included in
`.env.example`. `APP_RELEASE_VERSION` is the package version without the leading
`v`, for example `X.Y.Z`. `APP_RELEASE_DIR` points at the extracted release
directory, for example
`/opt/svc_betreuung/betreuungskalender/releases/vX.Y.Z`.

The generic `.env.example` is safe for the direct `deploy/compose.yml` path and
therefore sets `TRUST_PROXY_AUTH=false`. Do not enable trusted proxy auth while
the app service itself publishes a host port unless a separately managed,
reviewed authentication proxy prevents all direct client access.

Do not set host filesystem paths for `DATABASE_PATH` or `BACKUP_DIR` in the
release `.env`. The release Compose file intentionally fixes those values inside
the container as `/data/app.sqlite` and `/backups`; persist them through the
host-side `./data:/data` and `./backups:/backups` bind mounts.

### Optional local PostgreSQL service

SQLite remains the default for every Compose definition. To start the optional
PostgreSQL service, place `compose.postgres.yml` and the accompanying
`postgres/init/` directory next to the selected base Compose file. Create two
different private password files outside the release directory:

```bash
install -d -m 0700 secrets
openssl rand -base64 32 > secrets/postgres-admin-password
openssl rand -base64 32 > secrets/postgres-password
chmod 0644 secrets/postgres-*-password
```

Keep the `secrets/` directory at mode `0700`. Docker Compose implements local
file secrets as bind mounts on Linux, so the files themselves must be readable
by the nonroot users in the application and PostgreSQL containers. The private
parent directory prevents other host users from reaching those `0644` files.
Do not place them in a shared or traversable directory.

Add only the file paths and non-secret database names to the private Compose
environment file:

```dotenv
DATABASE_DRIVER=postgres
POSTGRES_DATABASE=betreuungskalender
POSTGRES_USER=betreuungskalender
POSTGRES_PASSWORD_FILE=/absolute/path/to/secrets/postgres-password
POSTGRES_ADMIN_PASSWORD_FILE=/absolute/path/to/secrets/postgres-admin-password
```

Start the selected base definition together with the opt-in overlay:

```bash
docker compose --env-file .env \
  -f compose.yml \
  -f compose.postgres.yml \
  up -d
```

The database has no published host port and is reachable only from the
application over an internal Compose network. Transport encryption is disabled
only for this isolated container network. The application uses a dedicated
non-superuser role; the separate database administrator credential is required
only to initialize a new database volume. Podman Compose can use the same two
files when its Compose provider supports health-based dependencies and Compose
secrets.

Do not run the SQLite backup command against this configuration. PostgreSQL
requires its own logical backup and restore procedure. A portable application
export can be used to move domain data from an existing SQLite installation,
but it does not replace a database backup. Follow the complete
[database backend operating procedure](database-backends.md).
The archive update tool intentionally stops before changing a PostgreSQL-backed
installation because its automatic backup and rollback path is SQLite-specific.

## Optional Prometheus metrics

The metrics listener is disabled by default and is separate from the application
HTTP listener. When enabled, it serves only `GET /metrics`, requires a bearer
token read from a mounted file, and must remain on a private operator network.
Do not route it through the public reverse proxy.

Create a private token file and add an operator-owned Compose override rather
than placing the token in `.env`:

```bash
install -d -m 0700 secrets
openssl rand -hex 32 > secrets/metrics-token
chmod 0644 secrets/metrics-token
```

```yaml
services:
  betreuungskalender:
    environment:
      METRICS_ENABLED: "true"
      METRICS_HOST: 0.0.0.0
      METRICS_PORT: "9090"
      METRICS_BEARER_TOKEN_FILE: /run/secrets/metrics/token
    expose:
      - "9090"
    volumes:
      - ./secrets/metrics-token:/run/secrets/metrics/token:ro
```

`expose` documents an internal container port; it does not publish the port on
the host. Podman can use the same private bind mount and container-network
exposure. Configure the monitoring system to send `Authorization: Bearer ...`
and manage scrape retention outside the application.

The token file is readable by the non-root container process. Keep its parent
directory mode at `0700`, do not share that directory, and mount the file
read-only as shown above.

Metrics contain process uptime, normalized request counts and durations,
database reachability and migration readiness, and bounded background-job
outcomes. They contain no user, child, calendar, token, URL, IP-address,
request-ID, or free-text labels.

## Promoted GHCR image deployment

For testing and production machines that should not build from release
archives, install the matching image Compose file as `compose.yml` and keep
private settings in `app.env`. Use `deploy/compose.testing.yml` only on a
testing installation and `deploy/compose.production.yml` only on a production
installation. Do not use `latest` in deployment Compose files; it is not a
release gate.

The image-based path is documented in [image-promotion.md](image-promotion.md).
It uses native OIDC when `AUTH_MODE=native-oidc` and
`TRUST_PROXY_AUTH=false` are set in `app.env`.

## Release archive with native OIDC

For a fresh OIDC deployment, use `deploy/compose.yml` with
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
WEB_PUSH_SUBJECT=mailto:admin@example.invalid
WEB_PUSH_PUBLIC_KEY=
WEB_PUSH_PRIVATE_KEY=
WEB_PUSH_ALLOWED_ENDPOINT_HOSTS=fcm.googleapis.com,updates.push.services.mozilla.com,web.push.apple.com,webpush.push.apple.com
INVITATION_EMAIL_ENABLED=false
NOTIFICATION_EMAIL_ENABLED=false
INVITATION_PUBLIC_BASE_URL=https://app.example.net
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
RECOVERY_ADMIN_ENABLED=false
ALLOWED_ORIGIN=https://app.example.net
```

Web Push is optional. Leave `WEB_PUSH_PUBLIC_KEY` and
`WEB_PUSH_PRIVATE_KEY` empty to keep confirmation reminders in-app only. When
enabling Push, generate VAPID keys outside the repository and keep the private
key in the deployment environment only. Keep
`WEB_PUSH_ALLOWED_ENDPOINT_HOSTS` restricted to browser push-service hosts; do
not add private infrastructure, loopback hosts, or broad wildcard domains.

Invitation email delivery is optional. Leave `INVITATION_EMAIL_ENABLED=false`
unless a reviewed SMTP relay is available. If enabled, keep `SMTP_PASSWORD`
only in private deployment state and set `INVITATION_PUBLIC_BASE_URL` to the
public HTTPS app origin that invited users open.

Care-confirmation email is independently optional. Leave
`NOTIFICATION_EMAIL_ENABLED=false` unless the same reviewed SMTP relay may send
generic task notices to current account addresses. Users must opt in inside the
application. The message link is derived from `ALLOWED_ORIGIN`; no care details
or credentials are included.

Recovery admin is optional and disabled by default. If you deliberately enable
it as an emergency identity-provider fallback, prefer a mounted secret file over
placing the initial password in `app.env`:

```yaml
services:
  betreuungskalender:
    volumes:
      - ./secrets/recovery-admin-password:/run/secrets/recovery-admin-password:ro
```

The matching private `app.env` values are:

```dotenv
RECOVERY_ADMIN_ENABLED=true
RECOVERY_ADMIN_USERNAME=breakglass
RECOVERY_ADMIN_INITIAL_PASSWORD_FILE=/run/secrets/recovery-admin-password
RECOVERY_ADMIN_INITIAL_PASSWORD=
RECOVERY_ADMIN_SESSION_TTL_SECONDS=900
```

Open `/auth/recovery` only when the identity provider is unavailable. The first
login forces a password change before admin API access is granted. Remove or
rotate the mounted bootstrap secret afterwards and disable recovery again when
it is not needed.

Use `HOST_BIND_ADDRESS=127.0.0.1` when the TLS reverse proxy runs on the same
host. With rootless Podman behind a proxy on another host or VM, bind to the VM
address or all interfaces only when firewall or proxy policy restricts access
to the intended path.

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

## Backup

For SQLite:

```bash
docker compose exec betreuungskalender /nodejs/bin/node scripts/backup.js
docker compose exec betreuungskalender /nodejs/bin/node scripts/restore-check.js
```

Copy backups to protected external storage according to the container engine's
volume procedures. PostgreSQL requires an operator-managed logical backup and
tested restore; do not run these SQLite scripts in PostgreSQL mode. Portable
JSON transfer remains separate from the operational backup for either driver.

## Update

For the production bind-mount layout, use the checksummed archive and
update procedure in [update.md](update.md). It validates a pre-update backup,
runtime version, readiness, migrations, and SQLite integrity before accepting a
new release, and restores both runtime and database on failure. Keep the prior
release directory until the new runtime has been verified.

The archive updater refuses PostgreSQL installations. Use the manual
PostgreSQL update gate in [database backends](database-backends.md), including a
tested pre-update logical backup.

## Rollback

1. Stop the updated container without deleting its data or backup volumes.
2. Restore the pre-update SQLite backup if a migration is not backward
   compatible.
3. Start the previously verified image or rebuild the previous tag.
4. Confirm `/api/health`, authentication boundaries, and the UI smoke test.

For PostgreSQL, revert the runtime only when the migrated schema remains
compatible. Otherwise stop the application and restore the tested pre-update
database before starting the previous runtime. Never use a container rollback
as a substitute for a tested database restore.

## Registry publication

Published GitHub releases also publish a release runtime image to GitHub
Container Registry:

```text
ghcr.io/hackepeter87/betreuungskalender:vX.Y.Z
ghcr.io/hackepeter87/betreuungskalender:X.Y.Z
```

Release publication does not update `latest`. The `latest` tag is a production
alias and is updated only by the production promotion workflow together with
`production`. Use `testing` and `production` through the promotion workflows,
and prefer the immutable digest reference recorded in the release asset
`betreuungskalender-vX.Y.Z.image-digest.txt` when auditing a promotion.

For `v1.2.0`, the digest was backfilled manually and recorded in
`betreuungskalender-v1.2.0.image-digest.txt` on the GitHub release. The
published tags are:

```text
ghcr.io/hackepeter87/betreuungskalender:v1.2.0
ghcr.io/hackepeter87/betreuungskalender:1.2.0
```

Because `latest` represents production, publishing a release does not update it.
Only the production promotion workflow may move `latest`.

The archive-based update flow remains supported. For image-based operations,
use the promotion procedure and the dedicated testing or production Compose
files so machines pull a reviewed channel tag instead of building locally. Keep
registry credentials outside the repository.

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

For normal image-based Compose deployments, copy `deploy/compose.testing.yml`
or `deploy/compose.production.yml` to the target host as `compose.yml` and keep
local deployment values in private `app.env`. For trusted-proxy deployments,
keep the app container private and expose only the separately managed
authentication proxy.

After starting an image-based deployment, run the same runtime verification as
for archive deployments:

```bash
podman exec betreuungskalender /nodejs/bin/node scripts/runtime-verify.js --expected-version X.Y.Z
```

The image does not remove the need for a verified driver-appropriate backup,
restore test, auth-boundary check, and rollback plan before production updates.

For reverse-proxy authentication, remove the public port mapping where possible
and attach the app only to a private proxy network.
