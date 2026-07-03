import assert from "node:assert/strict";
import test from "node:test";
import { calculateHolidayStats } from "../src/lib/analytics";
import type { CareEntry, CareParty, HolidayPeriod } from "../src/types";

const parties: CareParty[] = [
  {
    id: "party-main",
    name: "Hauptbetreuung",
    kind: "other",
    createdBy: "test",
    updatedBy: "test",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  },
  {
    id: "party-father",
    name: "Vater",
    kind: "father",
    createdBy: "test",
    updatedBy: "test",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  }
];

function holiday(overrides: Partial<HolidayPeriod> = {}): HolidayPeriod {
  return {
    id: "holiday-summer",
    name: "Sommerferien",
    startDate: "2026-07-01",
    endDate: "2026-07-03",
    childIds: ["child-a", "child-b"],
    assignedTo: "mother",
    createdBy: "test",
    updatedBy: "test",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

function entry(overrides: Partial<CareEntry>): CareEntry {
  return {
    id: "entry",
    date: "2026-07-01",
    startDateTime: "2026-07-01T08:00:00.000Z",
    endDateTime: "2026-07-01T18:00:00.000Z",
    childIds: ["child-a"],
    status: "completed",
    additionalCare: false,
    overnight: false,
    schoolHandover: false,
    holiday: false,
    weekend: false,
    location: "commuterApartment",
    handoverFrom: "mother",
    handoverTo: "mother",
    hasEvidence: false,
    trips: [],
    costs: [],
    createdBy: "test",
    updatedBy: "test",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

test("holiday stats count care entries inside holiday periods by care party", () => {
  const stats = calculateHolidayStats(
    [holiday()],
    "2026-07-01",
    "2026-07-03",
    undefined,
    [],
    [
      entry({
        id: "entry-main-a",
        responsiblePartyId: "party-main",
        childIds: ["child-a"],
        startDateTime: "2026-07-01T08:00:00.000Z",
        endDateTime: "2026-07-01T18:00:00.000Z"
      }),
      entry({
        id: "entry-father-b",
        responsiblePartyId: "party-father",
        childIds: ["child-b"],
        startDateTime: "2026-07-02T08:00:00.000Z",
        endDateTime: "2026-07-02T18:00:00.000Z"
      }),
      entry({
        id: "entry-default",
        responsiblePartyId: undefined,
        childIds: ["child-a"],
        startDateTime: "2026-07-03T08:00:00.000Z",
        endDateTime: "2026-07-03T18:00:00.000Z"
      })
    ],
    parties,
    "party-main"
  );

  assert.equal(stats.totalDays, 6);
  assert.deepEqual(
    stats.byCareParty.map((share) => [share.carePartyId, share.days, share.quote]),
    [
      ["party-main", 2, 33.3],
      ["party-father", 1, 16.7]
    ]
  );
  assert.equal(stats.fatherDays, 1);
  assert.equal(stats.motherDays, 0);
  assert.equal(stats.unassignedDays, 0);
});

test("holiday stats keep legacy assignment only when no care entries exist", () => {
  const stats = calculateHolidayStats(
    [holiday()],
    "2026-07-01",
    "2026-07-03",
    undefined,
    [],
    [],
    parties,
    "party-main"
  );

  assert.equal(stats.totalDays, 6);
  assert.equal(stats.fatherDays, 0);
  assert.equal(stats.motherDays, 6);
  assert.deepEqual(stats.byCareParty, []);
});

test("holiday stats use actual children, time, and care party for partial care", () => {
  const stats = calculateHolidayStats(
    [holiday()],
    "2026-07-01",
    "2026-07-03",
    undefined,
    [],
    [
      entry({
        id: "entry-partial",
        status: "partial",
        responsiblePartyId: "party-main",
        actualResponsiblePartyId: "party-father",
        childIds: ["child-a", "child-b"],
        actualChildIds: ["child-b"],
        startDateTime: "2026-07-01T08:00:00.000Z",
        endDateTime: "2026-07-03T18:00:00.000Z",
        actualStartDateTime: "2026-07-02T08:00:00.000Z",
        actualEndDateTime: "2026-07-02T18:00:00.000Z"
      })
    ],
    parties,
    "party-main"
  );

  assert.equal(stats.totalDays, 6);
  assert.deepEqual(
    stats.byCareParty.map((share) => [share.carePartyId, share.days, share.quote]),
    [["party-father", 1, 16.7]]
  );
  assert.equal(stats.fatherDays, 1);
  assert.equal(stats.motherDays, 0);
});
