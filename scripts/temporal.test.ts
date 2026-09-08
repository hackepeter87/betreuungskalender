import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ENUMERATED_DATE_KEYS,
  dateKeysForInclusiveRange,
  dateKeysForTimedRange,
  formatCivilTime,
  formatDateTimeRange,
  isValidDateKey,
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

test("date enumeration clips existing oversized ranges before allocating results", () => {
  assert.deepEqual(
    dateKeysForInclusiveRange("1900-01-01", "2200-12-31", {
      clipStart: "2026-07-27",
      clipEnd: "2026-09-06",
      maximumDays: 42
    }),
    dateKeysForInclusiveRange("2026-07-27", "2026-09-06")
  );
});

test("date enumeration rejects work above its explicit budget", () => {
  assert.throws(
    () => dateKeysForInclusiveRange("2000-01-01", "2200-12-31"),
    (error: unknown) => error instanceof RangeError && error.message.includes(String(MAX_ENUMERATED_DATE_KEYS))
  );
});

test("timed ranges can be clipped to the visible calendar window", () => {
  assert.deepEqual(
    dateKeysForTimedRange("1900-01-01T12:00", "2200-12-31T18:00", {
      clipStart: "2026-08-01",
      clipEnd: "2026-08-31",
      maximumDays: 31
    }),
    dateKeysForInclusiveRange("2026-08-01", "2026-08-31")
  );
});

test("date keys reject normalized and impossible calendar dates", () => {
  assert.equal(isValidDateKey("2028-02-29"), true);
  assert.equal(isValidDateKey("2027-02-29"), false);
  assert.equal(isValidDateKey("2026-13-01"), false);
  assert.deepEqual(dateKeysForInclusiveRange("2026-02-30", "2026-03-02"), []);
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

test("civil times remain stable across host time zones", () => {
  assert.equal(formatCivilTime("2026-08-07T16:00:00+02:00", "de-DE"), "16:00");
  assert.equal(formatCivilTime("2026-08-07T15:00:00.000Z", "de-DE"), "15:00");
});
