import type { ApiTransferDryRunResult } from "../../shared/api";

export interface PrivacySafeTransferReviewReport {
  reportVersion: 1;
  createdAt: string;
  package: {
    formatVersion: number;
    sourceVersion: string;
    exportedAt?: string;
    fingerprintPrefix: string;
  };
  result: ApiTransferDryRunResult["result"];
  summary: ApiTransferDryRunResult["summary"];
  comparison: ApiTransferDryRunResult["comparison"];
  checks: ApiTransferDryRunResult["checks"];
  skippedRuntimeCodes: string[];
}

export function createPrivacySafeTransferReviewReport(
  result: ApiTransferDryRunResult,
  createdAt = new Date().toISOString()
): PrivacySafeTransferReviewReport {
  return {
    reportVersion: 1,
    createdAt,
    package: {
      formatVersion: result.formatVersion,
      sourceVersion: result.sourceVersion,
      ...(result.exportedAt ? { exportedAt: result.exportedAt } : {}),
      fingerprintPrefix: result.fingerprint.slice(0, 12)
    },
    result: result.result,
    summary: { ...result.summary },
    comparison: result.comparison.map((item) => ({ ...item })),
    checks: result.checks.map((item) => ({ ...item })),
    skippedRuntimeCodes: [...result.skippedRuntimeCodes]
  };
}
