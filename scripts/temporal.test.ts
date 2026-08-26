import assert from "node:assert/strict";
import test from "node:test";
import {
  dateKeysForInclusiveRange,
  dateKeysForTimedRange,
  formatDateTimeRange,
  isValidTimedRange
} from "../shared/temporal.js";

test("timed ranges do not occupy an exclusive midnight end date", () => {
  assert.deepEqual(
    dateKeysForTimedRange("2026-08-07T16:00:00+02:00", "2026-08-08T00:00:00+02:00"),
    ["2026-08-07"]
  );
});

test("timed ranges include every touched date before the exclusive end", () => {
  assert.deepEqual(
    dateKeysForTimedRange("2026-08-07T16:00:00+02:00", "2026-08-09T18:00:00+02:00"),
    ["2026-08-07", "2026-08-08", "2026-08-09"]
  );
});

test("date-only ranges include their declared end date", () => {
  assert.deepEqual(dateKeysForInclusiveRange("2026-08-07", "2026-08-09"), [
    "2026-08-07",
    "2026-08-08",
    "2026-08-09"
  ]);
});

test("timed range validation rejects equal and reversed ranges", () => {
  assert.equal(isValidTimedRange("2026-08-07T16:00", "2026-08-07T16:00"), false);
  assert.equal(isValidTimedRange("2027-02-05T15:00", "2026-02-08T19:00"), false);
  assert.equal(isValidTimedRange("2026-12-31T23:00", "2027-01-01T01:00"), true);
});

test("date-time ranges render same-day and multi-day values without hiding the end date", () => {
  assert.deepEqual(
    formatDateTimeRange("2026-08-07T16:00:00+02:00", "2026-08-07T18:00:00+02:00", "de-DE"),
    { start: "07.08.2026", end: "16:00–18:00", sameDay: true }
  );
  assert.deepEqual(
    formatDateTimeRange("2026-08-07T16:00:00+02:00", "2026-08-09T18:00:00+02:00", "de-DE"),
    { start: "07.08.2026, 16:00", end: "09.08.2026, 18:00", sameDay: false }
  );
});
