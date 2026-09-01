import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyData } from "../src/data/defaults.js";
import { actorDisplayName, actorIdsForData } from "../src/lib/actors.js";

test("collects unique actor ids only from the loaded domain data", () => {
  const data = createEmptyData();
  data.children.push({
    id: "child-1",
    name: "Alex",
    birthMonth: 1,
    birthYear: 2018,
    color: "#087f7b",
    createdBy: "actor-alpha",
    updatedBy: "actor-beta",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  data.monthClosures.push({
    monthKey: "2026-01",
    closedAt: "2026-02-01T00:00:00.000Z",
    closedBy: "actor-alpha",
    dataUpdatedAt: "2026-02-01T00:00:00.000Z",
    summary: {
      entryCount: 0,
      careDays: 0,
      overnights: 0,
      weekends: 0,
      completedEntries: 0,
      plannedEntries: 0,
      cancelledEntries: 0,
      completeness: 100,
      dataQuality: {
        incompleteEntries: 0,
        cancellationsWithoutReason: 0,
        tripsWithoutPurpose: 0,
        costsWithoutCategory: 0,
        overduePlannedEntries: 0,
        totalIssues: 0
      },
      warnings: []
    },
    updatedBy: "actor-gamma"
  });

  assert.deepEqual(actorIdsForData(data), ["actor-alpha", "actor-beta", "actor-gamma"]);
});

test("uses resolved display labels without exposing unrelated account data", () => {
  const labels = { "actor-alpha": "Alex Beispiel" };
  assert.equal(actorDisplayName(labels, "actor-alpha"), "Alex Beispiel");
  assert.equal(actorDisplayName(labels, "actor-unknown"), "actor-unknown");
});
