# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows semantic versioning where practical.

## [Unreleased]

### Added

- Production delivery of the built frontend and API from one Fastify process.
- Configurable reverse-proxy authentication and restrictive CORS handling.
- Security headers, content security policy, redacted proxy identity headers,
  and production-safe error responses.
- SQLite backup, restore verification, healthcheck, and release-check scripts.
- Multi-stage Docker image, Compose deployment, systemd example, and operating
  documentation for LXC, containers, reverse proxies, Keycloak, and
  oauth2-proxy.
- GitHub Actions, issue forms, pull request template, security policy,
  contribution guide, code of conduct, and MIT license.
- Typed, touch-friendly help system for form fields.
- Documentation of unavailable periods, audit history, monthly closure,
  exports, mobile use, and data-quality checks.

### Security

- `/api/health` no longer exposes the configured database path.
- Proxy identity headers are trusted only when `TRUST_PROXY_AUTH=true`.
- API access is denied without a trusted identity when `REQUIRE_AUTH=true`.

## [0.1.0] - 2026-06-07

### Added

- Initial Betreuungskalender application with care entries, children, calendar,
  contact schedules, holidays, unavailable periods, trips, costs, reports,
  exports, monthly closure, audit log, mobile layouts, and PWA support.
