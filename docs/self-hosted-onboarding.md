# Self-hosted onboarding and member administration

This guide describes the application-level first-use setup, owner bootstrap,
memberships, invitations, and readiness checks for a self-hosted
Betreuungskalender installation.

It is intentionally limited to app behavior. Configure TLS, firewalling,
reverse proxies, identity providers, backups, and host updates according to
your deployment environment and the security guidance in
[security.md](security.md).

## First-use setup

A fresh installation is detected from server-side SQLite state, not from
browser storage. Native OIDC first establishes the owner through the one-time
owner setup link and then guides that owner through the initial setup flow.

The setup flow covers:

- confirming the installation owner
- choosing an installation label for the app UI
- creating initial child records
- creating or selecting care parties
- setting default care location and handover values
- discovering calendar import and personal calendar-feed options

Setup completion is explicit and audited. After setup is complete, later users
cannot claim ownership through the same first-use flow.

The normal `/api/session` response exposes only minimal setup state for the UI:
whether setup is complete and whether setup is currently required. Detailed
instance-readiness information is restricted to admin users in Settings.

### Initial owner link with native OIDC

For a fresh native OIDC installation, generate a random owner setup value
outside the repository and write it to a private file. Mount that file read
only at the path configured by `OWNER_SETUP_TOKEN_FILE`:

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

Open the one-time URL using the exact value from that file:

```text
https://betreuung.example.net/setup?token=<one-time-value>
```

The landing page validates the link before offering the sign-in action. After
the validated OIDC callback, the authenticated user receives the owner/admin
membership. On a fresh database, the setup wizard remains open until the
required app data is completed. On an existing installation without an owner,
the same link establishes ownership and opens the existing app without changing
children, care parties, rules, entries, or settings. The link expires according
to `OWNER_SETUP_TOKEN_TTL_SECONDS`, can be used only once, and is rejected after
an owner has been established.

The exact `GET /setup` and `GET /setup/continue` routes are controlled public
entry points so the server can validate the one-time value before beginning
OIDC. They do not grant application access by themselves. Ordinary application
pages, unknown setup subpaths, and normal OIDC login still require an active
application membership.

Keep the secret file mounted and unchanged until the authenticated owner claim
has completed. Replacing or removing it invalidates an unfinished flow. After
the claim succeeds, remove the mounted file.

Do not put the value itself in `.env`, Compose YAML, shell history, issue text,
or application logs. Replace the file to issue a new link when an unfinished
flow must be discarded.

## Identity and authorization model

OIDC or trusted-proxy authentication identifies the signed-in user. The app
maps that stable external identity to an internal `app_users` record.

Application authorization is then resolved in this order:

1. Native OIDC requires an active application membership for ordinary login.
2. The validated owner-setup and invitation flows may create exactly the
   corresponding application membership.
3. Trusted-proxy mode may use configured identity-provider groups as a
   compatibility source before an owner exists.
4. A missing or deleted membership grants no native-OIDC workspace access.

Trusted-proxy first-use setup requires the configured admin group. Parent,
viewer, and missing-role fallback identities cannot complete it. Local mode
retains its development-oriented first-use behavior.

This keeps the identity provider responsible for authentication while the app
can manage its own roles for the self-hosted installation.

The workspace roles are:

| Role | Access |
| --- | --- |
| Owner (`admin` membership) | All capabilities, including membership and destructive administration |
| `admin` | Normal data, settings, reports, and exports; no member or destructive administration |
| `editor` | Children, planning, appointments, reports, and own feeds; no settings or administration |
| `scheduler` | Reduced appointment view and future planning for assigned care parties |
| `viewer` | Reduced read-only appointment view |

Care parties are domain records, not login identities. They describe the
caregiving context of entries and calendar feeds. Optional app-user to
care-party assignments can restrict non-admin shared users once assignments
exist.

## Owner and member administration

Once `setup.ownerUserId` is set, only that owner can administer members and
invitations. Existing installations without an explicit owner use the
secret-backed owner setup link to establish ownership without rerunning the
first-use data wizard.

In Settings, the owner can:

- list known app users
- create one-time invitations
- assign an application role to the invitation
- revoke pending invitations
- update or remove explicit app roles for other users

Users cannot elevate their own role through member administration.

## Invitation lifecycle

Invitations are app-owned one-time bearer links. The complete link is shown only
at creation time.

The exact `GET /invite` and `GET /invite/continue` routes remain reachable for
the same reason as owner setup: the application must validate and bind the
one-time invitation before OIDC begins. Missing, invalid, expired, revoked, or
used invitations do not create a login context or application session.

The server stores:

- a hash of the invitation token
- target role
- optional email hint
- expiry and revocation state
- accepted user and acceptance timestamp
- audit metadata

Opening an invitation link first shows a neutral landing page. Continuing from
that page starts native OIDC login and accepts the invitation after the
validated callback. Expired, revoked, already accepted, or malformed links
show an understandable error without exposing the raw token. The link and its
validated OIDC callback are the only invitation acceptance path.

## Invitation email delivery

Invitation email delivery is optional. Without SMTP configuration, owners can
copy the complete one-time link manually.

When email delivery is enabled:

- `INVITATION_PUBLIC_BASE_URL` must be the public HTTPS app origin users open
  in the browser.
- `SMTP_FROM` must be an operator-controlled sender accepted by the SMTP relay.
- SMTP credentials must stay in private deployment state.
- Delivery failures are reported generically and do not expose SMTP hostnames,
  credentials, provider errors, or invitation tokens.

The email contains the same one-time bearer invitation link that manual sharing
would provide. Treat sent invitation email like any other password-equivalent
delivery channel.

The identity provider confirms who signed in. The application independently
decides whether that identity has access to this installation. After an owner
exists, ordinary OIDC login without an active membership is rejected even when
provider-side groups are present. A validated owner-setup or invitation link is
required to create the corresponding membership.

## Upgrade compatibility

Existing installations keep their current authorization behavior after an
upgrade:

- active app memberships are migrated to the fixed workspace roles
- native OIDC ordinary login always requires an active app membership
- trusted-proxy installations may retain configured group compatibility before
  an owner exists
- installations without an explicit owner can use the owner setup link without
  changing existing domain data
- users without an active membership have no native-OIDC workspace access
- existing invitations and sessions remain valid according to their original
  expiry and revocation state
- an installation with an existing owner cannot be claimed through another
  owner setup link

Do not remove working group mappings during the same update that introduces
app memberships. Verify owner access and a second member login first, then
tighten provider-side group assignments in a separate change.

## Recommended first-run checklist

Before exposing a self-hosted installation beyond local evaluation:

1. Set `REQUIRE_AUTH=true`.
2. Choose one authentication mode: `native-oidc` or `trusted-proxy`.
3. Set `ALLOWED_ORIGIN` to the exact public HTTPS origin.
4. Confirm `/api/health` and `/api/ready` are reachable through the intended
   path only.
5. Sign in and complete first-use setup.
6. Confirm the owner appears in member administration.
7. Create a short-lived test invitation and accept it with a second test user.
8. Revoke any unused test invitation.
9. Run a backup and restore check.
10. Review Settings -> instance information as an admin.

For native OIDC setup, see
[native-oidc-keycloak-podman.md](native-oidc-keycloak-podman.md). For
trusted-proxy deployments, see [reverse-proxy.md](reverse-proxy.md) and
[keycloak-oauth2-proxy.md](keycloak-oauth2-proxy.md).
