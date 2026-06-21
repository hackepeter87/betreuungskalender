# External holiday calendars

The application can import provider-independent `.ics` files as read-only calendar overlays. Imported events are not care entries, internal holiday periods, report data, exports, analytics input, or custody statistics.

## Supported input

- `VCALENDAR` with `VEVENT` entries
- `UID`, optional `RECURRENCE-ID`, `SUMMARY`, optional `DESCRIPTION` and `LOCATION`
- all-day and timed events, folded lines, escaped text, and common time-zone values
- all-day events use iCalendar's exclusive `DTEND` convention

## Limits and exclusions

Files are limited to 1 MB and 2,000 events. Recurrence rules (`RRULE`) are rejected rather than silently expanded or misrepresented; explicit recurrence instances with `RECURRENCE-ID` are supported. URL subscriptions, background refresh, CalDAV, provider-specific behavior, and editing imported events are not supported.

## Replacement and privacy

Replacing a source validates the complete file before a single transaction updates the source. Events no longer contained in the replacement are removed. Deleting a source deletes its events. Raw uploaded `.ics` files are never retained. Source metadata and normalized events are included in JSON backup and restore data.
