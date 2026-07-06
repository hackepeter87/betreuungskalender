# Security baseline

This document records the current security baseline for the self-hosted
Betreuungskalender application. It is a practical operator and maintainer
baseline, not a formal penetration-test report.

## Scope reviewed

- Authentication modes: local development, trusted-proxy rollback, and native
  OIDC with server-side sessions.
- API authorization classes for unauthenticated, readonly, parent, and admin
  users.
- Shared care-context rules for app-user to care-party assignments.
- Administrative app-data, migration, demo-data, backup, restore, and export
  surfaces.
- Personal iCalendar feeds and feed-token handling.
- External calendar import and ICS parsing.
- Confirmation reminder notification paths and Web Push endpoint handling.
- Error handling, request logging, URL redaction, and sensitive query
  parameters.
- Release artifact checks, ignore rules, and local security validation scripts.

## Data protection baseline

The application is designed for private self-hosted use. It stores personal
family documentation such as care times, locations, notes, evidence references,
reports, exports, backups, audit history, and optional push subscription
endpoints. These records are sensitive even when they do not contain formal
legal documents.

Backups, SQLite databases, CSV exports, JSON exports, PDF reports, local
calendar files, logs, private keys, and real environment files must stay out of
the repository and release artifacts. Operators remain responsible for TLS,
host hardening, encrypted storage, backup retention, access control, and
incident response.

## Implemented controls

- Server-side authorization is enforced before protected `/api/*` route
  handlers run.
- Readonly users can read domain data but cannot write or administer the
  application.
- Parent users can manage normal care documentation but cannot reset, import,
  migrate, administer users, load demo data, or replace app data.
- Admin-only routes cover app-data replacement, migration endpoints,
  app-user administration, care-party assignments, and demo-data loading.
- Native OIDC uses Authorization Code + PKCE through `openid-client`,
  server-side state/nonce/verifier storage, and opaque hashed session tokens.
- Trusted-proxy authentication remains available as a rollback mode but is not
  accepted as a bypass in native OIDC mode.
- Recovery admin is disabled by default and, when explicitly enabled, uses a
  short-lived server-side session, scrypt password hash, and one-time bootstrap
  password-change flow.
- Care parties are domain records, not authentication principals. Shared
  care-party assignments restrict non-admin users once assignments exist, but
  `app_users.role` remains the authorization role source.
- Personal calendar feeds use bearer URLs only for the `.ics` endpoint. They do
  not authenticate general API routes and exclude notes, evidence references,
  trips, costs, audit metadata, deleted entries, and cancelled entries.
- External ICS imports and external calendar feed URLs are size-limited,
  count-limited, validated, rejected for unsupported recurrence, and returned
  with generic error codes on failure. Feed URLs must use HTTPS, reject obvious
  local/private hosts, and are shown only redacted because they can contain
  bearer-like provider tokens.
- Request URL logging redacts feed tokens and common OIDC or token query
  parameters.
- Release checks reject tracked and untracked sensitive artifacts such as real
  `.env` files, databases, backups, exports, logs, local archives, private
  keys, certificates, token material, oauth2-proxy configs, and local ICS files.
- The local security baseline command is available as `npm run security:check`.

## Local security commands

Run these before security-sensitive changes and release-adjacent work:

```bash
npm run security:check
npm run lint
npm run test
npm run build
```

`npm run security:check` combines:

- `npm audit --audit-level=high`
- `npm run test:security-runtime`
- `npm run release:check`

Use `npm run release:check:strict` only for release preparation after the
version, changelog, release notes, and tag state are ready.

## Residual risks and deferred work

- This is not a multi-tenant SaaS isolation model. The shared-operation model is
  intentionally limited to a trusted small group using roles and care-party
  assignments.
- Browser-side UI hiding is not a security boundary; server-side route checks
  must remain the source of truth.
- Web Push confirms care entries with privacy-preserving messages, but browser
  push providers still receive subscription metadata. Email notification
  delivery is deferred until a concrete mail transport and threat model exist.
- ZAP-style DAST is optional review work, not default CI. It may run only
  against a local or staging test instance with fictional data, as described in
  [security-review.md](security-review.md). It must not target production or
  real private deployments.
- Break-glass recovery reduces identity-provider outage risk but adds a
  high-value local credential. Operators should keep it disabled unless needed,
  prefer mounted secret files over environment fallbacks, and rotate or remove
  bootstrap material after first use.
- External security review is still recommended before wider internet exposure
  beyond a personally operated instance.

## Open review checklist

- Re-run the access-control runtime matrix after new route classes are added.
- Extend care-party shared-context tests when a feature writes care-party scoped
  data.
- Re-check release artifact deny rules when new file formats, exports, or
  deployment config files are introduced.
- Review notification payloads before adding new reminder types.
- Revisit whether local or staging DAST findings should become release gates
  after at least one documented test-instance scan has been reviewed.
