# External calendars and holiday sources

The application can add provider-independent iCalendar sources as read-only
calendar overlays. Sources can be uploaded as local `.ics` files or added as an
HTTPS feed URL. Imported events are not care entries, report data, analytics
input, or custody statistics by themselves.

Each imported source has a source type:

- `Calendar overlay only`: events stay read-only overlays in the calendar.
- `Holiday source`: all-day events can be explicitly converted into holiday
  blocks from the holiday management page.

Deriving holiday blocks is always manual. Replacing, refreshing, or re-importing
an external calendar never silently changes existing holiday blocks. Events that
were already derived from the same imported event are skipped on later
derivation runs.

Holiday periods are planning frames. They do not automatically replace regular
recurring care entries. If a recurring care date falls inside a holiday period,
the calendar keeps both visible so the user can deliberately confirm, edit,
reschedule, or cancel the actual care entry.

## Supported input

- `VCALENDAR` with `VEVENT` entries
- `UID`, optional `RECURRENCE-ID`, `SUMMARY`, optional `DESCRIPTION` and `LOCATION`
- all-day and timed events, folded lines, escaped text, and common time-zone values
- all-day events use iCalendar's exclusive `DTEND` convention

## Feed URLs

Feed URLs must use HTTPS, must not contain embedded username/password
credentials, and must not point to obvious local/private hosts. They may still
contain bearer-like query tokens from the calendar provider. Treat them like
passwords. The server stores the full URL so the feed can be refreshed, but API
responses and the UI show only a redacted URL.

Refreshing a URL feed validates the new content before replacing stored events.
If refresh fails, the existing events remain available and the source records a
generic refresh error.

## Limits and exclusions

Files and fetched feeds are limited to 1 MB and 2,000 events. Feed downloads use
a timeout and size checks. Recurrence rules (`RRULE`) are rejected rather than
silently expanded or misrepresented; explicit recurrence instances with
`RECURRENCE-ID` are supported. CalDAV, provider-specific behavior, background
sync scheduling, and editing imported events are not supported.

## Replacement and privacy

Replacing a source validates the complete file or feed before a single
transaction updates the source. Events no longer contained in the replacement
are removed. Deleting a source deletes its events. Raw uploaded `.ics` files are
never retained. Source metadata and normalized events are included in JSON
backup and restore data, but raw external feed URLs are not exported by the app
data backup.

Already derived holiday blocks stay in holiday management even if the source is
replaced or deleted. This keeps documented holiday planning auditable and avoids
silent data loss.
