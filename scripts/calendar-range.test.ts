import assert from "node:assert/strict";
import test from "node:test";
import { calendarGridRange, filterCalendarOverlayEvents, isoWeekNumber } from "../src/lib/calendar";
import { timedRangeDaySegment } from "../src/lib/date";
import type { ExternalCalendarEvent, ExternalCalendarSource } from "../src/types";

test("calendar grid range covers all six visible weeks", () => {
  assert.deepEqual(calendarGridRange("2026-08"), {
    startDate: "2026-07-27",
    endDate: "2026-09-06"
  });
});

test("ISO calendar weeks use Monday-based week years", () => {
  assert.equal(isoWeekNumber("2026-01-01"), 1);
  assert.equal(isoWeekNumber("2027-01-01"), 53);
  assert.equal(isoWeekNumber("2027-01-04"), 1);
});

test("multi-day timed ranges expose accurate agenda segments", () => {
  const start = "2026-08-03T17:00:00.000Z";
  const end = "2026-08-06T19:00:00.000Z";

  assert.equal(timedRangeDaySegment(start, end, "2026-08-02"), null);
  assert.equal(timedRangeDaySegment(start, end, "2026-08-03"), "starts");
  assert.equal(timedRangeDaySegment(start, end, "2026-08-04"), "full-day");
  assert.equal(timedRangeDaySegment(start, end, "2026-08-05"), "full-day");
  assert.equal(timedRangeDaySegment(start, end, "2026-08-06"), "ends");
});

test("an exclusive midnight ending does not create another agenda day", () => {
  const start = "2026-08-03T00:00:00.000Z";
  const end = "2026-08-05T00:00:00.000Z";

  assert.equal(timedRangeDaySegment(start, end, "2026-08-03"), "full-day");
  assert.equal(timedRangeDaySegment(start, end, "2026-08-04"), "full-day");
  assert.equal(timedRangeDaySegment(start, end, "2026-08-05"), null);
});

test("agenda segments remain continuous across a month boundary", () => {
  const start = "2026-08-31T17:00:00.000Z";
  const end = "2026-09-02T19:00:00.000Z";

  assert.equal(timedRangeDaySegment(start, end, "2026-08-31"), "starts");
  assert.equal(timedRangeDaySegment(start, end, "2026-09-01"), "full-day");
  assert.equal(timedRangeDaySegment(start, end, "2026-09-02"), "ends");
});

test("holiday sources are not rendered as duplicate calendar overlays", () => {
  const sources: ExternalCalendarSource[] = [
    {
      id: "holiday-source",
      name: "Ferien",
      color: "#f0c000",
      visible: true,
      sourceType: "holiday",
      sourceKind: "file",
      lastImportedAt: "2026-08-01T10:00:00.000Z",
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z"
    },
    {
      id: "overlay-source",
      name: "Termine",
      color: "#2864dc",
      visible: true,
      sourceType: "overlay",
      sourceKind: "file",
      lastImportedAt: "2026-08-01T10:00:00.000Z",
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z"
    }
  ];
  const events: ExternalCalendarEvent[] = [
    {
      id: "holiday-event",
      sourceId: "holiday-source",
      sourceName: "Ferien",
      sourceColor: "#f0c000",
      title: "Sommerferien",
      startDateTime: "2026-07-20T00:00:00.000Z",
      endDateTime: "2026-09-02T00:00:00.000Z",
      allDay: true
    },
    {
      id: "overlay-event",
      sourceId: "overlay-source",
      sourceName: "Termine",
      sourceColor: "#2864dc",
      title: "Schulfest",
      startDateTime: "2026-08-22T10:00:00.000Z",
      endDateTime: "2026-08-22T12:00:00.000Z",
      allDay: false
    }
  ];

  assert.deepEqual(filterCalendarOverlayEvents(events, sources).map((event) => event.id), ["overlay-event"]);
});
