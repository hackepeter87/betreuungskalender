# Data model

## External calendars

`external_calendar_sources` stores imported file sources or external HTTPS feed
sources, visibility, and whether the source is a read-only overlay or a holiday
source. URL feed sources keep the full feed URL server-side for refreshes, but
API responses expose only a redacted URL.
`external_calendar_events` stores normalized, read-only event data and
references its source with cascade deletion. The unique `(source_id, ical_uid,
recurrence_id)` key makes re-import idempotent; missing recurrence IDs are
stored as an empty string. Holiday periods can optionally keep
`source_external_calendar_source_id` and `source_external_calendar_event_id`
when they were explicitly derived from a holiday source.

Holiday periods are reporting and planning frames. They do not override
recurring contact rules or generated care entries. A care entry inside a holiday
period remains a normal care entry and is counted once through the care-entry
model.

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
| `care_entry_actual_children` | Actual child assignment for partially completed care entries |
| `care_confirmation_requests` | Follow-up confirmation tasks for past planned care entries |
| `trips` | Multiple trips belonging to a care entry |
| `costs` | Multiple cost items belonging to a care entry |
| `holiday_periods` | Named holiday periods used as calendar/reporting frames |
| `holiday_period_children` | Child assignment for holiday blocks |
| `contact_patterns` | Biweekly Friday-to-Sunday target schedules |
| `contact_pattern_children` | Child assignment for target schedules |
| `contact_rules` | Flexible recurring contact rules and synchronization settings |
| `contact_rule_children` | Child assignment for flexible contact rules |
| `unavailable_periods` | Duty-related and other unavailable periods |
| `settings` | JSON-encoded server-side settings, including optional first-use setup metadata |
| `monthly_closings` | Monthly summary and post-close change marker |
| `audit_log` | Field changes, creates, deletes, and post-close changes |
| `app_users` | Stable users derived from trusted proxy headers or native OIDC claims |
| `app_memberships` | Optional application-level member roles overriding identity-provider group roles |
| `app_invitations` | App-owned invitation token hashes for assigning membership roles after login |
| `app_user_care_party_assignments` | Optional mapping between authenticated users and domain care parties |
| `calendar_feed_tokens` | Revocable per-user iCalendar feed token hashes |
| `native_oidc_login_states` | Short-lived server-side OIDC state, nonce, and PKCE verifier records |
| `native_oidc_sessions` | Server-side native OIDC session token hashes and expiry metadata |
| `recovery_admin_credentials` | Optional break-glass recovery admin password hash metadata |
| `recovery_admin_sessions` | Optional short-lived recovery admin session token hashes |
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

`app_memberships` stores workspace roles for known app users. Migration 028
maps legacy `admin`, `parent`, and `readonly` memberships to `admin`, `editor`,
and `viewer`. Native OIDC requires an active membership for ordinary workspace
access. Trusted-proxy mode can use the identity-provider group-derived role as
a compatibility source before an owner exists. After ownership is established,
the latest membership record is authoritative in every production auth mode:
active grants access, deleted revokes it, and missing grants no workspace
access.

`app_invitations` stores only hashes of one-time invitation tokens. The raw
token is returned once at creation time and is never persisted. Invitations
carry the target app role, an optional email hint, expiry, acceptance and
revocation timestamps, and the accepted app user ID once claimed.

Member administration uses `settings.setup.ownerUserId`. The explicit owner can
list members, manage invitation records, and update workspace roles. Existing
installations without an explicit owner use the secret-backed owner setup flow;
the claim establishes ownership without changing existing domain data.

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

First-use setup state is stored as small JSON settings rather than a separate
table. Fresh installations are detected from server-side domain data. Later
setup flows can persist `setup.completedAt`, `setup.completedBy`, and
`setup.ownerUserId` in `settings`; `/api/session` exposes only the minimal
`complete`/`required` state, while detailed counts remain admin-only
instance-readiness information.

The first-use API accepts an optional `children` array and stores the owner,
care parties, settings, and every submitted child in one SQLite transaction.
For one compatibility release the previous singular `child` input remains
accepted; clients must not send both forms. The current UI sends only
`children` and supports completing setup without a child record.

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

## Derived care conflicts

Care conflicts are derived from active `care_entries`; they are not stored in a
separate table and do not rewrite existing records. The API groups entries by
child and treats intervals as half open, so an entry ending at 18:00 does not
conflict with one beginning at 18:00.

Overlapping planned entries remain writable and are returned as warnings.
Creating or changing completed or partially completed care is rejected when
its actual children and actual time overlap another actual entry. Cancelled and
soft-deleted entries are ignored. Existing contradictory actual entries remain
readable and are reported as unresolved conflicts for later correction.

The conflict endpoint returns `{ items, complete }`. `complete: false` means the
derived overview exceeded its processing budget; no partial conflict list is
presented as complete. Care entries remain readable and writable under their
normal authorization rules. Actual-care write validation queries only entries
for the same children and overlapping actual interval and remains fail closed.

Analytics merge overlapping actual intervals so the same care time is counted
only once. Overlap assigned to different care parties is not silently credited
to either party: reports expose that duration, and holiday allocation keeps the
holiday frame while listing the affected child share as unresolved.

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
Each exported event title includes the assigned child names followed by the
calendar scope label so subscriptions remain distinguishable in calendar
clients. Existing feed URLs and token scopes remain unchanged.

## Native OIDC login state

`native_oidc_login_states` stores short-lived, single-use login transaction
records for native OIDC. It contains the random `state`, matching `nonce`,
server-side PKCE verifier, redirect URI, a constrained login context, creation
timestamp, expiry timestamp, and optional consumption timestamp. Login context
distinguishes normal login, initial owner setup, and invitation acceptance.
Onboarding contexts may contain only a SHA-256 token hash. The table never
stores raw onboarding tokens, ID tokens, access tokens, refresh tokens, client
secrets, or browser session identifiers.

`owner_setup_tokens` stores only the SHA-256 hash, validity window, and optional
single-use consumption metadata for an initial owner setup link. Claiming a
valid token binds the authenticated app user to the owner membership. It does
not mark first-use setup complete; the setup wizard remains the authoritative
completion step.

`native_oidc_sessions` stores server-side native OIDC sessions. Browser cookies
contain only random opaque tokens; SQLite stores their SHA-256 hashes, the OIDC
subject, creation time, optional last-seen time, expiry time, and optional
revocation time. Session rows do not store OIDC tokens, authorization codes,
raw claims, client secrets, or role decisions. Current role and permission
decisions are read from the matching `app_users` row on each API request.

## Recovery admin

`recovery_admin_credentials` and `recovery_admin_sessions` are used only when
`RECOVERY_ADMIN_ENABLED=true`. Recovery credentials store a scrypt password
hash, salt, and password-change timestamp for the configured break-glass
username. The initial bootstrap password from a mounted secret file or
environment fallback is not persisted and is ignored once a recovery credential
exists.

Recovery sessions use a separate opaque browser cookie. SQLite stores only the
session token hash, username, creation time, optional last-seen time, expiry
time, revocation time, and whether the session is still restricted to password
change. A password-change-required session cannot authorize normal API
requests. After the recovery password is set, the recovery user is represented
as an internal admin `app_users` actor with an external subject shaped like
`recovery:<username>`.

## Care entries

Care entries contain start/end, status, care scope, overnight and holiday
flags, additional care, location, handover, notes, evidence reference,
calculated duration, contact-time classification, and an optional
`responsible_party_id`. If a new entry or contact rule does not provide a
responsible party, the server uses the configured
`defaultResponsiblePartyId` setting when an active care party is available.
`primaryCarePartyId` is a separate setting for domain-level fallbacks, for
example when holiday periods are analyzed before individual care entries have
been recorded. It does not change the default responsible party for newly
created entries.
Supported stored statuses are `planned`, `completed`, `partial`, and
`cancelled`. The API can additionally expose a derived `unconfirmed`
confirmation state for planned entries whose end time is already in the past.
Children, trips, and costs are persisted transactionally.

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

Entries that differ from the original plan can store transparent deviation
metadata directly on `care_entries`: `planned_start_datetime`,
`planned_end_datetime`, `deviation_type`, and `deviation_note`. Supported
deviation types cover cancellation, partial completion, rescheduling, swapped
or compensation dates, externally blocked care, and other factual deviations.
This keeps the original planned period traceable without introducing a second
opaque planning table.

Partially completed entries keep the planned entry intact and store actual
completion details separately: `actual_start_datetime`,
`actual_end_datetime`, `actual_responsible_party_id`, and
`care_entry_actual_children`. Reports and holiday allocation use these actual
values for `partial` entries, while planned child assignments and planned times
remain available for auditability and later comparison.

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
and monthly JSON shapes. Rules with an explicit end date synchronize their
complete configured range up to 36 months. Open-ended rules retain a rolling
future window controlled by `sync_horizon_months`, which defaults to 12 months.
Saving a rule creates planned `care_entries`; an explicit synchronization action
can bring an existing rule up to date without changing its definition. Existing legacy
`contact_patterns` are mirrored into `contact_rules` with a weekly recurrence,
two-week interval, Friday anchor, and a Friday-to-Sunday segment.
`responsible_party_id` is copied from the rule to generated planned entries.
Occurrence keys keep synchronization idempotent, while cancelled or manually
changed entries are preserved as exceptions.

## Holidays and unavailable periods

Holiday blocks document official or agreed holiday periods for one or more
children. They are calendar-visible planning frames, not the source of care
credit. The legacy `assigned_to` value is retained for backup and migration
compatibility, but new UI flows treat holiday credit as normal care entries
whose dates overlap a holiday block and whose `responsible_party_id` identifies
the credited care party. This allows long holidays to be split into several
regular care entries, for example one week with one care party and later weeks
with another. Aggregate holiday statistics count calendar days, not one full
day per child. Where several children are covered, each child's assignment
contributes an equal share of the calendar day. Completed or partial care takes
precedence over planned care; uncovered shares fall back to
`primaryCarePartyId`. Duplicate entries for the same care party do not increase
the credited share, and overlapping holiday blocks do not increase the number
of holiday days.

Unavailable periods record category, duty relationship, effects on contact or
holiday planning, location, notes, and evidence reference. The `scope` field
separates the care party's own unavailability from externally blocked contact
periods where contact was wanted or possible but prevented by another
child-related arrangement. External contact blocks can reference affected
children and the care party whose contact was blocked. Neither holiday blocks
nor unavailable periods automatically change actual care entries.

## Monthly closure

The monthly closing stores a JSON summary, `closed_by`, and records changes
after closing with `updated_by`. It is an organizational control, not a
write-once archive.

## Portable instance transfer

The versioned portable transfer envelope contains the complete domain-data
shape, source version, export time, historical actor snapshots, and a canonical
SHA-256 checksum. Historical actors use transfer-local references and retain a
display name, optional email hint, suggested workspace role, and proposed care
party assignments. OIDC subjects and claims are deliberately excluded.

`data_transfer_runs` records a completed import and its tested package
fingerprint. `data_transfer_actors` stores non-login historical actor snapshots
created by that import and an optional explicit mapping to a target
`app_users` record. `data_transfer_actor_care_parties` stores proposed
care-party mappings. `app_invitations.data_transfer_actor_id` can connect an
invitation to one snapshot so accepting it applies only the explicitly selected
role and care-party assignments.

A dry run imports the same normalized data into a temporary current-schema
SQLite database and runs foreign-key, integrity, and domain-reference checks.
It does not write a transfer run, actor mapping, settings, audit entry, or file
to the target installation. A real import replaces domain data in one
transaction only after revalidation of the exact tested fingerprint. Existing
legacy JSON exports remain supported as format version 0, without historical
actor snapshots.

## Migrations

SQL files in `server/migrations/` are applied in lexical order and recorded in
`schema_migrations`. Build copies them into `dist-server/server/migrations`.
Never edit an already released migration; add a new numbered migration and
update this document.

Migration `029_local_development_identity_cleanup` marks the introduction of a
mode-aware startup cleanup. Outside local mode, runtime access is removed from
the exact technical `local-dev` identity while its historical `app_users`
record remains available for existing audit references. Active memberships,
care-party assignments, calendar feeds, push subscriptions, and unanswered
confirmation requests are disabled. Local mode and an explicitly configured
local development owner remain unchanged.

Migration `030_portable_data_transfer` adds transfer runs, historical actor
snapshots, proposed care-party mappings, optional target-member mappings, and
the invitation link used for an explicitly mapped historical actor. It does not
change existing domain records or authentication identities.
