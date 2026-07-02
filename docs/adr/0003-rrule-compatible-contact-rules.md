# ADR 0003: RRULE-compatible contact rules

## Status

Accepted for `v1.6.0`.

## Context

`v1.5.0` introduced flexible contact rules, automatic synchronization, care
parties, and scoped calendar feeds. The first UI still led with fixed presets
such as biweekly weekends, weekly weekdays, first/third weekends, and last
Friday. That improved the old 14-day special case but still made unusual family
arrangements feel software-defined instead of user-defined.

The application needs a more calendar-like recurrence model without exposing
raw iCalendar syntax to non-technical users.

## Decision

`v1.6.0` adds an RRULE-compatible recurrence shape:

```ts
type ContactRuleRecurrence =
  | ExistingWeeklyOrMonthlyShape
  | {
      kind: "rrule";
      rrules: string[];
    };
```

The UI remains control-based. Users choose frequency, interval, weekdays or a
monthly pattern, optional end date, and one or more time spans. The application
builds validated RRULE lines internally.

Supported RRULE scope is intentionally bounded:

- `FREQ=DAILY|WEEKLY|MONTHLY`
- `INTERVAL`
- `BYDAY`
- `BYMONTHDAY`
- `BYSETPOS`
- `COUNT`
- `UNTIL`

Unsupported frequencies, time-of-day rule parts, duplicate keys, excessive
counts, and unsupported fields are rejected server-side.

## Consequences

- Existing `weekly` and `monthlyByWeekday` rules remain readable and continue
  to synchronize.
- New rules can represent more custody/contact models without adding more
  template-specific code.
- The server and frontend preview both use the maintained `rrule` package for
  recurrence expansion.
- Planned entry synchronization stays idempotent and still preserves completed,
  cancelled, deleted, or manually changed generated entries.
- The database table does not need a new column because `contact_rules` already
  stores validated recurrence JSON in `recurrence_json`.
