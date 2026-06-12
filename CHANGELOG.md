# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows semantic versioning where practical.

## [Unreleased]

### Added

- Migrationsassistent für ältere Browserdaten aus `localStorage`.
- Vorschau mit Duplikat- und Konflikterkennung.
- Transaktionaler Import in SQLite mit verpflichtendem Backup vor Ersetzen.
- Exportierbares Importprotokoll und Audit-Einträge für Migrationen.

### Changed

- Alte `localStorage`-Fachdaten werden nur noch als Legacy-Quelle zur Migration
  gelesen und niemals automatisch gelöscht.

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
