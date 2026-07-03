# Data model

## External calendars

`external_calendar_sources` stores imported file sources, visibility, and
whether the source is a read-only overlay or a holiday source.
`external_calendar_events` stores normalized, read-only event data and
references its source with cascade deletion. The unique `(source_id, ical_uid,
recurrence_id)` key makes re-import idempotent; missing recurrence IDs are
stored as an empty string. Holiday periods can optionally keep
`source_external_calendar_source_id` and `source_external_calendar_event_id`
when they were explicitly derived from a holiday source.

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
| `care_parties` | Domain caregivers such as parents, grandparents, or other responsible parties |
| `care_entries` | Planned, completed, partially completed, or cancelled care periods and details |
| `care_entry_children` | Many-to-many child assignment for care entries |
| `care_confirmation_requests` | Follow-up confirmation tasks for past planned care entries |
| `trips` | Multiple trips belonging to a care entry |
| `costs` | Multiple cost items belonging to a care entry |
| `holiday_periods` | Named holiday blocks and assignment |
| `holiday_period_children` | Child assignment for holiday blocks |
| `contact_patterns` | Biweekly Friday-to-Sunday target schedules |
| `contact_pattern_children` | Child assignment for target schedules |
| `contact_rules` | Flexible recurring contact rules and synchronization settings |
| `contact_rule_children` | Child assignment for flexible contact rules |
| `unavailable_periods` | Duty-related and other unavailable periods |
| `settings` | JSON-encoded server-side settings |
| `monthly_closings` | Monthly summary and post-close change marker |
| `audit_log` | Field changes, creates, deletes, and post-close changes |
| `app_users` | Stable users derived from trusted proxy headers or native OIDC claims |
| `app_user_care_party_assignments` | Optional mapping between authenticated users and domain care parties |
| `calendar_feed_tokens` | Revocable per-user iCalendar feed token hashes |
| `native_oidc_login_states` | Short-lived server-side OIDC state, nonce, and PKCE verifier records |
| `native_oidc_sessions` | Server-side native OIDC session token hashes and expiry metadata |
| `notification_preferences` | Per-user notification channel choices for supported event types |
| `push_subscriptions` | Web Push subscription endpoints and public keys per app user |

## Soft delete

Business tables use `deleted_at`. API list and detail queries return active rows
only. DELETE operations mark records instead of removing them. Junction rows,
trips, and costs follow the same principle. Audit records retain the change.

## Audit log

`app_users` maps trusted proxy subjects or native OIDC `sub` claims to stable
internal user IDs. It stores the latest display name, email, derived role,
group list, timestamps, and soft-delete metadata. The stable internal ID is
used in API audit fields so name or email changes do not rewrite historical
actors.

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

## Care parties

`care_parties` stores the domain-level responsible people for care planning.
They are deliberately separate from `app_users`: one authenticated user can
manage all care parties in solo mode, and optional OIDC user-to-party
assignment can be added separately for shared management.

Each care party has a free display name and a coarse kind (`father`, `mother`,
`grandparent`, `foster_caregiver`, or `other`). Existing active care entries
and flexible contact rules are backfilled to a neutral default care party
during migration `012_care_parties` when such data exists.

`app_user_care_party_assignments` enables optional shared management. When no
active assignment exists, the installation remains in solo mode and users with
write permission can manage all care parties. Once at least one assignment is
configured, non-admin users must write care entries and contact rules for one
of their assigned care parties. Admin users remain unrestricted so they can
repair assignments and data.

## Personal calendar feeds

`calendar_feed_tokens` stores revocable per-user feed credentials. The raw
token is shown only when generated; SQLite stores `token_hash`, the owning
`app_users.id`, feed scope, creation time, optional last-use time, and optional
revocation time. The token authorizes only the read-only `.ics` feed endpoint
and never grants API access.

Feed scopes are:

- `legacy`: existing pre-v1.5 tokens; contents are derived from active
  `care_entries` where `created_by` equals the feed owner.
- `all`: all active, non-cancelled care entries in solo mode; for non-admin
  shared users this is limited to their assigned care parties.
- `party`: active, non-cancelled care entries where `responsible_party_id`
  matches the selected care party.

Notes, evidence references, trips, costs, and audit data are not exported.

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
raw claims, client secrets, or role decisions. Current role and permission
decisions are read from the matching `app_users` row on each API request.

## Care entries

Care entries contain start/end, status, care scope, overnight and holiday
flags, additional care, location, handover, notes, evidence reference,
calculated duration, contact-time classification, and an optional
`responsible_party_id`. Supported stored statuses are `planned`, `completed`,
`partial`, and `cancelled`. The API can additionally expose a derived
`unconfirmed` confirmation state for planned entries whose end time is already
in the past. Children, trips, and costs are persisted transactionally.

Generated planned entries can reference a flexible contact rule with
`contact_rule_id`, `contact_rule_segment_id`, and
`contact_rule_occurrence_key`. `contact_rule_sync_state` distinguishes entries
that can still be updated by rule synchronization from entries that were
manually changed and must be preserved. The older `generated_by_pattern_id` and
`rule_occurrence_date` columns remain for compatibility with legacy
contact-pattern data and migration paths.

Confirmed care entries can store `confirmation_note`, `confirmed_at`, and
`confirmed_by`. The note is optional and meant for short factual context such
as a partial completion note. `confirmed_by` stores the stable `app_users.id`
of the confirming user.

## Care confirmations and notifications

`care_confirmation_requests` stores one active confirmation task per care entry
and target user. A request is created for a planned past care entry when the
entry has not yet been confirmed. Its status is `open`, `snoozed`, or
`answered`; snoozed requests store `next_reminder_at`. Answering a request
updates the linked care entry to `completed`, `partial`, or `cancelled`, records
confirmation metadata, and closes the request so it is not sent again.

Notification preferences are intentionally small. `notification_preferences`
stores per-user choices for the supported confirmation events:
`care_confirmation_due` and `care_confirmation_reminder`. In-app notification is
always available, Web Push can be enabled when the server has VAPID keys, and
email is stored as a user preference for a later mail transport implementation.

`push_subscriptions` stores browser-provided Web Push endpoint data for an
authenticated app user: endpoint URL, `p256dh`, `auth`, optional user agent, and
soft-delete metadata. To avoid server-side request forgery through crafted
subscription URLs, the server only accepts HTTPS endpoints whose host is listed
in `WEB_PUSH_ALLOWED_ENDPOINT_HOSTS`. The server sends privacy-preserving push
payloads that do not include child names, exact care times, notes, evidence
references, or other case details.

## Contact rules

`contact_rules` stores the flexible recurrence model introduced after the
original `contact_patterns` table. The recurrence and segments are stored as
validated JSON, using local civil dates and `HH:mm` times. `v1.6.0` adds an
RRULE-compatible recurrence shape (`kind: "rrule"`, `rrules: string[]`) for
daily, weekly, and monthly rules while continuing to read the earlier weekly
and monthly JSON shapes. The initial sync window defaults to 12 months and
creates planned `care_entries` when a rule is saved. Existing legacy
`contact_patterns` are mirrored into `contact_rules` with a weekly recurrence,
two-week interval, Friday anchor, and a Friday-to-Sunday segment.
`responsible_party_id` is copied from the rule to generated planned entries.

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
care parties, holidays, contact patterns, unavailable periods, audit entries,
monthly closures, settings, actor metadata, and backup metadata. Import normalizes
older supported schema versions and fills missing actor metadata with the
importing user or the legacy `local-dev` actor where no authenticated actor is
available.

## Migrations

SQL files in `server/migrations/` are applied in lexical order and recorded in
`schema_migrations`. Build copies them into `dist-server/server/migrations`.
Never edit an already released migration; add a new numbered migration and
update this document.
