# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows semantic versioning where practical.

## [Unreleased]

## [1.2.0] - 2026-06-30

### Added

- Added actor metadata for children, trips, costs, holiday periods, contact
  rules, and monthly closures through migration `007_actor_metadata`.
- Added multi-user audit attribution coverage for trusted OIDC/proxy users.
- Added UI change metadata in domain lists so care entries, children, holidays,
  unavailable periods, and contact dates show who last changed them.

### Changed

- Audit log views now resolve internal user IDs to display names when the
  corresponding `app_users` record is available.
- Domain records preserve stable `createdBy` and `updatedBy` user IDs for
  follow-up collaboration features instead of relying only on audit rows.

### Security

- Existing role authorization remains enforced through the v1.1.0 trusted OIDC
  claim model.
- No tokens, secrets, or real deployment values are introduced by this release.

## [1.1.0] - 2026-06-30

### Added

- Added internal OIDC-backed `app_users` records with migration
  `006_oidc_users`.
- Added server-side authorization derived from trusted OIDC group claims.
- Added configurable OIDC identity, display-name, email, and group header
  names.
- Added admin, parent, and readonly permission levels for API access.

### Changed

- API audit identity now uses stable internal user IDs derived from the trusted
  OIDC subject instead of mutable display names or email addresses.
- Existing trusted-proxy deployments can keep working during the first rollout
  with `OIDC_REQUIRE_ROLE_CLAIM=false` until Keycloak/oauth2-proxy group headers
  are confirmed.

### Security

- Administrative import, destructive app-data operations, and legacy migration
  endpoints now require an admin role when OIDC claim authorization is active.
- Direct app access must remain private when `TRUST_PROXY_AUTH=true` because
  trusted identity and group headers are accepted only from the proxy boundary.

## [1.0.0] - 2026-06-29

### Added

- Added a complete PWA icon set, browser favicon, Apple touch icon, and
  installable manifest icons using repo-owned assets.
- Added regression coverage for PWA metadata, installable icon references, and
  release-check handling of public app icons.

### Changed

- Promoted the validated `v1.0.0-rc.2` release candidate line to the first
  stable `1.0.0` release.
- Updated release examples, environment templates, README project status, and
  deployment documentation for the stable `v1.0.0` artifact path.
- Kept the supported single-port OIDC Compose deployment as the recommended
  internet-facing auth topology for the stable release.

### Fixed

- Fixed the installable app title by using `Betreuungskalender` consistently in
  the web app manifest, browser metadata, and iOS home-screen metadata.
- Fixed release validation so generated public app icons are allowed while the
  sensitive-artifact guard continues to block unexpected images elsewhere.

### Validation

- No database schema migration, API contract change, or production deployment is
  introduced by the stable release cut.

## [1.0.0-rc.2] - 2026-06-29

### Added

- Added a supported single-port OIDC release Compose deployment where only
  oauth2-proxy publishes a host port and the app stays private on the Compose
  network.
- Added OIDC release environment and oauth2-proxy configuration examples for
  the archive deployment layout.
- Added a post-`1.0.0` authentication architecture decision record for native
  OIDC, multi-parent collaboration, and protected calendar feed work.
- Added release/update validation coverage for OIDC topology, archive paths,
  and example configuration files.

### Changed

- Hardened rootless Podman OIDC deployment guidance, including config-file
  permissions, cookie secret generation, health validation, and troubleshooting.
- Clarified that `v1.0.0-rc.1` does not contain the OIDC deployment files and
  that a newer verified release artifact is required for the normal OIDC
  deployment path.
- Removed deployment-specific real examples from generic deployment
  documentation.

### Validation

- No product feature scope, database schema migration, or API contract change is
  introduced by this release candidate.
- The release candidate is intended to create a verified artifact containing the
  OIDC deployment files added after `v1.0.0-rc.1`.

## [1.0.0-rc.1] - 2026-06-28

### Changed

- Promoted the validated `v0.5.0` operational and product baseline to the first
  `1.0.0` release candidate.
- Updated project status and release documentation for the `v1.0.0-rc.1`
  candidate cut.

### Validation

- The release candidate keeps the existing SQLite/API persistence model,
  responsive frontend, reporting/export flows, backup/restore scripts, update
  and rollback workflow, runtime security checks, and E2E coverage intact.
- No database schema migration, API contract change, or production deployment is
  introduced by this release candidate.

## [0.5.0] - 2026-06-24

### Added

- A Compose-first, verified update workflow with a dry run, update lock,
  SHA-256 archive verification, backup verification, readiness checks, and
  paired runtime/database rollback.
- A minimal release-runtime image, release archive validation, and automated
  runtime, container, update, rollback, backup, and responsive E2E coverage.

### Changed

- GitHub Actions now use Node 24-runtime action versions while application
  validation continues to run on Node.js 22.
- Release documentation now uses reusable version placeholders for the
  maintained preparation, tag, archive, and publish steps.

### Security

- API routes now enforce central Fastify rate limits with stricter limits for
  writes, imports, migrations, and exports.
- Route-level policy metadata makes rate-limit coverage verifiable by CodeQL;
  no alerts were suppressed or dismissed.

## [0.4.0] - 2026-06-21

### Added

- Typed German-first internationalization with an English language pack,
  localized interface copy, reports, and PDF vocabulary.
- Provider-independent import of local `.ics` holiday calendar files, source
  visibility controls, and read-only calendar overlays.
- Backup and restore support for external calendar sources and normalized
  events.
- Parser, migration, API, and responsive end-to-end coverage for recent
  calendar, language-pack, and operational workflows.

### Changed

- Release validation, deployment automation, checksummed artifacts, and
  container health validation are reproducible through the project scripts and
  workflows.
- Imported external calendar events remain isolated from care entries,
  statistics, reports, exports, and month closure.

### Security

- Updated `dompurify` to resolve the prior moderate advisory.
- Added rate limiting to external calendar import and source-management routes.

## [0.3.0] - 2026-06-12

### Added

- SQLite/API-backed domain persistence for children, care entries, holidays,
  contact patterns, trips, costs, unavailable periods, settings, monthly
  closings, and audit records.
- Migration assistant for legacy browser data from `localStorage`.
- Import preview with duplicate and conflict detection.
- Transactional SQLite import with a required backup before replace mode.
- Exportable migration report and audit entries for migration actions.
- Server connectivity state, loading and error handling, and blocked writes
  while the backend is unavailable.
- Automated tests for legacy detection, migration conflicts, transaction
  rollback, and backup failure handling.

### Changed

- SQLite and the API are now the source of truth for domain data.
- Legacy `localStorage` domain data is now read only as a migration source and
  is never deleted automatically.
- The browser UI now loads and persists domain data exclusively through the
  API.

### Security

- Updated the transitive `shell-quote` development dependency to `1.8.4` to
  resolve CVE-2026-9277.

## [0.1.0] - 2026-06-07

### Added

- First public preview of Betreuungskalender.
- Child management and care entries with status, period, scope, overnight
  stays, location, handovers, notes, and evidence references.
- Configurable biweekly target schedule with planned/actual comparison,
  additional care, cancellation reasons, and overlap notices.
- Holiday management, unavailable periods, trips, costs, and period-based
  statistics.
- Monthly and yearly analyses for care days, overnights, weekends, holidays,
  travel distance, and costs.
- JSON backup and import, separate CSV exports, neutral PDF reports, and an
  A4-optimized print view.
- Monthly closure, data-quality checks, plausibility validation, soft deletion,
  and a field-level audit log.
- Responsive iPhone and iPad layouts, compact mobile agenda, touch-friendly
  forms, PWA manifest, and offline frontend fallback.
- Typed, touch-friendly help text and factual documentation rules.
- Fastify API with SQLite migrations, validation, health endpoints,
  configurable reverse-proxy authentication, restrictive CORS, and security
  headers.
- SQLite backup, restore verification, healthcheck, and release-check scripts.
- Multi-stage container image, Compose deployment, systemd examples, and
  operating documentation for LXC, reverse proxies, Keycloak, and
  oauth2-proxy.
- GitHub Actions CI using `npm ci`, the sensitive-artifact release check, and
  the Vite production build.
- Open-source project documentation, contribution guide, security policy, code
  of conduct, and MIT license.

### Security

- The release check blocks accidentally tracked databases, reports, exports,
  backups, and environment files.
- `/api/health` does not expose the configured database path.
- Proxy identity headers are trusted only when `TRUST_PROXY_AUTH=true`.
- API access is denied without a trusted identity when `REQUIRE_AUTH=true`.

### Notes

- This version is the first public preview.
- The application is a documentation tool and does not provide legal advice.
- Reports are technical summaries of user-entered data and are not official or
  legally reviewed documents.
