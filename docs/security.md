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

The React UI reads and writes domain data only through the Fastify API and its
SQLite database. Browser local storage is limited to non-sensitive UI
preferences; it is not a domain-data store or backup surface.

## Exports and backups

SQLite databases, JSON backups, CSV exports, and PDF reports may contain highly
sensitive family data. Protect them with disk encryption, restrictive file
permissions, access-controlled backup storage, and a tested deletion policy.
Do not send them unencrypted or upload them to public issue trackers.

## Network and authentication

- Use HTTPS at the reverse proxy.
- Set `REQUIRE_AUTH=true` in production.
- Set `TRUST_PROXY_AUTH=true` only behind a trusted authentication proxy.
- Block all direct access that could bypass oauth2-proxy.
- Restrict `ALLOWED_ORIGIN` to the exact public origin.
- Keep API rate limits enabled and tune their documented environment variables
  only after reviewing expected client traffic. Imports, migrations, exports,
  and writes intentionally have stricter limits than normal API reads.
- Keep the host, Node.js, proxy, Keycloak, and container images updated.

## Application hardening

The server uses CSP and common security headers, restrictive CORS, redaction of
proxy identity headers, production-safe error responses, prepared SQLite
statements, validation, and an unprivileged container user. It does not use
external analytics, tracking services, or CDN runtime dependencies.

The UI references external evidence by name only; it does not upload or store
evidence files.

## Logging

Set `LOG_LEVEL=info` or `warn` in production. Request bodies are not logged by
default. Authentication and cookie headers are redacted. Do not add names,
notes, evidence references, exported data, or full request bodies to routine
logs.

## Operator responsibility

The operator remains responsible for server hardening, TLS, authentication,
firewall rules, physical security, encrypted storage, backup protection,
retention, incident response, and compliance with applicable privacy rules.
