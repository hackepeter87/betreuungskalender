import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTROLLED_DEMO_SEED_VERSION,
  createControlledDemoData,
  createEdgeCaseDemoData,
  edgeCaseDemoSummary
} from "./services/demoFixtures.js";

test("edge-case demo fixture is synthetic and covers operational boundary cases", () => {
  const data = createEdgeCaseDemoData();
  const summary = edgeCaseDemoSummary(data);

  assert.deepEqual(summary, {
    dataset: "edge-cases",
    children: 3,
    careParties: 2,
    entries: 6,
    holidayPeriods: 2,
    unavailablePeriods: 2,
    externalCalendarSources: 1,
    externalCalendarEvents: 2,
    contactPatterns: 2,
    monthClosures: 1,
    auditLog: 1
  });
  assert.equal(data.children.every((child) => String(child.name).startsWith("Demo ")), true);
  assert.equal(data.entries.some((entry) => entry.careScope === "visit_contact"), true);
  assert.equal(data.entries.some((entry) => entry.status === "cancelled"), true);
  assert.equal(data.entries.some((entry) => entry.generatedByPatternId), true);
  assert.equal(data.entries.some((entry) => entry.responsiblePartyId === "demo-party-grandparent"), true);
  assert.equal(data.entries.some((entry) =>
    typeof entry.startDateTime === "string" && entry.startDateTime < "2026-07-01"
  ), true);
  assert.equal(data.unavailablePeriods.some((period) => period.category === "other"), true);
  assert.equal(data.monthClosures.some((closure) => closure.changedAfterCloseAt), true);
  assert.equal(JSON.stringify(data).includes("@"), false);
});

test("controlled demo fixture keeps stable identities and moves domain dates relative to reset time", () => {
  const data = createControlledDemoData(new Date("2026-11-08T12:34:56.000Z"));

  assert.equal(data.seedVersion, CONTROLLED_DEMO_SEED_VERSION);
  assert.deepEqual(
    data.data.children.map((child) => child.id),
    ["demo-child-alpha", "demo-child-beta", "demo-child-gamma"]
  );
  assert.deepEqual(
    data.data.careParties.map((party) => party.id),
    ["demo-party-primary", "demo-party-grandparent"]
  );
  assert.equal(
    data.data.entries.find((entry) => entry.id === "demo-entry-future-overdue-candidate")
      ?.startDateTime,
    "2026-11-05T15:00:00.000Z"
  );
  assert.equal(data.data.contactPatterns[0]?.startDate, "2026-11-13");
  assert.equal(data.data.externalCalendarEvents[1]?.recurrenceId, "20261118T150000Z");
  assert.equal(data.data.monthClosures[0]?.monthKey, "2026-10");
  assert.equal(data.data.auditLog.length, 0);
  assert.equal(Object.keys(data.data.settings).length, 0);
  assert.equal(data.data.lastJsonBackupAt, undefined);
  assert.equal(JSON.stringify(data).includes("@"), false);
});
