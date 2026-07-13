import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateContactStats,
  calculateHolidayStats,
  calculatePeriodStats
} from "../src/lib/analytics";
import { createEmptyData } from "../src/data/defaults";
import type { CareEntry, CareParty, HolidayPeriod, UnavailablePeriod } from "../src/types";

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

function unavailable(overrides: Partial<UnavailablePeriod>): UnavailablePeriod {
  return {
    id: "unavailable",
    startDateTime: "2026-07-01T08:00:00.000Z",
    endDateTime: "2026-07-01T18:00:00.000Z",
    scope: "own_unavailability",
    childIds: [],
    category: "other",
    dutyRelated: false,
    affectsContact: true,
    affectsHolidays: false,
    hasEvidence: false,
    createdBy: "test",
    updatedBy: "test",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

test("holiday stats count care entries inside holiday periods by care party", () => {
  const stats = calculateHolidayStats({
    periods: [holiday()],
    startDate: "2026-07-01",
    endDate: "2026-07-03",
    allChildIds: ["child-a", "child-b"],
    entries: [
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
    careParties: parties,
    defaultResponsiblePartyId: "party-main"
  });

  assert.equal(stats.totalDays, 3);
  assert.deepEqual(
    stats.byCareParty.map((share) => [share.carePartyId, share.days, share.quote]),
    [
      ["party-main", 2.5, 83.3],
      ["party-father", 0.5, 16.7]
    ]
  );
  assert.equal(stats.fatherDays, 0.5);
  assert.equal(stats.motherDays, 0);
  assert.equal(stats.unassignedDays, 0);
});

test("holiday stats use default responsible care party when no care entries exist", () => {
  const stats = calculateHolidayStats({
    periods: [holiday()],
    startDate: "2026-07-01",
    endDate: "2026-07-03",
    allChildIds: ["child-a", "child-b"],
    careParties: parties,
    defaultResponsiblePartyId: "party-main"
  });

  assert.equal(stats.totalDays, 3);
  assert.equal(stats.fatherDays, 0);
  assert.equal(stats.motherDays, 0);
  assert.deepEqual(
    stats.byCareParty.map((share) => [share.carePartyId, share.days, share.quote]),
    [["party-main", 3, 100]]
  );
});

test("holiday stats use primary care party fallback separately from new-entry default", () => {
  const stats = calculateHolidayStats({
    periods: [holiday()],
    startDate: "2026-07-01",
    endDate: "2026-07-03",
    allChildIds: ["child-a", "child-b"],
    careParties: parties,
    defaultResponsiblePartyId: "party-main",
    primaryCarePartyId: "party-father"
  });

  assert.equal(stats.totalDays, 3);
  assert.equal(stats.fatherDays, 3);
  assert.equal(stats.motherDays, 0);
  assert.deepEqual(
    stats.byCareParty.map((share) => [share.carePartyId, share.days, share.quote]),
    [["party-father", 3, 100]]
  );
});

test("holiday stats use actual children, time, and care party for partial care", () => {
  const stats = calculateHolidayStats({
    periods: [holiday()],
    startDate: "2026-07-01",
    endDate: "2026-07-03",
    allChildIds: ["child-a", "child-b"],
    entries: [
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
    careParties: parties,
    defaultResponsiblePartyId: "party-main"
  });

  assert.equal(stats.totalDays, 3);
  assert.deepEqual(
    stats.byCareParty.map((share) => [share.carePartyId, share.days, share.quote]),
    [
      ["party-main", 2.5, 83.3],
      ["party-father", 0.5, 16.7]
    ]
  );
  assert.equal(stats.fatherDays, 0.5);
  assert.equal(stats.motherDays, 0);
});

test("holiday stats prefer actual care and deduplicate overlapping entries", () => {
  const stats = calculateHolidayStats({
    periods: [holiday({ startDate: "2026-07-01", endDate: "2026-07-01" })],
    startDate: "2026-07-01",
    endDate: "2026-07-01",
    allChildIds: ["child-a", "child-b"],
    entries: [
      entry({
        id: "planned-main",
        status: "planned",
        responsiblePartyId: "party-main",
        childIds: ["child-a"]
      }),
      entry({
        id: "completed-father",
        responsiblePartyId: "party-father",
        childIds: ["child-a"]
      }),
      entry({
        id: "completed-father-additional",
        responsiblePartyId: "party-father",
        childIds: ["child-a"],
        additionalCare: true
      })
    ],
    careParties: parties,
    defaultResponsiblePartyId: "party-main"
  });

  assert.equal(stats.totalDays, 1);
  assert.deepEqual(
    stats.byCareParty.map((share) => [share.carePartyId, share.days, share.quote]),
    [
      ["party-main", 0.5, 50],
      ["party-father", 0.5, 50]
    ]
  );
});

test("holiday stats keep conflicting actual party shares unresolved", () => {
  const stats = calculateHolidayStats({
    periods: [holiday({ startDate: "2026-07-01", endDate: "2026-07-01", childIds: ["child-a"] })],
    startDate: "2026-07-01",
    endDate: "2026-07-01",
    allChildIds: ["child-a"],
    entries: [
      entry({ id: "completed-main", responsiblePartyId: "party-main" }),
      entry({ id: "completed-father", responsiblePartyId: "party-father" })
    ],
    careParties: parties,
    primaryCarePartyId: "party-main"
  });

  assert.equal(stats.totalDays, 1);
  assert.deepEqual(stats.byCareParty, []);
  assert.equal(stats.unassignedDays, 1);
  assert.equal(stats.unresolvedDays, 1);
});

test("holiday stats merge same-party overlap and weight non-overlapping care", () => {
  const stats = calculateHolidayStats({
    periods: [holiday({ startDate: "2026-07-01", endDate: "2026-07-01", childIds: ["child-a"] })],
    startDate: "2026-07-01",
    endDate: "2026-07-01",
    allChildIds: ["child-a"],
    entries: [
      entry({
        id: "main-a",
        responsiblePartyId: "party-main",
        startDateTime: "2026-07-01T08:00:00.000Z",
        endDateTime: "2026-07-01T10:00:00.000Z"
      }),
      entry({
        id: "main-overlap",
        responsiblePartyId: "party-main",
        startDateTime: "2026-07-01T09:00:00.000Z",
        endDateTime: "2026-07-01T10:00:00.000Z"
      }),
      entry({
        id: "father",
        responsiblePartyId: "party-father",
        startDateTime: "2026-07-01T10:00:00.000Z",
        endDateTime: "2026-07-01T16:00:00.000Z"
      })
    ],
    careParties: parties,
    primaryCarePartyId: "party-main"
  });

  assert.deepEqual(
    stats.byCareParty.map((share) => [share.carePartyId, share.days, share.quote]),
    [
      ["party-father", 0.8, 75],
      ["party-main", 0.3, 25]
    ]
  );
  assert.equal(stats.unresolvedDays, 0);
});

test("period stats count overlapping care once and expose cross-party overlap", () => {
  const first = entry({
    id: "completed-main",
    responsiblePartyId: "party-main",
    startDateTime: "2026-07-01T08:00:00.000Z",
    endDateTime: "2026-07-01T12:00:00.000Z"
  });
  const sameParty = entry({
    id: "completed-main-overlap",
    responsiblePartyId: "party-main",
    startDateTime: "2026-07-01T10:00:00.000Z",
    endDateTime: "2026-07-01T14:00:00.000Z"
  });
  const otherParty = entry({
    id: "completed-father-overlap",
    responsiblePartyId: "party-father",
    startDateTime: "2026-07-01T13:00:00.000Z",
    endDateTime: "2026-07-01T15:00:00.000Z"
  });
  const data = createEmptyData();
  data.children = [{
    id: "child-a",
    name: "Testkind A",
    birthMonth: 1,
    birthYear: 2018,
    color: "#0d9488",
    createdBy: "test",
    updatedBy: "test",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  }];
  data.careParties = parties;
  data.entries = [first, sameParty, otherParty];
  data.settings.defaultResponsiblePartyId = "party-main";

  const stats = calculatePeriodStats(data, "2026-07-01", "2026-07-01");
  assert.equal(stats.careHours, 7);
  assert.equal(stats.unresolvedCareHours, 1);
  assert.equal(stats.byChild[0]?.careHours, 7);
  assert.equal(stats.byChild[0]?.unresolvedCareHours, 1);
});

test("holiday stats merge overlapping holiday periods by calendar day", () => {
  const stats = calculateHolidayStats({
    periods: [
      holiday({ id: "holiday-a", startDate: "2026-07-01", endDate: "2026-07-02" }),
      holiday({ id: "holiday-b", startDate: "2026-07-02", endDate: "2026-07-03" })
    ],
    startDate: "2026-07-01",
    endDate: "2026-07-03",
    allChildIds: ["child-a", "child-b"],
    careParties: parties,
    primaryCarePartyId: "party-main"
  });

  assert.equal(stats.totalDays, 3);
  assert.deepEqual(
    stats.byCareParty.map((share) => [share.carePartyId, share.days, share.quote]),
    [["party-main", 3, 100]]
  );
});

test("contact stats distinguish external contact blocks from own duty unavailability", () => {
  const scheduled = entry({
    id: "planned-contact",
    generatedByPatternId: "rule-1",
    status: "planned",
    childIds: ["child-a"],
    startDateTime: "2026-07-01T08:00:00.000Z",
    endDateTime: "2026-07-01T18:00:00.000Z"
  });
  const dutyCancelled = entry({
    id: "cancelled-duty",
    generatedByPatternId: "rule-1",
    status: "cancelled",
    childIds: ["child-a"],
    startDateTime: "2026-07-02T08:00:00.000Z",
    endDateTime: "2026-07-02T18:00:00.000Z"
  });

  const stats = calculateContactStats(
    [scheduled, dutyCancelled],
    [
      unavailable({
        id: "external-block",
        scope: "external_contact_block",
        responsiblePartyId: "party-father",
        childIds: ["child-a"],
        startDateTime: "2026-07-01T07:00:00.000Z",
        endDateTime: "2026-07-01T19:00:00.000Z"
      }),
      unavailable({
        id: "duty-overlap",
        scope: "own_unavailability",
        dutyRelated: true,
        startDateTime: "2026-07-02T07:00:00.000Z",
        endDateTime: "2026-07-02T19:00:00.000Z"
      })
    ],
    "2026-07-01",
    "2026-07-03"
  );

  assert.equal(stats.externallyBlocked, 1);
  assert.equal(stats.cancelledDutyRelated, 1);
  assert.equal(stats.unavailableOverlaps, 2);
});
