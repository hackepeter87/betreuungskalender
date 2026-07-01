# Image promotion deployment

This path is for operators that want stable machine configuration and updates
by pulling a promoted GHCR image. It is the recommended path for the
`bk-demo.saas-lab.de` testing machine and for production once the deployment has
moved away from archive-based Compose builds.

## Release channels

The image tags have fixed meanings:

| Tag | Meaning | Deployment target |
| --- | --- | --- |
| `vX.Y.Z` | Immutable release image and source of truth | Never edited |
| `testing` | Mutable tag promoted from a release after image validation | `bk-demo.saas-lab.de` |
| `production` | Mutable tag promoted from the tested digest | Production |
| `latest` | Alias for the currently promoted production digest | Production convenience tag |

Do not use `latest` in Compose files. Demo and production deployments must use
`testing` and `production` respectively so promotion state is explicit. The
`latest` tag is updated only by the production promotion workflow.

## Demo deployment

Create the deployment directory with private configuration and persistent data:

```bash
sudo mkdir -p /opt/svc_betreuung/betreuungskalender-demo/{data,backups}
sudo chown -R "$USER:$USER" /opt/svc_betreuung/betreuungskalender-demo
cd /opt/svc_betreuung/betreuungskalender-demo
```

Install `deploy/compose.testing.yml` as `compose.yml` and start from
`deploy/app.env.demo.example` as `app.env`. Replace the Keycloak issuer and
client secret with the private demo realm values. Keep `app.env` out of Git.

For `bk-demo.saas-lab.de`, the public native OIDC values are:

```dotenv
ALLOWED_ORIGIN=https://bk-demo.saas-lab.de
OIDC_REDIRECT_URI=https://bk-demo.saas-lab.de/auth/callback
AUTH_MODE=native-oidc
TRUST_PROXY_AUTH=false
```

The reverse proxy should terminate HTTPS and forward to the configured
`HOST_BIND_ADDRESS` and `HOST_PORT`. If the browser-visible URL includes a
non-default port, include that port in both `ALLOWED_ORIGIN` and
`OIDC_REDIRECT_URI`, and register the exact same values in Keycloak.

With rootless Podman, make the bind mounts writable for the image's unprivileged
`node` user:

```bash
mkdir -p data backups
podman unshare chown -R 1000:1000 data backups
podman unshare chmod 0750 data backups
```

Start or update the demo machine:

```bash
podman login ghcr.io
podman-compose --env-file app.env -f compose.yml pull
podman-compose --env-file app.env -f compose.yml up -d --force-recreate
podman-compose --env-file app.env -f compose.yml ps
```

Validate the runtime:

```bash
podman exec APP_CONTAINER node scripts/healthcheck.js
podman exec APP_CONTAINER node scripts/runtime-verify.js --expected-version X.Y.Z
curl -I https://bk-demo.saas-lab.de/auth/login
```

`/auth/login` must return a redirect to Keycloak. Unauthenticated API routes,
for example `/api/children`, must return `401`.

## Production deployment

Production installs `deploy/compose.production.yml` as `compose.yml` and uses
the production OIDC values in `app.env`:

```dotenv
AUTH_MODE=native-oidc
REQUIRE_AUTH=true
TRUST_PROXY_AUTH=false
ALLOWED_ORIGIN=https://betreuung.example.net
OIDC_REDIRECT_URI=https://betreuung.example.net/auth/callback
```

Before pulling a new production image, create and validate a backup inside the
currently running container:

```bash
podman-compose --env-file app.env -f compose.yml exec betreuungskalender npm run backup
podman-compose --env-file app.env -f compose.yml exec betreuungskalender npm run restore:check
podman-compose --env-file app.env -f compose.yml pull
podman-compose --env-file app.env -f compose.yml up -d --force-recreate
podman exec APP_CONTAINER node scripts/runtime-verify.js --expected-version X.Y.Z
```

Do not copy production data to the demo machine. Demo data must be synthetic and
persistent across updates so migrations and domain changes are exercised without
personal data leaving production.

The demo environment may set `DEMO_DATASETS_ENABLED=true`. Admin users then see
an additional settings action that replaces the current domain data with a
synthetic edge-case dataset. This is intended for demos and regression checks
only; keep the variable unset or `false` in production.

## GitHub promotion workflow

Release image publication still starts from a GitHub release for `vX.Y.Z`.
After the release image exists:

1. Run **Promote testing image** with the release tag, for example `v1.4.0`.
2. Update `bk-demo.saas-lab.de` and complete the technical and domain smoke
   tests.
3. Run **Promote production image** with the same release tag. The workflow
   fails if `testing` no longer points at the release digest and updates both
   `production` and `latest` to the tested digest.
4. Pull and restart production after backup and restore validation.

Both promotion workflows log the version, Git commit, channel tag, digest, and
immutable image reference in the GitHub Actions summary.
