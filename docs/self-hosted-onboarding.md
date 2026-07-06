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
browser storage. After the first successful sign-in, the app can guide the user
through the initial setup flow.

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

## Identity and authorization model

OIDC or trusted-proxy authentication identifies the signed-in user. The app
maps that stable external identity to an internal `app_users` record.

Application authorization is then resolved in this order:

1. Active application membership for the internal user.
2. Configured identity-provider group or role claim as compatibility fallback.
3. No matching role: reject access, except for the restricted fresh-setup path.

This keeps the identity provider responsible for authentication while the app
can manage its own roles for the self-hosted installation.

The application roles are:

| Role | Access |
| --- | --- |
| `admin` | Read, write, member administration, imports, app-data operations, and migration endpoints |
| `parent` | Read and ordinary domain writes |
| `readonly` | Read-only access |

Care parties are domain records, not login identities. They describe the
caregiving context of entries and calendar feeds. Optional app-user to
care-party assignments can restrict non-admin shared users once assignments
exist.

## Owner and member administration

Once `setup.ownerUserId` is set, only that owner can administer members and
invitations. Existing installations without an explicit owner retain an admin
fallback so upgrades remain operable until ownership is set.

In Settings, the owner can:

- list known app users
- create one-time invitations
- assign an application role to the invitation
- revoke pending invitations
- update or remove explicit app roles for other users

Users cannot elevate their own role through member administration.

## Invitation lifecycle

Invitations are app-owned one-time bearer codes. The raw code is shown only at
creation time.

The server stores:

- a hash of the invitation token
- target role
- optional email hint
- expiry and revocation state
- accepted user and acceptance timestamp
- audit metadata

A user must authenticate first, then accept the invitation in the app. Expired,
revoked, already accepted, or malformed invitations are rejected.

## Invitation email delivery

Invitation email delivery is optional. Without SMTP configuration, owners can
copy the one-time code manually.

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
