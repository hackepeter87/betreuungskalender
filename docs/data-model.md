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

## Soft delete

Business tables use `deleted_at`. API list and detail queries return active rows
only. DELETE operations mark records instead of removing them. Junction rows,
trips, and costs follow the same principle. Audit records retain the change.

## Audit log

`audit_log` stores timestamp, asserted API identity, entity type and ID, action,
field name, old/new serialized values, and optional metadata. It improves
traceability but is not an immutable external timestamp or cryptographic proof.

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

The monthly closing stores a JSON summary and records changes after closing.
It is an organizational control, not a write-once archive.

## Browser JSON export

The browser backup envelope contains an application identifier, export
timestamp, schema version, children, care entries with trips and costs,
holidays, contact patterns, unavailable periods, audit entries, monthly
closures, settings, and backup metadata. Import normalizes older supported
schema versions.

## Migrations

SQL files in `server/migrations/` are applied in lexical order and recorded in
`schema_migrations`. Build copies them into `dist-server/server/migrations`.
Never edit an already released migration; add a new numbered migration and
update this document.
