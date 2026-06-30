import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyData } from "../src/data/defaults.js";
import { generatePatternEntries } from "../src/lib/contact.js";
import type { AppData, CareEntry, ContactPattern } from "../src/types.js";

const timestamp = "2026-01-01T00:00:00.000Z";

function pattern(overrides: Partial<ContactPattern> = {}): ContactPattern {
  return {
    id: "pattern-test",
    name: "14-Tage-Regel",
    startDate: "2026-07-03",
    frequency: "biweekly",
    fridayStartTime: "16:00",
    sundayEndTime: "18:00",
    childIds: ["child-a"],
    active: true,
    createdBy: "local-dev",
    updatedBy: "local-dev",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function existingGeneratedEntry(occurrence: string): CareEntry {
  return {
    id: `entry-${occurrence}`,
    date: occurrence,
    startDateTime: `${occurrence}T16:00`,
    endDateTime: `${occurrence}T18:00`,
    childIds: ["child-a"],
    status: "planned",
    additionalCare: false,
    generatedByPatternId: "pattern-test",
    ruleOccurrenceDate: occurrence,
    overnight: true,
    schoolHandover: false,
    holiday: false,
    weekend: true,
    location: "commuterApartment",
    handoverFrom: "mother",
    handoverTo: "mother",
    hasEvidence: false,
    trips: [],
    costs: [],
    createdBy: "local-dev",
    updatedBy: "local-dev",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function dataWithEntries(entries: CareEntry[] = []): AppData {
  return {
    ...createEmptyData(),
    entries
  };
}

test("generates biweekly Friday-to-Sunday planned contact dates", () => {
  const generated = generatePatternEntries(
    dataWithEntries(),
    pattern(),
    "2026-07-01",
    "2026-07-31"
  );

  assert.deepEqual(
    generated.map((entry) => ({
      occurrence: entry.ruleOccurrenceDate,
      start: entry.startDateTime,
      end: entry.endDateTime,
      status: entry.status,
      overnight: entry.overnight,
      weekend: entry.weekend
    })),
    [
      {
        occurrence: "2026-07-03",
        start: "2026-07-03T16:00",
        end: "2026-07-05T18:00",
        status: "planned",
        overnight: true,
        weekend: true
      },
      {
        occurrence: "2026-07-17",
        start: "2026-07-17T16:00",
        end: "2026-07-19T18:00",
        status: "planned",
        overnight: true,
        weekend: true
      },
      {
        occurrence: "2026-07-31",
        start: "2026-07-31T16:00",
        end: "2026-08-02T18:00",
        status: "planned",
        overnight: true,
        weekend: true
      }
    ]
  );
});

test("starts preview generation at the first occurrence that overlaps the range", () => {
  const generated = generatePatternEntries(
    dataWithEntries(),
    pattern(),
    "2026-07-10",
    "2026-07-20"
  );

  assert.deepEqual(
    generated.map((entry) => entry.ruleOccurrenceDate),
    ["2026-07-17"]
  );
});

test("skips already generated occurrences for the same rule", () => {
  const generated = generatePatternEntries(
    dataWithEntries([existingGeneratedEntry("2026-07-17")]),
    pattern(),
    "2026-07-01",
    "2026-07-31"
  );

  assert.deepEqual(
    generated.map((entry) => entry.ruleOccurrenceDate),
    ["2026-07-03", "2026-07-31"]
  );
});

test("does not generate dates for inactive rules or rules without children", () => {
  assert.deepEqual(
    generatePatternEntries(
      dataWithEntries(),
      pattern({ active: false }),
      "2026-07-01",
      "2026-07-31"
    ),
    []
  );
  assert.deepEqual(
    generatePatternEntries(
      dataWithEntries(),
      pattern({ childIds: [] }),
      "2026-07-01",
      "2026-07-31"
    ),
    []
  );
});
