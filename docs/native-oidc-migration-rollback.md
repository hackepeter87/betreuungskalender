# Migrate from oauth2-proxy to native OIDC

This guide migrates an existing `compose.oidc.yml` deployment from
oauth2-proxy trusted headers to native OIDC. The safe migration keeps the old
oauth2-proxy configuration intact until native OIDC has been verified in the
live environment.

Do not remove trusted-proxy support, Keycloak redirect URIs, or
`oauth2-proxy.cfg` during the first migration window. They are the rollback
path.

## Preconditions

- A verified release that contains native OIDC support is installed.
- The current oauth2-proxy deployment is healthy.
- The operator can access the deployment directory and restart the Podman
  Compose stack.
- Keycloak can emit the configured group claim into the ID token.
- At least one admin user is assigned to the configured admin group before the
  switch.

The current trusted-proxy deployment should still validate before changing
auth mode:

```bash
cd /opt/svc_betreuung/betreuungskalender
podman-compose --env-file .env -f compose.oidc.yml ps
podman-compose --env-file .env -f compose.oidc.yml exec betreuungskalender \
  npm run verify:runtime -- --expected-version X.Y.Z
```

## Back up configuration first

Store the pre-migration configuration outside the container data directory.
Use a directory owned by the deployment operator, not a world-readable path.

```bash
cd /opt/svc_betreuung/betreuungskalender
install -d -m 0700 config-backups/pre-native-oidc
cp -p .env compose.oidc.yml oauth2-proxy.cfg \
  config-backups/pre-native-oidc/
chmod 0600 config-backups/pre-native-oidc/.env \
  config-backups/pre-native-oidc/oauth2-proxy.cfg
```

Also create and verify a SQLite backup before switching auth mode:

```bash
podman-compose --env-file .env -f compose.oidc.yml exec betreuungskalender \
  npm run backup
podman-compose --env-file .env -f compose.oidc.yml exec betreuungskalender \
  npm run restore:check
```

Do not edit `oauth2-proxy.cfg` for the native rollout. Keeping it unchanged
makes rollback faster and avoids rootless Podman ownership surprises.

## Prepare Keycloak

Keep the current oauth2-proxy client working. Either add native OIDC settings
to the same client or create a second confidential client for native OIDC. A
second client is easier to roll back because the old oauth2-proxy client secret
and redirect URI remain untouched.

For the native client:

- Standard Flow: enabled
- Direct Access Grants: disabled
- Valid redirect URI: `https://app.example.net/auth/callback`
- Web origin: `https://app.example.net`
- Scopes: `openid email profile`
- Group mapper claim name: `groups`
- Full group path: enabled
- Add groups to the ID token: enabled

Keep the existing oauth2-proxy redirect URI
`https://app.example.net/oauth2/callback` until native OIDC has been running
successfully and rollback is no longer required.

## Switch Compose topology

Native OIDC uses `compose.yml`, not `compose.oidc.yml`. Copy the direct Compose
file from the verified release if it is not already installed:

```bash
cp -p releases/vX.Y.Z/deploy/compose.yml compose.yml
```

Edit `.env` for native OIDC:

```dotenv
APP_COMPOSE_FILE=compose.yml
AUTH_MODE=native-oidc
REQUIRE_AUTH=true
TRUST_PROXY_AUTH=false
AUTH_LOGOUT_URL=

OIDC_ISSUER_URL=https://idp.example.net/realms/example
OIDC_CLIENT_ID=betreuungskalender
OIDC_CLIENT_SECRET=CHANGE_ME
OIDC_REDIRECT_URI=https://app.example.net/auth/callback
OIDC_SCOPES=openid email profile
OIDC_GROUPS_CLAIM=groups
OIDC_ADMIN_GROUP=/betreuungskalender/admins
OIDC_PARENT_GROUP=/betreuungskalender/parents
OIDC_READONLY_GROUP=/betreuungskalender/readers
OIDC_REQUIRE_ROLE_CLAIM=true
```

If the external TLS reverse proxy currently forwards to the oauth2-proxy host
port, you can keep the same `HOST_BIND_ADDRESS` and `HOST_PORT` for the first
native rollout. Stop the old `compose.oidc.yml` stack before starting
`compose.yml` so the port is free.

```bash
podman-compose --env-file .env -f compose.oidc.yml down
podman-compose --env-file .env -f compose.yml config
podman-compose --env-file .env -f compose.yml up -d --build
podman-compose --env-file .env -f compose.yml ps
```

If the TLS reverse proxy backend is changed to a different host port, update
that proxy only after `podman-compose ... config` has shown the intended port
binding.

## Verify native OIDC

Verify the runtime first:

```bash
podman-compose --env-file .env -f compose.yml exec betreuungskalender \
  npm run verify:runtime -- --expected-version X.Y.Z
```

Then verify authentication from a browser:

1. Open the public URL in a private browser window.
2. Confirm the app offers the native login action.
3. Sign in through Keycloak and confirm the callback returns to `/`.
4. Open `/api/session` and confirm the expected user and role.
5. Test admin, parent, readonly, and a user without configured groups.
6. Confirm readonly users cannot write.
7. Confirm logout clears the app session.
8. Inspect logs for only sanitized OIDC error codes and request IDs. Tokens,
   authorization codes, session cookies, raw claims, nonce values, PKCE
   verifiers, and client secrets must not appear.

Only after this checklist passes should native OIDC be treated as the active
production path.

## Roll back to oauth2-proxy

Rollback must be available before cleanup starts. Use it if native login fails,
role mapping is wrong, users lose access, or the external proxy cannot reach
the direct app service.

The restored `.env` must return to the trusted-proxy topology:

```dotenv
APP_COMPOSE_FILE=compose.oidc.yml
AUTH_MODE=trusted-proxy
REQUIRE_AUTH=true
TRUST_PROXY_AUTH=true
AUTH_LOGOUT_URL=/oauth2/sign_out
```

```bash
cd /opt/svc_betreuung/betreuungskalender
cp -p config-backups/pre-native-oidc/.env .env
cp -p config-backups/pre-native-oidc/compose.oidc.yml compose.oidc.yml
cp -p config-backups/pre-native-oidc/oauth2-proxy.cfg oauth2-proxy.cfg

podman-compose --env-file .env -f compose.yml down
podman-compose --env-file .env -f compose.oidc.yml up -d --build
podman-compose --env-file .env -f compose.oidc.yml ps
```

If rootless Podman reports `permission denied` while reading
`oauth2-proxy.cfg`, repeat the ownership handoff from
[deployment-container.md](deployment-container.md#rootless-podman-config-file-permissions).

After rollback, verify:

```bash
podman-compose --env-file .env -f compose.oidc.yml exec betreuungskalender \
  npm run verify:runtime -- --expected-version X.Y.Z
```

Then open the public URL and confirm the old `/oauth2/start` and
`/oauth2/callback` flow works again.

## Deferred cleanup

Do not delete these items during the first successful native rollout:

- `compose.oidc.yml`
- `oauth2-proxy.cfg`
- oauth2-proxy Keycloak client or redirect URI
- trusted-proxy environment reference
- config backup directory

Cleanup is a separate decision after native OIDC has run successfully in the
live environment and the operator has accepted the risk of losing the immediate
trusted-proxy rollback path.
