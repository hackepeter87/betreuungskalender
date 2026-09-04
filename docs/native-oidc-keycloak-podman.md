# Native OIDC with Keycloak and Podman

Native OIDC lets Betreuungskalender handle the Authorization Code + PKCE login
flow directly. It does not require oauth2-proxy, does not trust identity
headers, and stores only an opaque server-side session cookie in the browser.

Use this path for a fresh installation behind an existing HTTPS reverse proxy.
A fresh native installation does not need a parallel oauth2-proxy deployment.
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

Optional external group metadata can use full paths such as:

```text
/betreuungskalender/admins
/betreuungskalender/parents
/betreuungskalender/readers
```

If retaining this metadata, configure a group-membership mapper:

- Token claim name: `groups`
- Full group path: enabled
- Add to ID token: enabled

Native OIDC confirms identity; the app controls workspace access. The first
owner must use the one-time owner link. Other users need an active membership
or a valid invitation link. Groups never replace those requirements, including
before the first owner exists, and do not override an invitation's role.

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
WEB_PUSH_SUBJECT=mailto:admin@example.invalid
WEB_PUSH_PUBLIC_KEY=
WEB_PUSH_PRIVATE_KEY=
WEB_PUSH_ALLOWED_ENDPOINT_HOSTS=fcm.googleapis.com,updates.push.services.mozilla.com,web.push.apple.com,webpush.push.apple.com
INVITATION_EMAIL_ENABLED=false
INVITATION_PUBLIC_BASE_URL=https://app.example.net
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
ALLOWED_ORIGIN=https://app.example.net
LOG_LEVEL=info
```

`OIDC_ISSUER_URL` must exactly match the Keycloak realm issuer. The redirect
URI must exactly match the public callback URI registered on the Keycloak
client. The post-logout redirect URI must also be registered on the Keycloak
client; otherwise Keycloak may reject provider logout after the app session is
cleared. `OIDC_CLIENT_SECRET` is a secret and belongs only in the private
`.env` or a reviewed secret-management mechanism.

Web Push is optional for care confirmation reminders. Leave
`WEB_PUSH_PUBLIC_KEY` and `WEB_PUSH_PRIVATE_KEY` empty for in-app reminders
only. If Push is enabled, generate VAPID keys outside the repository and keep
the private key in the private `.env` or secret store. Keep the allowed
endpoint hosts restricted to browser push services so users cannot make the
server send outbound requests to arbitrary internal URLs.

Invitation email delivery is optional. Leave `INVITATION_EMAIL_ENABLED=false`
unless a reviewed SMTP relay is configured. If enabled, keep `SMTP_PASSWORD`
only in private deployment state and set `INVITATION_PUBLIC_BASE_URL` to the
public HTTPS app origin; invitation links contain one-time bearer tokens.

For a fresh installation, create and mount the one-time owner setup value. The
standard Compose file does not require this mount so existing installations can
continue unchanged:

```bash
mkdir -p secrets
openssl rand -base64 32 > secrets/owner-setup-token
chmod 600 secrets/owner-setup-token
```

```yaml
services:
  betreuungskalender:
    volumes:
      - ./secrets/owner-setup-token:/run/secrets/owner-setup-token:ro
```

Keep `OWNER_SETUP_TOKEN_FILE=/run/secrets/owner-setup-token`, open the
one-time `/setup?token=...` link, and remove the mounted file after the owner
claim succeeds. The setup value must not be placed in committed environment or
Compose files.

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
   podman exec betreuungskalender_betreuungskalender_1 /nodejs/bin/node scripts/healthcheck.js
   ```

2. Confirm runtime version and migrations.

   ```bash
   podman-compose --env-file .env -f compose.yml exec betreuungskalender \
     /nodejs/bin/node scripts/runtime-verify.js --expected-version X.Y.Z
   ```

3. Before creating the owner, attempt ordinary login from a private browser
   session. Confirm that it grants no workspace access, regardless of groups.
4. Open the valid owner link, continue through Keycloak, and complete the
   first-use wizard. See [self-hosted onboarding](self-hosted-onboarding.md).
5. Request `/api/session` through the authenticated browser and confirm it
   reports the expected `displayName`, workspace access, workspace role, and permissions
   without exposing raw tokens or claims.
6. Sign out and sign in again as the owner. Confirm that the established
   membership grants access independently of provider-side role groups.
7. After owner setup, verify one active application membership per supported
   role: admin, editor, scheduler, and viewer. Confirm that an authenticated
   identity without an active membership receives no workspace access.
8. Use the app logout action and confirm the browser is redirected through
   Keycloak logout. A later app visit should require a fresh Keycloak login,
   not silently reuse the old SSO session.
9. Inspect application logs for OIDC failures only by error code and request
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
- User gets `403`: verify the identity has an active application membership.
  For the first owner use the owner link; for a new member use an invitation.
  Adding a Keycloak group does not establish a membership.
- Session cookie is not accepted: verify the public URL uses HTTPS in
  production and the browser is on the same origin as `ALLOWED_ORIGIN`.
- Direct app access bypasses the reverse proxy: fix listener, firewall, or
  proxy routing before continuing the rollout.
