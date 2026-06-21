import assert from "node:assert/strict";
import test from "node:test";
import { ExternalCalendarError, parseIcs } from "./services/externalCalendars.js";

const calendar = (event: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${event}\r\nEND:VCALENDAR\r\n`;

test("parses all-day events with exclusive DTEND and escaped text", () => {
  const [event] = parseIcs(calendar("BEGIN:VEVENT\r\nUID:test-1\r\nSUMMARY:Spring\\, break\r\nDESCRIPTION:Line one\\nLine two\r\nDTSTART;VALUE=DATE:20260403\r\nDTEND;VALUE=DATE:20260406\r\nEND:VEVENT"));
  assert.equal(event?.allDay, true);
  assert.equal(event?.icalUid, "test-1");
  assert.equal(event?.title, "Spring, break");
  assert.equal(event?.startDateTime, "2026-04-03T00:00:00.000Z");
  assert.equal(event?.endDateTime, "2026-04-06T00:00:00.000Z");
});

test("parses timed events and normalizes missing recurrence IDs", () => {
  const [event] = parseIcs(calendar("BEGIN:VEVENT\r\nUID:test-2\r\nSUMMARY:Timed\r\nDTSTART:20260501T090000Z\r\nDTEND:20260501T100000Z\r\nEND:VEVENT"));
  assert.equal(event?.allDay, false);
  assert.equal(event?.recurrenceId, "");
});

test("rejects malformed calendars and unsupported recurrence rules", () => {
  assert.throws(() => parseIcs("BEGIN:VEVENT\nEND:VEVENT"), ExternalCalendarError);
  assert.throws(() => parseIcs(calendar("BEGIN:VEVENT\r\nUID:test-3\r\nDTSTART:20260501T090000Z\r\nDTEND:20260501T100000Z\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT")), (error: unknown) => error instanceof ExternalCalendarError && error.code === "external_calendar_recurrence_unsupported");
});
