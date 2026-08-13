# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows semantic versioning where practical.

## [Unreleased]

## [1.20.2] - 2026-08-13

### Changed

- Updated the reproducible build and CI toolchain to npm 12.0.1 on Node.js
  24.18.0.
- Reduced the production container to a digest-pinned minimal Node.js runtime
  without a shell, package manager, or build-only operating-system tools.

## [1.20.1] - 2026-08-05

### Changed

- Updated affected transitive dependencies to maintained patch versions.
- Made recurring-rule and selected-month browser tests independent of the
  current calendar month.

## [1.20.0] - 2026-07-31

### Added

- Added a production-ready Helm chart for deploying the application on
  Kubernetes with configurable images, ingress, TLS, persistent storage,
  probes, resources, scheduling constraints, labels, and annotations.
- Added Helm deployment guidance and an architecture decision record covering
  the supported SQLite, storage, security-context, and upgrade model.
- Added automated Helm linting and rendering checks to continuous integration
  and release validation.

### Changed

- Release archives now include the Helm chart and validate that its application
  version matches the packaged application version.
- Kubernetes deployments run with one application replica and a `Recreate`
  strategy because the embedded SQLite database supports one application
  writer rather than horizontally scaled pods.
- The chart defaults to a non-root container, a read-only root filesystem, and
  dedicated writable mounts for application data, backups, and temporary data.

## [1.19.0] - 2026-07-31

### Added

- Added fixed workspace roles for admins, editors, schedulers, and viewers,
  backed by named server-side permissions.
- Added restricted child, caregiver, and appointment projections for users who
  need scheduling access without sensitive family details.
- Added owner-managed invitations, role changes, and member removal for the
  shared workspace.

### Changed

- Existing membership roles migrate deterministically: `admin` remains
  `admin`, `parent` becomes `editor`, and `readonly` becomes `viewer`.
- Once an installation owner exists, active application memberships are the
  authoritative source of workspace access. Identity-provider groups remain a
  compatibility path only before ownership is established.
- Scheduler access is limited to planned future appointments for assigned
  caregivers and excludes notes, evidence, costs, trips, custom locations, and
  lifecycle actions.
- The browser requests only the datasets and projections allowed by the
  current workspace permissions.

### Security

- Protected API routes now declare a named permission and fail closed when the
  classification is missing.
- Removing a member immediately revokes workspace API access, personal
  calendar-feed tokens, push subscriptions, and pending confirmations.
- Role and care-party assignment changes are applied to existing personal
  feeds and confirmation tasks on the next request.
- Installation setup metadata is separated from general application settings
  and ownership survives a domain-data reset.
- Restricted API responses remove sensitive fields before serialization.

## [1.18.2] - 2026-07-26

### Changed

- Updated the Fastify server, static asset delivery, PDF sanitation, and build
  tooling dependencies to maintained compatible versions.
- Pinned npm 11.18.0 in every Node-based GitHub Actions job so CI uses the same
  package-manager version as local and container release builds.
- Added regression coverage that keeps the workflow npm version aligned with
  the version declared by the project.

## [1.18.1] - 2026-07-15

### Added

- Added a dismissible installation suggestion for supported browsers so the
  application can be added to the device as a PWA without obscuring the main
  workflow.

### Changed

- Chromium-based browsers use the browser-provided install prompt only after
  installation is available, while iPhone and iPad users receive concise
  platform-specific guidance.
- Installation guidance is hidden in standalone mode and during setup or
  invitation onboarding, and a dismissal is remembered locally for 30 days.

## [1.18.0] - 2026-07-13

### Added

- Added a shared care-conflict model for planned and actual care entries across
  calendar, agenda, entry lists, reports, and exports.
- Added transactional validation that rejects overlapping completed or partial
  care for the same child while keeping planned overlaps visible for review.
- Added a guided four-step mobile flow for defining custom recurring contact
  rules with a live occurrence preview.

### Changed

- Reports and holiday allocations now merge same-party time and expose
  ambiguous cross-party actual-care overlap instead of counting it twice.
- Care lifecycle actions are handled from the entry workflow; contact-rule
  authoring remains focused on recurrence, preview, synchronization, and
  preserved exceptions.
- Calendar, agenda, and entry views use the same neutral conflict status and
  link users to the editable entry.
- Derived conflict responses use fixed processing budgets and expose an
  explicit completeness state instead of returning partial results as complete.

### Security

- Actual-care conflict checks execute in the same serialized write transaction
  as the update and return a generic conflict response without disclosing
  inaccessible entries.

## [1.17.1] - 2026-07-13

### Changed

- Multi-day unavailability now shows its complete date and time range in the
  mobile agenda.
- Mobile entry status filters remain fully visible without horizontal
  scrolling, and the calendar uses one contextual create action.
- Personal calendar feed event titles include the assigned child labels while
  existing feed URLs, tokens, and scopes remain unchanged.
- Link-based onboarding now shows a dismissible completion message after the
  user returns to the application.

### Fixed

- Improved reliability of first-use and invitation completion.
- Preserved an explicit invitation email opt-out while the recipient address
  is edited.

## [1.17.0] - 2026-07-12

### Added

- Added provider-neutral landing pages for owner setup and invitation links,
  including clear continuation and invalid, expired, revoked, or used states.
- Added an admin-only invitation delivery capability so the email option is
  shown only when outbound mail is fully configured.

### Changed

- Invitation creation now defaults to email delivery when a recipient address
  and working mail configuration are available, while manual code sharing
  remains available.
- Normal native OIDC login now requires either an application membership or a
  configured role claim even while first-use setup is incomplete. Only a
  validated owner-setup or invitation context may create its intended
  membership.
- Expanded the self-hosted onboarding documentation with owner secret mounts,
  membership precedence, group fallback, and upgrade compatibility guidance.

### Security

- Onboarding continuation URLs are redacted from request logs, and error pages
  never include the submitted bearer value.
- Invitation email availability fails closed when mail configuration cannot be
  confirmed without blocking member administration.

## [1.16.0] - 2026-07-12

### Added

- Added contextual server-side OIDC login transactions for normal login,
  initial owner setup, and invitation acceptance.
- Added a short-lived, one-time owner setup link backed by a mounted secret
  file and an audited owner membership claim.
- Added invitation links that start native OIDC login and assign the invited
  application role after the validated callback.

### Changed

- Invitation emails now use the automatic invitation login flow. Manual token
  acceptance remains available as a compatibility fallback.
- Owner membership claim and first-use setup completion are separate steps, so
  the existing setup wizard remains authoritative.

### Security

- Setup and invitation bearer values are redacted from application request
  logs and are persisted only as SHA-256 hashes.
- Owner setup links are time-limited and single-use. Invitation expiry,
  revocation, and single-use checks remain transactional.
- Onboarding callbacks retain OIDC state, nonce, PKCE, issuer, audience, and
  session-cookie validation.

## [1.15.1] - 2026-07-12

### Fixed

- Corrected holiday allocation so each calendar day is counted once, explicit
  care takes precedence, and uncovered child shares fall back to the configured
  primary care party.
- Kept calendar agenda groups within the selected month, including holiday
  periods that cross month boundaries.
- Synchronized bounded recurring contact rules across their complete configured
  range, with an explicit action for existing rules and a 36-month safety limit.
- Batched due care-confirmation pushes to one generic notification per user and
  sweep while retaining each in-app confirmation task.
- Corrected the first-use setup form alignment on wide screens.

### Changed

- Updated continuous-integration actions for the current Node.js runner.
- Added release checks that keep the README release link aligned with package,
  lockfile, release notes, and deployment examples.

### Security

- The manual contact-rule synchronization endpoint uses existing write limits,
  care-party authorization, bounded expansion, and idempotent occurrence keys.
- Batched push text remains generic and contains no child names, schedules, or
  other care details.

## [1.15.0] - 2026-07-06

### Added

- Added a collapsible desktop sidebar so the calendar can use more horizontal
  space while keeping navigation available.
- Added external calendar feed URLs as read-only calendar overlays. HTTPS feed
  URLs can be added, refreshed, replaced, disabled, or deleted from Settings.

### Changed

- External calendar sources now distinguish local ICS files from URL feeds while
  keeping imported events read-only and excluded from reports and statistics.
- Calendar and agenda views now surface when a recurring rule date falls inside
  a holiday period. Holiday periods remain planning frames and do not silently
  replace care entries.

### Security

- External calendar feed URLs require HTTPS, reject obvious local/private hosts,
  are fetched with timeout and size limits, and are shown only in redacted form
  because provider URLs can contain bearer-like tokens.

### Documentation

- Updated external-calendar, data-model, README, and security documentation for
  URL feed overlays and explicit holiday/contact-rule behavior.

## [1.14.0] - 2026-07-06

### Changed

- Invitation emails now use the configured installation label as the sender
  display name when available, while `SMTP_FROM` remains the sender mailbox.

### Documentation

- Added a self-hosted onboarding and member-administration guide covering
  first-use setup, owner bootstrap, app memberships, invitations, and readiness
  checks.
- Updated the README and security policy to reflect the current self-hosted
  release line and setup/member-administration scope.

## [1.13.0] - 2026-07-06

### Added

- Added a guided first-use setup wizard for fresh self-hosted installations.
  The wizard walks through owner confirmation, basic child setup, care-party
  setup, default values, and the initial calendar/feed discovery steps.
- Added setup-focused care-party defaults so fresh installations can start with
  a clear primary care party and standard handover values.
- Added clearer empty states for installations without existing children, care
  entries, care parties, or feed configuration.
- Added a calendar/feed discovery step that points new installations to external
  calendar import, holiday source selection, and personal calendar-feed setup.
- Added a local Settings preference to show or hide inline field-help icons.
  The central Help page remains available when inline icons are hidden.

### Changed

- Renamed the navigation entry from "Rules" to "Help" to better match the
  central guidance page.
- Improved first-use guidance so setup tasks are presented as a connected flow
  instead of scattered configuration surfaces.

### Testing

- Added backend coverage for setup completion with owner, care party, child,
  and default settings.
- Added E2E coverage for the setup wizard, fresh-install empty states,
  calendar/feed discovery, and the help-icon visibility preference.
- Re-ran lint, unit tests, build, E2E, and release checks across the merged
  v1.13.0 changes.

## [1.12.0] - 2026-07-06

### Added

- Added invitation token acceptance so users can join an existing instance with
  owner-issued invitation codes.
- Added owner-scoped member management APIs for listing app users, assigning
  app-managed roles, revoking invitations, and removing explicit app roles.
- Added Settings UI for invitation creation, one-time invitation code display,
  member role management, and invitation revocation.
- Added optional SMTP-based invitation delivery. Owners can send an invitation
  email when mail delivery is configured, while the one-time code remains
  available as a manual fallback.

### Security

- Invitation tokens are stored hashed, expire, are single-use, and are only
  revealed once at creation time.
- Invitation and member-management actions are owner/admin scoped and audited.
- Invitation email delivery returns generic failure states and does not expose
  SMTP credentials or invitation tokens through server logs.

### Changed

- Documented the invitation public base URL and SMTP configuration in
  deployment and security documentation.
- Kept OIDC group-derived roles as compatibility fallback while app-managed
  memberships become the preferred access-control model for shared instances.

### Testing

- Added backend coverage for invitation acceptance, member role assignment,
  member removal safeguards, invitation revocation, and SMTP delivery success
  and failure handling.
- Added E2E coverage for Settings-based invitation and member workflows.
- Re-ran lint, unit, build, E2E, runtime-security, and release checks across
  the merged v1.12.0 changes.

## [1.11.0] - 2026-07-05

### Added

- Added admin-only instance readiness information for abstract version,
  runtime, migration, setup, and feature status checks.
- Added first-use setup state to `/api/session` so fresh self-hosted
  installations can be detected without browser-local state.
- Added application-managed memberships that can override identity-provider
  group-derived roles for known users while keeping existing OIDC group mapping
  as compatibility fallback.
- Added an explicit first-run owner bootstrap flow for fresh installations. The
  signed-in setup user can confirm ownership once, creating an admin membership
  and completing setup with audit entries.

### Changed

- Native OIDC can create a provisional setup session without a matching role
  group only while first-run setup is incomplete. General write APIs remain
  blocked until an application membership exists.
- Documented the app-managed access model and first-run owner bootstrap in the
  configuration, data-model, and security documentation.

### Testing

- Added backend coverage for setup-state detection, owner bootstrap audit
  records, app-managed membership role resolution, trusted-proxy membership
  authorization, and Native OIDC provisional setup sessions.
- Re-ran the full unit, build, E2E, runtime-security, and release checks.

## [1.10.2] - 2026-07-05

### Fixed

- Fixed mobile agenda cards for external calendar events so event titles no
  longer collapse into a narrow vertical text column.
- Fixed mobile contact-rule time-span fields so date-offset and time inputs stay
  inside their card on narrow screens.
- Fixed mobile contact-rule summary metrics and generated-entry actions so the
  seventh metric and help buttons no longer look detached from their cards.
- Fixed mobile holiday statistics and care-party share cards so the fifth metric
  and person shares stay aligned inside their panels.
- Fixed the mobile analytics export actions so CSV/PDF buttons and help icons no
  longer overlap.
- Fixed the mobile care-entry form so period fields, toggles, and help buttons no
  longer appear oversized.
- Fixed mobile care-entry collapsible sections so trip, cost, and notes headers
  stay aligned inside their cards.
- Fixed mobile calendar-feed spacing so status, scope selection, help icon, and
  explanatory text stay visually grouped.
- Fixed mobile entry status filters so all filter options are visible without
  horizontal scrolling.
- Hid the notification E-Mail channel controls until server-side E-Mail delivery
  is implemented.

### Testing

- Added iPhone regression coverage for readable external calendar agenda cards.
- Added iPhone regression coverage for contained contact-rule time-span inputs.
- Added iPhone regression coverage for contact-rule summary metrics and
  generated-entry actions.
- Added iPhone regression coverage for holiday statistics and care-party share
  layouts.
- Added iPhone regression coverage for analytics export action containment.
- Added iPhone regression coverage for compact mobile care-entry form controls.
- Added iPhone regression coverage for mobile care-entry collapsible section
  headers.
- Added iPhone regression coverage for mobile calendar-feed spacing.
- Added iPhone regression coverage for the mobile entry status filter grid.
- Added iPhone regression coverage that notification settings do not expose the
  unfinished E-Mail channel.
- Re-ran the full desktop, iPhone, and iPad E2E suite.

## [1.10.1] - 2026-07-04

### Fixed

- Fixed the mobile calendar agenda so holiday periods are scoped to the selected
  month instead of showing unrelated periods from earlier months.
- Hardened the mobile month calendar layout with deterministic event limits and
  short labels for holidays, unavailability, and generated care entries.
- Tightened mobile layouts for entries, analytics, holiday management, backup,
  audit log, unavailability, external calendar, and feed settings surfaces to
  avoid horizontal overflow and control/button overlap.
- Aligned desktop Settings default-value fields and help buttons.

### Testing

- Added iPhone regression coverage for month-scoped calendar agenda data.
- Added mobile and desktop horizontal-overflow regression checks for the
  reported v1.10.1 layout surfaces.
- Captured visual QA screenshots for the affected mobile and desktop views.

## [1.10.0] - 2026-07-04

### Added

- Added `TRUSTED_PROXY_CIDRS` for trusted-proxy deployments so proxy identity
  headers are accepted only from configured source IPs or CIDR ranges.
- Added documentation for trusted-proxy CIDR handling with external HAProxy and
  containerized reverse proxies.

### Changed

- Moved upcoming care entries higher on the dashboard so the next actionable
  dates appear before secondary metric cards.
- Changed the desktop notification entry from a detached icon to an integrated
  sidebar navigation row.
- Clarified notification timing and channel editability in Settings.

### Fixed

- Fixed mobile layout issues across the calendar, agenda, entries filter,
  settings, external calendar import, calendar feed, backup, reports, audit log,
  holidays, and unavailability surfaces.
- Fixed the dashboard "open appointments" metric so it acts as a navigation
  shortcut to the filtered entries surface.
- Removed the stale local SQLite information card from the desktop sidebar.

### Testing

- Added regression coverage for trusted proxy source-address enforcement.
- Verified the UI fixes with the existing desktop, iPhone, and iPad E2E suites.

## [1.9.1] - 2026-07-03

### Security

- Hardened shared-care authorization boundaries so non-admin users can only
  update or delete care entries and contact rules for care parties they are
  assigned to.
- Added regression coverage for shared-care parent separation across care
  entries and contact rules.

### Fixed

- Fixed the test/demo data reset path so confirmation and notification records
  are cleared before dependent care entries and app users are removed.

## [1.7.3] - 2026-07-03

### Changed

- Changed holiday allocation fallback so holiday blocks without explicit care
  entries are credited to the configured default responsible care party instead
  of falling back to the legacy father/mother holiday assignment.
- Updated the care-entry form so partially completed care can be corrected or
  documented with actual children, actual time range, and actual responsible
  care party outside the confirmation-center flow.

### Fixed

- Fixed normal care-entry updates so partial actual-care fields are persisted
  through `/api/care-entries` instead of only being preserved after a
  confirmation answer.

### Testing

- Added an end-to-end regression for documenting a partially completed care
  entry with one actual child and an actual time range.

## [1.7.2] - 2026-07-03

### Added

- Added a persistent in-app notification center with sidebar and mobile header
  bell access for open care-confirmation tasks.
- Added an explicit default responsible care party setting used by care entries
  and contact rules when no other care party is selected.
- Added calendar-visible holiday periods in the month grid and agenda.
- Added actual-care fields for partially completed entries so confirmations can
  record actual children, time ranges, and responsible care parties separately
  from the original plan.
- Added care-entry deviation metadata for rescheduled, swapped, externally
  blocked, cancelled, partial, and other factual deviations while preserving
  the original planned period.
- Added externally blocked contact periods as a neutral unavailability scope
  with optional child and care-party references.

### Changed

- Changed holiday allocation statistics to derive care-party shares from care
  entries that overlap recorded holiday periods instead of relying on new
  father/mother/shared holiday assignments.
- Changed holiday and period statistics to use actual children, actual times,
  and actual care parties for partially completed care entries.
- Updated entry, agenda, and report surfaces to show documented deviations and
  the original planned period where applicable.
- Updated contact, analytics, calendar, CSV, and PDF report surfaces to
  distinguish externally blocked contact from the care party's own
  unavailability.
- Updated holiday management copy so holiday blocks are described as planning
  frames while actual holiday credit comes from normal care entries.

## [1.7.0] - 2026-07-03

### Added

- Added external-calendar source classification for overlay-only calendars and
  holiday sources.
- Added explicit holiday-block derivation from all-day imported holiday source
  events without silently changing existing holiday blocks.
- Added follow-up care confirmations for past planned entries, including
  `completed`, `partial`, and `cancelled` confirmation outcomes.
- Added per-user notification preferences and optional privacy-preserving Web
  Push subscriptions for confirmation reminders.

### Security

- Restricted stored Web Push subscription endpoints to HTTPS hosts listed in
  `WEB_PUSH_ALLOWED_ENDPOINT_HOSTS` to avoid server-side request forgery.
- Kept PWA notification click targets same-origin even if a malformed push
  payload is received.

## [1.6.2] - 2026-07-02

### Added

- Included care-entry locations in personal iCalendar feed events as
  `LOCATION`, using custom locations when present and otherwise the configured
  location label.

### Testing

- Added an end-to-end regression test proving that a child color selected in
  Settings is persisted and rendered in the month calendar.

## [1.6.1] - 2026-07-02

### Fixed

- Fixed overlapping labels, help buttons, date/time inputs, and impact toggles
  in the unavailability modal on desktop, tablet, and mobile viewports.
- Open the unavailability form in a dedicated wider modal layout while keeping
  the modal vertically scrollable and preventing horizontal overflow.

## [1.6.0] - 2026-07-02

### Added

- Added RRULE-compatible recurring contact rules for daily, weekly, and monthly
  schedules using bounded, validated RFC 5545-style recurrence lines.
- Added a flexible contact-rule builder with frequency, interval, weekday,
  monthly day, monthly ordinal, and multiple time-span controls.
- Added release ADR documentation for the RRULE-compatible contact-rule model.

### Changed

- Replaced the template-first contact-rule screen with a free recurrence
  workflow that previews generated calendar dates before saving.
- Contact-rule saving continues to synchronize planned entries automatically
  while preserving manually changed or cancelled exceptions.
- Localized the default care-party label from `Primary caregiver` to
  `Hauptbetreuung` without renaming user-created care parties.
- Polished Settings user assignments, care-party rows, external holiday
  calendar import controls, calendar feed actions, and unavailability forms.

### Security

- RRULE input is parsed through the maintained `rrule` library and restricted
  to supported daily, weekly, and monthly schedules with bounded intervals,
  counts, and schedule-line counts.

### Testing

- Added unit coverage for weekly intervals, multiple weekdays, monthly day,
  ordinal weekday, last weekday, count-limited rules, DST-boundary dates, and
  invalid or excessive RRULE input.

## [1.5.1] - 2026-07-02

### Fixed

- Normalized mobile Settings layout so external calendar source rows, toggle
  controls, and calendar feed fields no longer overflow or appear misaligned.
- Aligned the mobile dashboard close-month action with its help control.
- Hardened release hygiene checks around generated image artifacts.

### Testing

- Made native OIDC runtime-security session fixtures use future-relative
  expiration times so CI does not fail after a fixed calendar date.

## [1.5.0] - 2026-07-02

### Added

- Added flexible contact rules with calendar-style preview, automatic planned
  entry synchronization on save, and exception-preserving single-occurrence
  editing.
- Added domain-level care parties for responsible caregivers, separate from
  authenticated `app_users`.
- Added scoped iCalendar feeds for all visible care entries or a selected care
  party while preserving existing legacy feed tokens.
- Added optional admin-managed OIDC user-to-care-party assignments for shared
  operation without making shared use mandatory.
- Added end-to-end coverage for rule creation, calendar visibility, care-party
  assignment, and scoped feed output.

### Changed

- Contact-rule setup is now a guided workflow with presets, real calendar
  previews, and immediate feedback about synchronized entries.
- Personal calendar feeds no longer need to rely on technical `created_by`
  ownership once users rotate to the new `all` or `party` scopes.

### Security

- Shared operation keeps role authorization based on `app_users` while limiting
  non-admin writes to assigned care parties once assignments are configured.
- Calendar feed URLs remain bearer secrets and continue to exclude notes,
  evidence references, trips, costs, audit metadata, deleted entries, and
  cancelled entries.

## [1.4.3] - 2026-07-01

### Added

- Added an opt-in `DEMO_DATASETS_ENABLED` demo/staging feature that lets admin
  users load a fully synthetic edge-case dataset for demos and regression
  checks.

### Changed

- Mobile authenticated headers now use a compact user icon with a submenu for
  display name, role, and logout instead of showing a crowded role/logout chip
  directly in the header.
- Demo/staging deployment documentation now explains the synthetic edge-case
  dataset loader and keeps it disabled for production by default.

### Fixed

- Mobile native OIDC sessions now remain visible and usable from the header
  without overflowing narrow iPhone-sized layouts.

## [1.4.2] - 2026-07-01

### Changed

- Native OIDC logout now redirects the browser through the provider
  end-session endpoint so Keycloak SSO sessions are ended, not only the local
  app session.
- Added `OIDC_POST_LOGOUT_REDIRECT_URI` for explicit Keycloak post-logout
  redirect configuration, defaulting to the app origin derived from
  `OIDC_REDIRECT_URI`.

### Security

- Logout continues to keep tokens out of browser storage and logs while
  clearing the app cookie and revoking the server-side session before provider
  logout navigation.

## [1.4.1] - 2026-07-01

### Changed

- Native OIDC deployments with `REQUIRE_AUTH=true` now redirect browser SPA
  entry requests to `/auth/login` when no valid server-side session exists.
- The frontend now loads `/api/session` before domain data and clears stale
  local data, write actions, errors, and user display state when authentication
  is required but no longer valid.

### Security

- Unauthenticated users can no longer receive the React SPA shell in native OIDC
  mode when browser login is required.
- Session expiry or logout followed by `401` API responses refreshes the
  frontend session state instead of leaving stale authenticated UI visible.

## [1.4.0] - 2026-07-01

### Added

- Added native OIDC authentication with Authorization Code + PKCE login,
  callback, logout, server-side login state, opaque session cookies, and
  claim-based mapping into the existing `app_users` model.
- Added native OIDC frontend login/logout handling while keeping `/api/session`
  as the UI source for authentication and role state.
- Added native OIDC installation, migration, rollback, and release validation
  documentation for Podman/Compose deployments without oauth2-proxy.
- Added native OIDC release hardening checks, trusted-proxy transition
  guidance, and `v1.4.0` release notes covering migration, rollback, and
  security validation.
- Added GHCR testing and production image-promotion workflows plus
  image-based Podman Compose examples for demo and production channels.

### Changed

- Updated the release/container toolchain to Node.js 24 LTS with npm 11.18.0 and
  direct `node` container startup to avoid npm runtime update-notifier noise.

### Security

- Native OIDC keeps raw tokens out of browser storage and stores only opaque
  server-side session material.
- Native OIDC production mode rejects users without a configured role group
  when `OIDC_REQUIRE_ROLE_CLAIM=true`.
- Trusted-proxy/oauth2-proxy remains documented as a transition and rollback
  mode instead of being removed by this release.

## [1.3.0] - 2026-06-30

### Added

- Added a revocable personal iCalendar subscription feed for care entries
  created by the signed-in user.
- Added migration `008_calendar_feed_tokens` for per-user calendar feed token
  hashes.
- Added calendar-style preview cards for recurring contact-rule generation so
  operators can see how generated Friday-to-Sunday care times repeat before
  writing them to the calendar.
- Added a GitHub release image publishing workflow for GHCR that validates the
  tagged runtime, pushes the release image, and records the immutable digest on
  the GitHub release.

### Changed

- Updated release-image deployment documentation for the GHCR image path and
  digest-based runtime verification.

### Security

- Calendar feed URLs are bearer secrets; only SHA-256 token hashes are stored in
  SQLite, feed tokens do not grant `/api/*` access, and request logs redact
  `/calendar/<token>.ics` paths.
- The feed excludes notes, evidence references, trips, costs, audit metadata,
  deleted entries, and cancelled entries.

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
