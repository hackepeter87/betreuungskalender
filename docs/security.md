# Security and privacy

## Intended use

Betreuungskalender is a private self-hosted documentation application. It is
not a multi-tenant cloud service and does not provide legal advice.

## Kubernetes boundary

The Helm chart runs the release image as a non-root user with a read-only root
filesystem, dropped capabilities, disabled service-account token mounting and
separate writable data, backup and temporary mounts. It enforces one application
pod and a `Recreate` rollout because SQLite is a single-writer deployment
boundary. Kubernetes Secrets must be referenced rather than copied into values
files or ConfigMaps. Cluster-specific ingress, egress, storage encryption and
backup-copy policies remain deployment responsibilities. See
[deployment-helm.md](deployment-helm.md).

## Stored data

Depending on use, the application may store:

- Child names or aliases and birth month/year
- Care times, locations, handovers, notes, and evidence references
- Trips, costs, holiday periods, and unavailable periods
- Audit identities and change history
- Monthly closure summaries
- Personal calendar feed token hashes
- Optional app-user to care-party assignments for shared operation
- Optional Web Push subscription endpoints for confirmation reminders

The React UI reads and writes domain data only through the Fastify API and its
SQLite database. Browser local storage is limited to non-sensitive UI
preferences; it is not a domain-data store or backup surface.

## Exports and backups

SQLite databases, JSON backups, CSV exports, and PDF reports may contain highly
sensitive family data. Protect them with disk encryption, restrictive file
permissions, access-controlled backup storage, and a tested deletion policy.
Do not send them unencrypted or upload them to public issue trackers.

Administrative data-replacement paths are intentionally narrower than normal
domain editing. `/api/app-data`, `/api/migration/*`, member administration,
care-party assignments, and demo-data loading require owner permissions.
Non-owner members cannot reset, import, migrate, or replace app data. Export-like
API routes require authentication and use the stricter export rate-limit class;
calendar feed URLs are the only unauthenticated export surface and are scoped
bearer secrets, not general API credentials.

Portable instance-transfer export, preview, dry run, import, actor mapping, and
transfer-linked invitations are owner-only and use the sensitive-operation rate
limit. JSON body size, structure depth, object width, string length, and total
record count are bounded before import. A dry run uses the same import core in
an in-memory current-schema SQLite database, performs integrity and relationship
checks, and leaves the target database unchanged. The real import repeats every
validation, requires the exact tested fingerprint, and commits domain
replacement atomically.
The successful dry run returns a short-lived server-signed confirmation, so a
caller cannot substitute a self-computed checksum for the required test run.
The confirmation is held by the browser only and is invalid after expiry or a
server restart.

Transfer responses are marked `no-store`. Logs and generic errors do not include
package contents, fingerprints, actor details, tokens, or validation payloads.
Transfer packages exclude OIDC subjects and claims, sessions, onboarding and
feed tokens, push subscriptions, recovery credentials, runtime secrets, and
private external-calendar feed URLs. Historical actors receive no access until
the owner explicitly maps them or creates an invitation.

The optional downloadable transfer review is generated in the browser and
contains only versions, aggregate counts, named check outcomes, warning counts,
a shortened fingerprint, and its creation time. It excludes names, email
addresses, domain content, complete identifiers, URLs, claims, tokens, and the
short-lived dry-run receipt. Dry-run review details are not persisted as an
import-history log.

Personal iCalendar feed URLs are bearer secrets. The application stores only a
hash of the token, but anyone with the generated URL can read that feed until
it is revoked. Feeds may cover all visible entries or one selected care party.
Rotate or revoke the URL from settings if it may have been shared
unintentionally.

## Network and authentication

- Use HTTPS at the reverse proxy.
- Set `REQUIRE_AUTH=true` in production.
- Set `AUTH_MODE=trusted-proxy` and `TRUST_PROXY_AUTH=true` only behind a
  trusted authentication proxy.
- Set `TRUSTED_PROXY_CIDRS` to the actual proxy source address or private proxy
  network so identity headers are ignored from unexpected socket sources. Use
  IP addresses or CIDR ranges only; container or DNS names are not trusted
  identity boundaries.
- Block all direct access that could bypass oauth2-proxy.
- In oauth2-proxy, set `trusted_ips` only to the actual upstream reverse proxy
  IP/CIDR. Never trust all client networks.
- Restrict `ALLOWED_ORIGIN` to the exact public origin.
- Keep API rate limits enabled and tune their documented environment variables
  only after reviewing expected client traffic. Imports, migrations, exports,
  and writes intentionally have stricter limits than normal API reads.
- Keep the host, minimal Node.js 24 runtime, npm build toolchain, proxy, Keycloak,
  and container images updated.

Native OIDC is introduced as the v1.4 target architecture. The native callback
path uses Authorization Code + PKCE, server-side state/nonce/PKCE verifier
records, and the maintained `openid-client` library for protocol validation.
Native sessions use an opaque `HttpOnly`, `SameSite=Lax` cookie. In production
the cookie is also `Secure`. SQLite stores only a hash of the cookie token,
the OIDC subject, timestamps, expiry, and revocation metadata. Native mode maps
validated OIDC claims into `app_users`, derives roles from configured groups,
and rejects users without a matching role group by default. Keep the current
trusted-proxy / oauth2-proxy path available as the known-good rollout and
rollback mode until native OIDC has been verified in the live environment.
Native mode rejects conflicting `TRUST_PROXY_AUTH=true` configuration and does
not accept proxy identity headers as an API authentication bypass.

Trusted-proxy authentication is a transition and rollback mode once native OIDC
is live. Do not remove it, delete oauth2-proxy configuration, or remove the old
Keycloak redirect URI during the first native rollout. After native login,
claim-based roles, logout, session expiry, runtime verification, and audit
identity have been verified in production, make a separate release decision
whether trusted-proxy remains supported or is removed in a later milestone.

Recovery admin is a disabled-by-default break-glass path for identity-provider
outages. Enable it only through deliberate deployment configuration, preferably
with `RECOVERY_ADMIN_INITIAL_PASSWORD_FILE` mounted as a secret. The bootstrap
password only permits setting a new recovery password; normal admin API access
requires the changed recovery password and a valid short-lived server-side
recovery session. Do not expose the recovery URL in the normal UI, do not store
the bootstrap secret in the repository, and disable or rotate it after use.

## Application hardening

The server uses CSP and common security headers, restrictive CORS, redaction of
proxy identity headers, production-safe error responses, prepared SQLite
statements, validation, and an unprivileged container user. It does not use
external analytics, tracking services, or CDN runtime dependencies.

The current review baseline, implemented controls, residual risks, and deferred
security work are summarized in [security-baseline.md](security-baseline.md).

Calendar feed tokens grant access only to the read-only `.ics` endpoint. They
are not accepted for `/api/*` routes. Feed output excludes notes, evidence
references, trips, costs, audit metadata, deleted entries, and cancelled
entries. Existing legacy feed tokens retain their original user-created scope;
new scoped tokens can be rotated per all-calendar or care-party scope.

External calendar imports and external calendar feed URLs are treated as
untrusted input. The server parses ICS data with `ical.js`, rejects oversized
calendars, excessive event counts, unsupported recurrence rules, invalid date
ranges, and overlong text fields, and returns only generic error codes for
rejected sources. URL feeds must use HTTPS, reject obvious local/private hosts,
are fetched with timeout and size limits, and are shown only in redacted form
because provider URLs can contain bearer-like query tokens. Imported summary,
description, and location values are stored as data and must not be logged or
rendered as trusted HTML.

Contact-rule writes and explicit synchronization use the normal write rate
limit and care-party authorization checks. Fully bounded rules are limited to
36 months before recurrence expansion to avoid excessive database work. The
sync remains idempotent and does not overwrite cancelled or manually changed
entries.

Historical contact-rule synchronization requires a server-generated preview
fingerprint and validates the selected range again during the write. Backfilled
past entries are excluded from automatic confirmation and push-reminder
creation; users review them in the authenticated application instead.

Derived care-conflict responses enforce fixed candidate, child-association,
and result budgets. When a complete overview cannot be produced within these
budgets, the API returns an explicit incomplete state instead of a partial
result. Actual-care write validation remains transactional and limits its query
to matching children and overlapping actual intervals.

Care-confirmation push messages remain generic and exclude child names, exact
times, notes, and other case details. When several confirmations become due in
the same sweep, the service sends at most one push per user while retaining all
individual tasks in the authenticated in-app notification view.

Care parties are domain records, not authentication principals. Optional
app-user to care-party assignments restrict non-admin shared users once at
least one assignment exists, but they do not replace `app_users.role`.

## Local security baseline checks

Run the local security baseline before security-sensitive changes and
release-adjacent work:

```bash
npm run security:check
```

The command combines the dependency audit, production-style runtime security
assertions, and release artifact validation:

- `npm audit --audit-level=high`
- `npm run test:security-runtime`
- `npm run release:check`

This intentionally reuses existing local checks instead of adding a heavyweight
scanner to every developer workflow. ZAP-style DAST is documented as an
optional local or staging review against fictional data only; it is not part of
default CI and must not be pointed at production. See
[security-review.md](security-review.md).

## Access-control baseline

Server-side authorization is enforced for `/api/*` routes before route
handlers run. UI visibility is only a convenience layer and must not be treated
as the security boundary.

The workspace-scoped role model and complete protected route classification
are defined in [ADR 0005](adr/0005-workspace-permissions.md) and the
[API permission inventory](api-permissions.md). New protected routes must
declare a recognized named permission; omission is a denial, not a fallback to
the request method.

| Capability | Owner | Admin | Editor | Scheduler | Viewer |
| --- | --- | --- | --- | --- | --- |
| Appointment and basic child view | Allowed | Allowed | Allowed | Reduced response | Reduced response |
| Normal appointment writes | Allowed | Allowed | Allowed | Future assigned planning only | `403` |
| Sensitive child data and notes | Allowed | Allowed | Allowed | `403` | `403` |
| Settings and exports | Allowed | Allowed | `403` | `403` | `403` |
| Member and destructive administration | Allowed | `403` | `403` | `403` | `403` |

Calendar feed bearer tokens never authenticate general API routes. Scheduler
and viewer clients use dedicated summary and schedule endpoints; sensitive
fields are removed before serialization rather than hidden by the browser.

Native OIDC ordinary login requires an active application membership.
Configured identity-provider groups do not establish workspace access in this
mode. Trusted-proxy mode can use configured groups as a compatibility source
before an owner exists. Once `setup.ownerUserId` exists, the latest membership
record is authoritative in every production auth mode: an active membership
grants its workspace role, a deleted membership revokes access, and a missing
membership grants no workspace access.

Trusted-proxy first-use setup requires the configured admin group. Parent,
viewer, and missing-role fallback identities cannot establish the owner.

Member administration is owner-scoped. Once `setup.ownerUserId` exists, only
that app user can create or revoke invitations and change application
membership roles. Existing installations without an explicit owner use the
secret-backed owner setup link to establish ownership explicitly without
changing existing domain data.

Application invitations use one-time bearer tokens. The server stores only a
SHA-256 token hash, expiry, revocation status, target role, and acceptance
metadata. Treat raw invitation URLs like passwords: they are shown only at
creation time and should be shared through a trusted channel. Manual sharing
and optional email delivery use the same complete URL. There is no separate
code-entry API.

Optional invitation email delivery sends the same bearer invitation link
through an operator-configured SMTP relay. Keep `INVITATION_EMAIL_ENABLED`
disabled until `SMTP_HOST`, `SMTP_FROM`, TLS mode, and any SMTP credentials are
configured in private deployment state. SMTP passwords must never be committed
or placed in release artifacts. The setup installation label is used as the
sender display name when available; the actual sender mailbox still comes from
`SMTP_FROM`. Delivery errors returned to owners must remain generic and must not
include raw tokens, SMTP credentials, relay hostnames, or provider stack traces.

Fresh native-OIDC installations require the explicit, secret-backed owner setup
link. The validated callback creates the initial admin membership and owner
designation; the guided first-use wizard then records application defaults.
Ownerless existing installations can use the same link without recreating
domain data. The action is audited and becomes unavailable once an owner exists.

The exact native-OIDC `GET` routes `/setup`, `/setup/continue`, `/invite`, and
`/invite/continue` are controlled token entry points and must reach their
server-side validation handlers before the authenticated SPA fallback. Their
reachability is not workspace authorization: the one-time token, OIDC context,
callback validation, and resulting membership remain mandatory. Unknown
subpaths and ordinary browser routes remain protected.

The full self-hosted setup, owner, member, and invitation model is documented
in [self-hosted-onboarding.md](self-hosted-onboarding.md).

Care confirmation push notifications are deliberately generic. Push payloads
must not include child names, exact care times, locations, notes, evidence
references, costs, trips, or other sensitive case details. Store VAPID private
keys only as deployment secrets such as environment variables; never commit
them to the repository or write them into release artifacts. Push subscription
endpoints are user-controlled input, so the server only accepts HTTPS endpoints
whose host is configured in `WEB_PUSH_ALLOWED_ENDPOINT_HOSTS`. Keep that list
limited to real browser push providers and do not add internal, loopback, or
wildcard domains.

The UI references external evidence by name only; it does not upload or store
evidence files.

## Logging

Set `LOG_LEVEL=info` or `warn` in production. Request bodies are not logged by
default. Authentication and cookie headers are redacted. Native OIDC tokens,
authorization codes, state, nonce, PKCE verifiers, raw claims, and client
secrets must not be logged. Native session cookie values and raw session
tokens must not be logged; store only their hashes server-side. Recovery admin
passwords, password hashes, salts, bootstrap secrets, session cookie values,
and raw recovery tokens must not be logged. Do not add
names, notes, evidence references, exported data, or full request bodies to
routine logs.

Calendar feed request paths redact the token segment before application
request metadata is logged. Setup and invitation browser links redact their
entire query string so bearer tokens and adjacent parameters do not enter
application request logs. Reverse proxies may still log the full URL unless
configured otherwise.

Initial owner setup uses a one-time bearer value from a mounted secret file.
Only its SHA-256 hash, validity window, and consumption metadata are stored in
SQLite. The link is accepted only while first-use setup is incomplete and the
authenticated OIDC subject is bound to the resulting owner membership. The raw
value must not be placed in environment files or logs. The mounted secret is
validated again before the owner membership is assigned, so replacing or
removing the file invalidates an unfinished setup flow. Setup and invitation
landing pages and redirects are returned with explicit no-store cache headers.

Before the first owner is established, trusted-proxy mode may use configured
groups for its documented compatibility role. Native OIDC always requires an
active app membership for normal login. Only a validated owner-setup or
invitation context may establish the matching membership. Rejected login,
setup, and invitation responses are returned without caching, and rejected
callbacks clear any existing app session cookie.

## Operator responsibility

The operator remains responsible for server hardening, TLS, authentication,
firewall rules, physical security, encrypted storage, backup protection,
retention, incident response, and compliance with applicable privacy rules.
