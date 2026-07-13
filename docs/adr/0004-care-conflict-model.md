# ADR 0004: Care conflict model and workflow responsibilities

## Status

Accepted for `v1.18.0`.

## Context

The application stores planned and actual care, recurring contact rules,
holiday periods, and unavailability as separate records. Real schedules can
overlap, but the records have different meanings. Treating every overlap as an
automatic cancellation would lose factual information, while counting
contradictory actual care twice would make reports unreliable.

The calendar, agenda, entry list, contact-rule page, holiday page, and reports
must therefore use one conflict model. The model must preserve existing data,
avoid silent changes, and remain understandable to non-technical users.

## Decision

### Domain responsibilities

- A holiday period is a visible planning and reporting frame. It never creates,
  cancels, or replaces a care entry by itself.
- An unavailable period is neutral documentation. It may explain an overlap,
  but never changes the status of a care entry automatically.
- A contact rule creates planned care entries. Later confirmation, partial
  completion, rescheduling, and cancellation are care-entry actions.
- A care entry is the authoritative record for planned or actual care.

### Status semantics

- `planned` describes an intended period. Planned overlaps are allowed because
  users may still need to resolve or document them.
- `completed` describes actual care with the planned children and period.
- `partial` describes actual care using `actual_start_datetime`,
  `actual_end_datetime`, `actual_responsible_party_id`, and the actual child
  assignment when present.
- `cancelled` remains visible for traceability but receives no actual-care or
  holiday credit.
- Deleted entries do not participate in conflict detection or reporting.

### Conflict definition

Two care entries conflict when all of the following are true:

- both entries cover at least one identical child;
- their effective time intervals overlap;
- neither entry is deleted or cancelled.

Time intervals are half-open. An entry ending at `18:00` does not conflict with
another entry beginning at `18:00`.

Planned conflicts are warnings. They remain writable and visible in calendar,
agenda, and entry views. A new or changed `completed` or `partial` entry must be
rejected when it overlaps another actual entry for the same child. The server
is authoritative and performs this validation in the write transaction.

### Existing conflicts

The update does not rewrite, delete, or automatically resolve existing data.
Existing contradictory actual entries remain readable and are shown as
unresolved conflicts until a user edits the source entries.

Reports must not double-count overlapping actual time. Overlap belonging to the
same care party is counted once. Non-overlapping portions remain attributed to
their care party. An overlapping portion attributed to different care parties
is excluded from party-specific credit and reported as unresolved.

For holiday allocation, the holiday day remains part of the total holiday
period. A contradictory child share is shown as unresolved and is not silently
split between care parties. Non-conflicting care and the established primary
care fallback continue to apply.

## View responsibilities

- **Calendar:** temporal overview, overlays, conflict indicators, and quick
  creation of care or unavailability.
- **Agenda:** chronological view of the selected calendar month.
- **Entries:** authoritative list for searching, editing, confirming,
  rescheduling, partially completing, and cancelling care entries.
- **Contact rules:** recurrence configuration, preview, synchronization, and
  visibility of preserved exceptions. It is not a second entry-management
  screen.
- **Holidays:** holiday frames and allocation analysis. Care is still recorded
  through care entries.
- **Unavailability:** separate factual documentation with derived overlap
  notices.

## API and authorization consequences

The regular application-data response may add derived conflict summaries.
They are not persisted and must be calculated only from entries visible to the
requesting user. Older clients may ignore the additive field, and newer clients
must treat a missing field as an empty list.

Write rejection uses a generic conflict error and must not reveal identifiers
or details of records outside the caller's visible scope. Request bodies,
identity headers, conflict contents, and case data are not logged.

## Consequences

- There is no schema migration for conflict records.
- Existing installations can expose unresolved conflicts immediately after an
  update because the summaries are derived.
- Reported values can change when previous calculations double-counted
  overlapping actual care.
- Recurring rule synchronization continues to create planned entries even when
  warnings result; it does not fail the complete synchronization run.
- Conflict detection must scale by grouping and sorting entries per child
  rather than comparing every entry with every other entry.

## Required verification

- Planned overlaps are saved and shown as warnings.
- Conflicting actual writes are rejected atomically.
- Adjacent intervals and entries for different children are accepted.
- Partial care uses its actual period and children.
- Existing conflicts remain readable and do not cause double counting.
- Calendar, agenda, entries, holiday allocation, PDF, and CSV use the same
  conflict semantics.
