# Data model

## External calendars

`external_calendar_sources` stores imported file sources and visibility. `external_calendar_events` stores normalized, read-only event data and references its source with cascade deletion. The unique `(source_id, ical_uid, recurrence_id)` key makes re-import idempotent; missing recurrence IDs are stored as an empty string.

## Persistence surfaces

The Fastify API and SQLite tables below are the single source of truth for
current domain data. The React UI uses the API for domain reads and writes.
Browser local storage is limited to UI preferences and an optional legacy-data
discovery source; it is not synchronized or treated as current persistence.

## SQLite tables

| Table | Purpose |
| --- | --- |
| `schema_migrations` | Applied migration identifiers and timestamps |
| `children` | Child aliases, birth month/year, and calendar color |
| `care_entries` | Planned, completed, or cancelled care periods and details |
| `care_entry_children` | Many-to-many child assignment for care entries |
| `trips` | Multiple trips belonging to a care entry |
| `costs` | Multiple cost items belonging to a care entry |
| `holiday_periods` | Named holiday blocks and assignment |
| `holiday_period_children` | Child assignment for holiday blocks |
| `contact_patterns` | Biweekly Friday-to-Sunday target schedules |
| `contact_pattern_children` | Child assignment for target schedules |
| `unavailable_periods` | Duty-related and other unavailable periods |
| `settings` | JSON-encoded server-side settings |
| `monthly_closings` | Monthly summary and post-close change marker |
| `audit_log` | Field changes, creates, deletes, and post-close changes |
| `app_users` | Stable users derived from trusted OIDC/proxy-auth headers |
| `calendar_feed_tokens` | Revocable per-user iCalendar feed token hashes |
| `native_oidc_login_states` | Short-lived server-side OIDC state, nonce, and PKCE verifier records |
| `native_oidc_sessions` | Server-side native OIDC session token hashes and expiry metadata |

## Soft delete

Business tables use `deleted_at`. API list and detail queries return active rows
only. DELETE operations mark records instead of removing them. Junction rows,
trips, and costs follow the same principle. Audit records retain the change.

## Audit log

`app_users` maps trusted OIDC/proxy subjects to stable internal user IDs. It
stores the latest display name, email, derived role, group list, timestamps,
and soft-delete metadata. The stable internal ID is used in API audit fields so
name or email changes do not rewrite historical actors.

`audit_log` stores timestamp, stable API user ID, entity type and ID, action,
field name, old/new serialized values, and optional metadata. Audit API
responses join the current `app_users.display_name` for readability while
keeping the stable internal user ID as the historical actor reference. It
improves traceability but is not an immutable external timestamp or
cryptographic proof.

## Actor metadata

Migration `007_actor_metadata` adds `created_by` and `updated_by` actor columns
to `children`, `trips`, `costs`, `holiday_periods`, `contact_patterns`, and
`settings`. `monthly_closings` already stored `closed_by`; the migration adds
`updated_by` so post-close changes can show the actor that marked the closing
as changed.

`care_entries` and `unavailable_periods` already store `created_by` and
`updated_by`. These actor fields store stable `app_users.id` values. They are
for attribution and audit display; authorization still comes from the current
request user and role.

## Personal calendar feeds

`calendar_feed_tokens` stores revocable per-user feed credentials. The raw
token is shown only when generated; SQLite stores `token_hash`, the owning
`app_users.id`, creation time, optional last-use time, and optional revocation
time. The token authorizes only the read-only `.ics` feed endpoint and never
grants API access.

Feed contents are derived from active `care_entries` where `created_by` equals
the feed owner and `status` is not `cancelled`. Notes, evidence references,
trips, costs, and audit data are not exported.

## Native OIDC login state

`native_oidc_login_states` stores short-lived, single-use login transaction
records for native OIDC. It contains the random `state`, matching `nonce`,
server-side PKCE verifier, redirect URI, creation timestamp, expiry timestamp,
and optional consumption timestamp. It never stores ID tokens, access tokens,
refresh tokens, client secrets, or browser session identifiers.

`native_oidc_sessions` stores server-side native OIDC sessions. Browser cookies
contain only random opaque tokens; SQLite stores their SHA-256 hashes, the OIDC
subject, creation time, optional last-seen time, expiry time, and optional
revocation time. Session rows do not store OIDC tokens, authorization codes,
raw claims, client secrets, or role decisions.

## Care entries

Care entries contain start/end, status, care scope, overnight and holiday
flags, additional care, location, handover, notes, evidence reference,
calculated duration, and contact-time classification. Children, trips, and
costs are persisted transactionally.

## Holidays and unavailable periods

Holiday blocks document a period and assignment to father, mother, or shared.
Unavailable periods record category, duty relationship, effects on contact or
holiday planning, location, notes, and evidence reference. Neither structure
automatically changes actual care entries.

## Monthly closure

The monthly closing stores a JSON summary, `closed_by`, and records changes
after closing with `updated_by`. It is an organizational control, not a
write-once archive.

## Browser JSON export

The browser backup envelope contains an application identifier, export
timestamp, schema version, children, care entries with trips and costs,
holidays, contact patterns, unavailable periods, audit entries, monthly
closures, settings, actor metadata, and backup metadata. Import normalizes
older supported schema versions and fills missing actor metadata with the
importing user or the legacy `local-dev` actor where no authenticated actor is
available.

## Migrations

SQL files in `server/migrations/` are applied in lexical order and recorded in
`schema_migrations`. Build copies them into `dist-server/server/migrations`.
Never edit an already released migration; add a new numbered migration and
update this document.
