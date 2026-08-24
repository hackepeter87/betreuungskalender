import assert from "node:assert/strict";
import test from "node:test";
import { createPrivacySafeTransferReviewReport } from "../src/lib/transferReview";
import type { ApiTransferDryRunResult } from "../shared/api";

test("transfer review report contains aggregate review data only", () => {
  const result: ApiTransferDryRunResult = {
    fingerprint: "a".repeat(64),
    formatVersion: 1,
    sourceVersion: "1.22.0",
    exportedAt: "2026-08-24T10:00:00.000Z",
    result: "ready",
    counts: { children: 1 },
    comparison: [{ category: "children", current: 0, incoming: 1, afterImport: 1 }],
    checks: [{ code: "checksum", status: "passed" }],
    summary: {
      currentRecords: 0,
      incomingRecords: 1,
      replacedRecords: 0,
      warnings: 0,
      actorMappingsRequired: 1
    },
    skippedRuntimeCodes: ["identity"],
    skippedRuntimeData: ["identity-provider subjects and claims"],
    missingReferences: [],
    warnings: [],
    actors: [{
      sourceRef: "private-source-reference",
      displayName: "Private display name",
      email: "private@example.invalid",
      carePartyIds: ["private-care-party"],
      mappingRequired: true
    }],
    dryRunReceipt: "private-receipt"
  };

  const report = createPrivacySafeTransferReviewReport(result, "2026-08-24T10:05:00.000Z");
  const serialized = JSON.stringify(report);
  assert.equal(report.package.fingerprintPrefix, "a".repeat(12));
  assert.equal(serialized.includes("Private display name"), false);
  assert.equal(serialized.includes("private@example.invalid"), false);
  assert.equal(serialized.includes("private-source-reference"), false);
  assert.equal(serialized.includes("private-care-party"), false);
  assert.equal(serialized.includes("private-receipt"), false);
  assert.equal(serialized.includes("a".repeat(64)), false);
});
