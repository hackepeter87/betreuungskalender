import assert from "node:assert/strict";
import test from "node:test";
import { CHILD_COLORS, childColor } from "../src/data/defaults.js";
import { mapAudit, mapReportSnapshotData } from "../src/lib/api.js";
import { omitUndefinedValues } from "../shared/objects.js";

test("child colors wrap deterministically for valid indexes", () => {
  assert.equal(childColor(0), CHILD_COLORS[0]);
  assert.equal(childColor(CHILD_COLORS.length), CHILD_COLORS[0]);
  assert.equal(childColor(-1), CHILD_COLORS.at(-1));
});

test("child colors fall back safely for invalid indexes", () => {
  assert.equal(childColor(Number.NaN), CHILD_COLORS[0]);
  assert.equal(childColor(Number.POSITIVE_INFINITY), CHILD_COLORS[0]);
});

test("optional browser payload fields are omitted without dropping meaningful values", () => {
  const payload = omitUndefinedValues({
    absent: undefined,
    empty: "",
    disabled: false,
    cleared: null
  });

  assert.deepEqual(payload, { empty: "", disabled: false, cleared: null });
  assert.equal(Object.hasOwn(payload, "absent"), false);
});

test("partial API records omit absent values and retain safe presentation fallbacks", () => {
  const audit = mapAudit({
    id: 1,
    timestamp: "2026-09-14T12:00:00.000Z",
    userEmail: "actor-1",
    entityType: "future_entity",
    entityId: "item-1",
    action: "created"
  });
  assert.equal(audit.objectType, "appData");
  assert.equal(Object.hasOwn(audit, "userDisplayName"), false);
  assert.equal(Object.hasOwn(audit, "effectiveDate"), false);

  const data = mapReportSnapshotData({
    reportId: "report-1",
    generatedAt: "2026-09-14T12:00:00.000Z",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    dataUpdatedAt: "2026-09-14T11:00:00.000Z",
    data: {
      schemaVersion: 7,
      children: [],
      careParties: [],
      entries: [],
      holidayPeriods: [],
      unavailablePeriods: [],
      settings: {
        kilometerRate: 0.3,
        defaultLocation: "commuterApartment",
        defaultHandoverFrom: "mother",
        defaultHandoverTo: "mother"
      },
      auditLog: [],
      monthClosures: []
    }
  });
  assert.equal(Object.hasOwn(data, "lastJsonBackupAt"), false);
  assert.equal(data.settings.defaultLocation, "commuterApartment");
});
