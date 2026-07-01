# Native OIDC with Keycloak and Podman

Native OIDC lets Betreuungskalender handle the Authorization Code + PKCE login
flow directly. It does not require oauth2-proxy, does not trust identity
headers, and stores only an opaque server-side session cookie in the browser.

Use this path for a fresh v1.4-style installation behind an existing HTTPS
reverse proxy. Keep the oauth2-proxy trusted-proxy deployment available as the
rollback path until native OIDC has been verified in the live environment.
For existing oauth2-proxy deployments, follow
[native-oidc-migration-rollback.md](native-oidc-migration-rollback.md)
instead of treating the fresh-install steps as an in-place migration.

## Keycloak client

Create a dedicated OpenID Connect client for the app:

- Client ID: `betreuungskalender`
- Client type: confidential
- Standard Flow: enabled
- Direct Access Grants: disabled
- Client authentication: enabled
- Valid redirect URI: `https://app.example.net/auth/callback`
- Valid post logout redirect URI: `https://app.example.net/`
- Web origin: `https://app.example.net`
- Scopes: `openid email profile`
- MFA: recommended for every interactive user

Create the application groups with full paths:

```text
/betreuungskalender/admins
/betreuungskalender/parents
/betreuungskalender/readers
```

Add a group-membership mapper that emits the full group path in the ID token:

- Token claim name: `groups`
- Full group path: enabled
- Add to ID token: enabled

The app derives the role from the configured group values. If a user belongs to
multiple configured groups, the effective role is `admin` before `parent`
before `readonly`.

## Podman Compose deployment

Install the release archive layout from [update.md](update.md) and use
`deploy/compose.yml` as the runtime Compose file. Native OIDC uses the direct
app service; it does not use `deploy/compose.oidc.yml` and does not mount an
`oauth2-proxy.cfg`.

Example deployment shape:

```text
/opt/svc_betreuung/betreuungskalender/
  compose.yml
  .env
  data/
  backups/
  releases/
    vX.Y.Z/
```

For rootless Podman, run Compose from the deployment directory:

```bash
cd /opt/svc_betreuung/betreuungskalender
podman-compose --env-file .env -f compose.yml config
podman-compose --env-file .env -f compose.yml up -d --build
podman-compose --env-file .env -f compose.yml ps
```

Keep the app reachable only through the intended HTTPS reverse proxy. If the
proxy runs on the same host, bind the app to loopback. If the proxy runs outside
the Podman host or VM, bind to the VM address or all interfaces and restrict the
path with firewall and proxy rules.

## Native OIDC environment

Start from `.env.example` and use only placeholder-free private values in the
real `.env`. Do not commit the edited file.

```dotenv
NODE_ENV=production
APP_RELEASE_VERSION=X.Y.Z
APP_RELEASE_DIR=/opt/svc_betreuung/betreuungskalender/releases/vX.Y.Z
HOST_BIND_ADDRESS=127.0.0.1
HOST_PORT=3000

AUTH_MODE=native-oidc
REQUIRE_AUTH=true
TRUST_PROXY_AUTH=false
AUTH_LOGOUT_URL=

OIDC_ISSUER_URL=https://idp.example.net/realms/example
OIDC_CLIENT_ID=betreuungskalender
OIDC_CLIENT_SECRET=CHANGE_ME
OIDC_REDIRECT_URI=https://app.example.net/auth/callback
OIDC_POST_LOGOUT_REDIRECT_URI=https://app.example.net/
OIDC_SCOPES=openid email profile
OIDC_GROUPS_CLAIM=groups
OIDC_ADMIN_GROUP=/betreuungskalender/admins
OIDC_PARENT_GROUP=/betreuungskalender/parents
OIDC_READONLY_GROUP=/betreuungskalender/readers
OIDC_REQUIRE_ROLE_CLAIM=true

SESSION_COOKIE_NAME=betreuungskalender_session
SESSION_TTL_SECONDS=2419200
ALLOWED_ORIGIN=https://app.example.net
LOG_LEVEL=info
```

`OIDC_ISSUER_URL` must exactly match the Keycloak realm issuer. The redirect
URI must exactly match the public callback URI registered on the Keycloak
client. The post-logout redirect URI must also be registered on the Keycloak
client; otherwise Keycloak may reject provider logout after the app session is
cleared. `OIDC_CLIENT_SECRET` is a secret and belongs only in the private
`.env` or a reviewed secret-management mechanism.

Do not set `TRUST_PROXY_AUTH=true` in native mode. The application rejects that
combination because native OIDC must not accept forged proxy identity headers
as authentication.

## Reverse proxy

Terminate TLS at the existing reverse proxy and forward to the Podman host port
from `HOST_BIND_ADDRESS` and `HOST_PORT`. The public origin must match
`ALLOWED_ORIGIN`.

The reverse proxy does not need to inject identity headers for native OIDC. It
should still strip incoming `X-Auth-Request-*` and `X-Forwarded-*User/Email`
headers at the public edge so the same proxy remains safe if the deployment is
rolled back to trusted-proxy mode.

## Validation checklist

After starting the stack:

1. Confirm the app healthcheck from inside the container.

   ```bash
   podman exec betreuungskalender_betreuungskalender_1 node scripts/healthcheck.js
   ```

2. Confirm runtime version and migrations.

   ```bash
   podman-compose --env-file .env -f compose.yml exec betreuungskalender \
     npm run verify:runtime -- --expected-version X.Y.Z
   ```

3. Open `https://app.example.net` in a private browser session and confirm the
   app shows the login action.
4. Sign in through Keycloak and confirm the browser returns to `/`.
5. Request `/api/session` through the browser and confirm it reports the
   expected `displayName` and role without exposing raw tokens or claims.
6. Test one user per role: admin, parent, readonly, and a user without a
   configured group. The no-group user should be rejected while
   `OIDC_REQUIRE_ROLE_CLAIM=true`.
7. Use the app logout action and confirm the browser is redirected through
   Keycloak logout. A later app visit should require a fresh Keycloak login,
   not silently reuse the old SSO session.
8. Inspect application logs for OIDC failures only by error code and request
   ID. Logs must not contain authorization codes, tokens, session cookies,
   nonce values, PKCE verifiers, raw claims, or client secrets.

## Troubleshooting

- Provider discovery fails: verify the exact realm issuer URL from Keycloak and
  container host connectivity to it.
- Login loops or callback fails: verify the Keycloak redirect URI is exactly
  `https://app.example.net/auth/callback` and `OIDC_REDIRECT_URI` matches it.
- Logout returns to the app but immediately signs in again: verify the Keycloak
  client has `https://app.example.net/` configured as a valid post logout
  redirect URI and `OIDC_POST_LOGOUT_REDIRECT_URI` matches it.
- User gets `403`: verify the Keycloak ID token includes the configured
  `OIDC_GROUPS_CLAIM` with one of the full group paths.
- Session cookie is not accepted: verify the public URL uses HTTPS in
  production and the browser is on the same origin as `ALLOWED_ORIGIN`.
- Direct app access bypasses the reverse proxy: fix listener, firewall, or
  proxy routing before continuing the rollout.
