export type LegacyMigrationMode = "add" | "preview" | "replace";
export type LegacyDuplicatePolicy = "skip" | "include";

export interface LegacyDataCounts {
  children: number;
  entries: number;
  holidays: number;
  contactPatterns: number;
  trips: number;
  costs: number;
  unavailablePeriods: number;
  settings: number;
  monthClosures: number;
}

export interface LegacyDatabaseSummary extends LegacyDataCounts {
  auditEntries: number;
  isEmpty: boolean;
}

export interface LegacyMigrationIssue {
  type: string;
  legacyId: string;
  label: string;
  reasons: string[];
  closedMonths: string[];
}

export interface LegacyMigrationPreview {
  counts: LegacyDataCounts;
  database: LegacyDatabaseSummary;
  potentialDuplicates: number;
  conflicts: number;
  invalidRecords: number;
  warnings: string[];
  duplicateDetails: LegacyMigrationIssue[];
  conflictDetails: LegacyMigrationIssue[];
}

export interface LegacyMigrationReport {
  id: string;
  mode: LegacyMigrationMode;
  status: "success" | "warning" | "failed";
  startedAt: string;
  finishedAt: string;
  counts: LegacyDataCounts;
  imported: LegacyDataCounts;
  skippedDuplicates: number;
  conflicts: number;
  invalidRecords: number;
  warnings: string[];
  errors: string[];
  backupFile?: string;
}
