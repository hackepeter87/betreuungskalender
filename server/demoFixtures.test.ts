import assert from "node:assert/strict";
import test from "node:test";
import {
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
