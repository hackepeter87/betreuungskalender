import assert from "node:assert/strict";
import test from "node:test";
import { agendaDateKeys, agendaDayPhase } from "../src/lib/agenda";
import { calendarGridRange, filterCalendarOverlayEvents, isoWeekNumber } from "../src/lib/calendar";
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

test("agenda ranges cover every occupied day inside the selected month", () => {
  assert.deepEqual(
    agendaDateKeys(
      "2026-07-31T17:00:00.000Z",
      "2026-08-03T19:00:00.000Z",
      "2026-08-01",
      "2026-08-31"
    ),
    ["2026-08-01", "2026-08-02", "2026-08-03"]
  );
});

test("agenda day phases preserve the actual range across month boundaries", () => {
  const start = "2026-07-31T17:00:00.000Z";
  const end = "2026-08-03T19:00:00.000Z";
  assert.equal(agendaDayPhase(start, end, "2026-07-31"), "start");
  assert.equal(agendaDayPhase(start, end, "2026-08-01"), "middle");
  assert.equal(agendaDayPhase(start, end, "2026-08-03"), "end");
});

test("agenda ranges exclude a midnight end date", () => {
  const start = "2026-08-07T16:00:00.000Z";
  const end = "2026-08-08T00:00:00.000Z";
  assert.deepEqual(agendaDateKeys(start, end, "2026-08-01", "2026-08-31"), ["2026-08-07"]);
  assert.equal(agendaDayPhase(start, end, "2026-08-07"), "single");
  assert.equal(agendaDayPhase(start, end, "2026-08-08"), null);
});
