# Security and privacy

## Intended use

Betreuungskalender is a private self-hosted documentation application. It is
not a multi-tenant cloud service and does not provide legal advice.

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
domain editing. `/api/app-data`, `/api/migration/*`, app-user administration,
care-party assignments, and demo-data loading require an admin role. Readonly
and parent users must not be able to reset, import, migrate, or replace app
data. Export-like API routes require authentication and use the stricter export
rate-limit class; calendar feed URLs are the only unauthenticated export
surface and are scoped bearer secrets, not general API credentials.

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
- Keep the host, Node.js 24 LTS runtime, npm 11 toolchain, proxy, Keycloak,
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

External calendar imports are local file imports and are treated as untrusted
input. The server parses ICS files with `ical.js`, rejects oversized calendars,
excessive event counts, unsupported recurrence rules, invalid date ranges, and
overlong text fields, and returns only generic error codes for rejected files.
Imported summary, description, and location values are stored as data and must
not be logged or rendered as trusted HTML.

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

| Request class | Unauthenticated | Readonly | Parent | Admin |
| --- | --- | --- | --- | --- |
| `/api/health`, `/api/ready`, `/api/session` | Allowed for health or session discovery | Allowed | Allowed | Allowed |
| Protected domain reads, such as children, entries, care parties, rules, holidays, reports, and settings reads | `401` | Allowed | Allowed | Allowed |
| Normal domain writes, such as children, entries, care parties, rules, holidays, unavailability, settings writes, and confirmation actions | `401` | `403` | Allowed | Allowed |
| Administrative app-data operations, legacy migration endpoints, app-user administration, care-party assignments, instance readiness details, and demo-data loading | `401` | `403` | `403` | Allowed |
| Calendar feed token endpoint | Token scoped to the feed only | Token scoped to the feed only | Token scoped to the feed only | Token scoped to the feed only |

`readonly` users are intended for review-only access. `parent` users can manage
normal care documentation but cannot administer imports, resets, migrations,
users, or care-party assignments. `admin` users can perform those
administrative actions when request input is valid. Calendar feed bearer tokens
never authenticate general API routes.

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
request metadata is logged. Reverse proxies may still log the full URL unless
configured otherwise.

## Operator responsibility

The operator remains responsible for server hardening, TLS, authentication,
firewall rules, physical security, encrypted storage, backup protection,
retention, incident response, and compliance with applicable privacy rules.
