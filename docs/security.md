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

The React UI reads and writes domain data only through the Fastify API and its
SQLite database. Browser local storage is limited to non-sensitive UI
preferences; it is not a domain-data store or backup surface.

## Exports and backups

SQLite databases, JSON backups, CSV exports, and PDF reports may contain highly
sensitive family data. Protect them with disk encryption, restrictive file
permissions, access-controlled backup storage, and a tested deletion policy.
Do not send them unencrypted or upload them to public issue trackers.

Personal iCalendar feed URLs are bearer secrets. The application stores only a
hash of the token, but anyone with the generated URL can read that feed until
it is revoked. Rotate or revoke the URL from settings if it may have been
shared unintentionally.

## Network and authentication

- Use HTTPS at the reverse proxy.
- Set `REQUIRE_AUTH=true` in production.
- Set `AUTH_MODE=trusted-proxy` and `TRUST_PROXY_AUTH=true` only behind a
  trusted authentication proxy.
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

## Application hardening

The server uses CSP and common security headers, restrictive CORS, redaction of
proxy identity headers, production-safe error responses, prepared SQLite
statements, validation, and an unprivileged container user. It does not use
external analytics, tracking services, or CDN runtime dependencies.

Calendar feed tokens grant access only to the read-only `.ics` endpoint. They
are not accepted for `/api/*` routes. Feed output excludes notes, evidence
references, trips, costs, deleted entries, and cancelled entries.

The UI references external evidence by name only; it does not upload or store
evidence files.

## Logging

Set `LOG_LEVEL=info` or `warn` in production. Request bodies are not logged by
default. Authentication and cookie headers are redacted. Native OIDC tokens,
authorization codes, state, nonce, PKCE verifiers, raw claims, and client
secrets must not be logged. Native session cookie values and raw session
tokens must not be logged; store only their hashes server-side. Do not add
names, notes, evidence references, exported data, or full request bodies to
routine logs.

Calendar feed request paths redact the token segment before application
request metadata is logged. Reverse proxies may still log the full URL unless
configured otherwise.

## Operator responsibility

The operator remains responsible for server hardening, TLS, authentication,
firewall rules, physical security, encrypted storage, backup protection,
retention, incident response, and compliance with applicable privacy rules.
