# ADR 0002: Flexible contact rules, care parties, and calendar feeds

## Status

Accepted for `v1.5.0`.

## Context

Recurring contact is currently modeled as `contact_patterns`: one biweekly
Friday-to-Sunday pattern with `friday_start_time` and `sunday_end_time`.
Saving the pattern does not place entries into the calendar. A separate
generation action creates `care_entries`, and the generated entries are tied to
the technical pattern ID and occurrence date.

That model is too narrow for real contact arrangements. Families may use weekly
weekday visits, alternating weekends, first and third weekends, last-Friday
rules, or other predictable rhythms. The app also currently has no fachliche
betreuende Person separate from the authenticated `app_users` actor. Personal
iCalendar feeds therefore export entries by `created_by`, which is useful for
audit attribution but not a reliable ownership signal for "children are with
this person".

The primary product is still solo-first self-management. Optional shared use is
allowed when the caring persons agree, but it must not become a prerequisite for
using the app.

## Decision

`v1.5.0` will replace the 14-day special case with flexible contact rules and
automatic calendar synchronization.

The target user flow is:

1. Create or choose children.
2. Choose or create the responsible care party.
3. Pick a recurrence preset or configure a custom recurrence.
4. Review a calendar-style preview.
5. Save the rule.
6. See planned entries in the calendar immediately.

There is no separate required "generate" step in the normal workflow. Saving a
rule synchronizes planned `care_entries` for a default 12-month planning
horizon.

## Recurrence Model

The UI must not require users to type raw RRULE strings. The internal model will
use a validated JSON recurrence shape that can be expanded through an
established recurrence library and mapped to RFC 5545 concepts.

Initial recurrence support:

- every N weeks on one or more weekdays
- every N months on ordinal weekdays, including first, second, third, fourth,
  fifth, and last
- presets for every-other-weekend, weekly weekday contact, first and third
  weekend, last Friday, and custom rule

The normalized public shape is:

```ts
type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";
type MonthlyOrdinal = 1 | 2 | 3 | 4 | 5 | -1;

type ContactRuleRecurrence =
  | {
      kind: "weekly";
      intervalWeeks: number;
      weekdays: Weekday[];
    }
  | {
      kind: "monthlyByWeekday";
      intervalMonths: number;
      ordinals: MonthlyOrdinal[];
      weekdays: Weekday[];
    };

interface ContactRuleSegment {
  id: string;
  startDayOffset: number;
  startTime: string;
  endDayOffset: number;
  endTime: string;
}

interface ContactRuleRange {
  startDate: string;
  endDate?: string;
}

interface ContactRule {
  id: string;
  name: string;
  childIds: string[];
  responsiblePartyId: string;
  timezone: string;
  range: ContactRuleRange;
  recurrence: ContactRuleRecurrence;
  segments: ContactRuleSegment[];
  syncHorizonMonths: number;
  active: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}
```

For the initial German deployment, `timezone` defaults to `Europe/Berlin`.
Rules use civil local dates and `HH:mm` times. Recurrence expansion must not be
implemented by adding a fixed number of UTC hours because daylight-saving
transitions must not shift local care times.

## Calendar Synchronization

The server is responsible for synchronization. Frontend preview code can use the
same shared expansion helpers, but the API result is authoritative.

On create or update:

- validate the rule, segments, children, responsible party, and sync range
- store the rule transactionally
- expand occurrences for the sync window
- create missing planned `care_entries`
- update only unmodified future planned entries generated from the same rule
- preserve completed, cancelled, deleted, or manually changed entries
- return a sync summary with created, updated, skipped, and preserved counts

Default sync window:

- start: first day of the current month, unless the rule starts later
- end: start plus `syncHorizonMonths`, default 12
- if the rule has an earlier end date, the rule end date caps the window

The UI may offer an explicit backfill range, but automatic save must never
silently create years of historical entries.

Each generated entry stores enough metadata to make future synchronization
idempotent:

- `contact_rule_id`
- `contact_rule_segment_id`
- `contact_rule_occurrence_key`
- `responsible_party_id`
- a sync state that distinguishes unchanged generated entries from manual
  overrides

The existing `generated_by_pattern_id` and `rule_occurrence_date` fields remain
for migration and compatibility until the old `contact_patterns` model is fully
removed.

## Care Parties

`app_users` are technical actors for authentication, authorization, and audit.
They are not the domain concept for "children are with this person".

`v1.5.0` introduces care parties:

```ts
interface CareParty {
  id: string;
  name: string;
  kind: "father" | "mother" | "grandparent" | "foster_caregiver" | "other";
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}
```

Solo operation remains the default. A user with write permission can manage all
care parties and entries without assigning OIDC users to parties.

Optional shared operation is modeled separately:

```ts
interface AppUserPartyAssignment {
  appUserId: string;
  carePartyId: string;
}
```

This assignment is used for defaults, filtering, and feed scope. It is not a
replacement for `app_users.role`; authorization remains `admin`, `parent`, and
`readonly`.

## Persistence and Migration

Add new migrations instead of editing released migrations.

New tables:

- `care_parties`
- `app_user_care_party_assignments`
- `contact_rules`
- `contact_rule_children`
- optional `contact_rule_exceptions` if the implementation stores exceptions
  outside `care_entries`

Extend existing tables:

- `care_entries` gains contact-rule metadata and `responsible_party_id`
- `calendar_feed_tokens` gains feed scope metadata

Migration rules:

- existing `contact_patterns` become `contact_rules` with weekly recurrence,
  `intervalWeeks=2`, weekday `FR`, and one segment Friday start to Sunday end
- existing generated entries keep their old metadata and receive the matching
  new rule metadata where it can be derived safely
- existing installations get default care parties that preserve current
  father/mother semantics; labels are editable after migration
- new installations may use neutral default labels, but users must be able to
  rename care parties before relying on reports or feeds
- existing calendar feed tokens keep a legacy user-created scope until rotated
  or explicitly changed

## API and Frontend Contracts

New endpoints:

- `GET /api/contact-rules`
- `POST /api/contact-rules`
- `PUT /api/contact-rules/:id`
- `DELETE /api/contact-rules/:id`
- `POST /api/contact-rules/:id/sync` for explicit backfill or resync
- `GET /api/care-parties`
- `POST /api/care-parties`
- `PUT /api/care-parties/:id`
- `DELETE /api/care-parties/:id`
- `GET /api/app-users`
- `GET /api/user-care-party-assignments`
- `PUT /api/user-care-party-assignments/:userId`

The normal `POST` and `PUT` contact-rule endpoints perform synchronization and
return the saved rule plus sync summary.

`/api/calendar-feed` keeps its existing behavior but gains a feed scope when
new or rotated tokens are created:

```ts
type CalendarFeedScope =
  | "legacy"
  | "all"
  | `party:${string}`;
```

Feed output continues to exclude notes, evidence references, trips, costs,
deleted entries, cancelled entries, audit metadata, and internal identifiers.
The feed remains a bearer-secret read-only iCalendar URL, not CalDAV.

## UX Requirements

The contact-rules page must be understandable without knowing calendar jargon.
The primary controls are presets and plain-language fields. Advanced details can
exist, but raw recurrence syntax is not the default UI.

The preview must show actual calendar days. It must distinguish:

- preview-only occurrences
- entries already synchronized into the calendar
- manually changed or cancelled exceptions

After saving, the UI must show a concrete result such as:

```text
12 Termine bis 31. Juli 2027 im Kalender eingetragen.
```

Opening a generated rule entry must offer the calendar-standard choice:

- edit only this appointment
- edit the series

## Implementation Order

The implementation is split into reviewable packages:

- #137 implements the recurrence model, migration scaffolding, and generator
  tests.
- #140 wires rule save/update to automatic planned-entry synchronization.
- #138 rebuilds the contact-rules UX around presets and calendar-style preview.
- #139 implements single-occurrence versus series editing and exception
  preservation.
- #144 introduces care parties as the fachliche owner model.
- #141 moves personal calendar feeds from `created_by` ownership to explicit
  feed scopes.
- #142 adds optional OIDC user-to-party assignment for shared operation.
- #143 provides end-to-end coverage for rule creation, calendar display, and
  feed scope.
- #145 updates release, migration, and operations documentation.

## Consequences

Positive:

- The core workflow matches user expectations from common calendar software.
- Saving a rule has an immediately visible calendar effect.
- Recurrence logic becomes testable and extensible instead of being hidden in a
  14-day special case.
- Calendar feeds can represent fachliche care ownership instead of audit actor
  history.
- Optional shared use can grow without making solo use more complicated.

Negative:

- The data model becomes more complex.
- Migrations must preserve existing `contact_patterns`, generated entries, and
  feed tokens.
- Reports and labels that currently assume father/mother need careful
  follow-up work.
- Recurrence edge cases require stronger tests than the current fixed 14-day
  generator.

## Non-Goals

- Do not implement CalDAV or calendar writeback in `v1.5.0`.
- Do not make multi-user operation mandatory.
- Do not expose raw RRULE editing as the primary UI.
- Do not silently regenerate or overwrite manually changed historical entries.
- Do not remove existing feed tokens during migration.
- Do not change the `latest` container tag policy; `latest` remains production.

## Acceptance Gates

Before `v1.5.0` can be considered releasable:

- `npm run lint`
- `npm run test`
- `npm run build`
- browser/E2E coverage for the contact-rule creation flow
- generator tests for weekly, biweekly, monthly ordinal, last weekday, range
  boundaries, and daylight-saving behavior
- API tests for idempotent synchronization and preserved manual changes
- feed tests for legacy user scope, all scope, and care-party scope
- migration tests for existing `contact_patterns` and existing feed tokens
