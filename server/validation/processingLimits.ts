export const MAX_CHILD_RELATIONS_PER_RECORD = 100;
export const MAX_CARE_ENTRY_TRIPS = 100;
export const MAX_CARE_ENTRY_COSTS = 100;

export const MAX_TRANSFER_COLLECTION_RECORDS = 50_000;
export const MAX_TRANSFER_TOTAL_RECORDS = 100_000;
export const MAX_TRANSFER_ACTORS = 10_000;
export const MAX_TRANSFER_ACTOR_RELATIONS = 50_000;

export const MAX_WORKSPACE_QUERY_RECORDS = 10_000;
export const MAX_WORKSPACE_QUERY_RELATIONS = 50_000;
export const MAX_WORKSPACE_QUERY_RANGE_DAYS = 3_660;

export const MAX_IMPORT_NESTING_DEPTH = 16;
export const MAX_IMPORT_OBJECT_PROPERTIES = 200;
export const MAX_IMPORT_TRAVERSED_VALUES = 2_000_000;

export interface ImportProcessingLimits {
  maximumCollectionRecords: number;
  maximumTotalRecords: number;
  maximumChildRelationsPerRecord: number;
  maximumTripsPerRecord: number;
  maximumCostsPerRecord: number;
  maximumNestingDepth: number;
  maximumObjectProperties: number;
  maximumTraversedValues: number;
}

const defaultImportProcessingLimits: ImportProcessingLimits = {
  maximumCollectionRecords: MAX_TRANSFER_COLLECTION_RECORDS,
  maximumTotalRecords: MAX_TRANSFER_TOTAL_RECORDS,
  maximumChildRelationsPerRecord: MAX_CHILD_RELATIONS_PER_RECORD,
  maximumTripsPerRecord: MAX_CARE_ENTRY_TRIPS,
  maximumCostsPerRecord: MAX_CARE_ENTRY_COSTS,
  maximumNestingDepth: MAX_IMPORT_NESTING_DEPTH,
  maximumObjectProperties: MAX_IMPORT_OBJECT_PROPERTIES,
  maximumTraversedValues: MAX_IMPORT_TRAVERSED_VALUES
};

export class ImportProcessingLimitError extends Error {
  readonly code = "migration_processing_limit";

  constructor() {
    super("Import processing limit exceeded.");
  }
}

interface ImportCollections {
  children: readonly unknown[];
  entries: readonly unknown[];
  holidayPeriods: readonly unknown[];
  unavailablePeriods: readonly unknown[];
  externalCalendarSources: readonly unknown[];
  externalCalendarEvents: readonly unknown[];
  careParties: readonly unknown[];
  contactPatterns: readonly unknown[];
  contactRules: readonly unknown[];
  auditLog: readonly unknown[];
  monthClosures: readonly unknown[];
  settings: unknown;
}

export function assertImportProcessingLimits(
  data: ImportCollections,
  overrides: Partial<ImportProcessingLimits> = {}
): void {
  const limits = { ...defaultImportProcessingLimits, ...overrides };
  const collections = [
    data.children,
    data.entries,
    data.holidayPeriods,
    data.unavailablePeriods,
    data.externalCalendarSources,
    data.externalCalendarEvents,
    data.careParties,
    data.contactPatterns,
    data.contactRules,
    data.auditLog,
    data.monthClosures
  ];
  let recordCount = 0;
  for (const collection of collections) {
    if (collection.length > limits.maximumCollectionRecords) {
      throw new ImportProcessingLimitError();
    }
    recordCount += collection.length;
  }
  if (recordCount > limits.maximumTotalRecords) {
    throw new ImportProcessingLimitError();
  }

  const stack: Array<{
    value: unknown;
    depth: number;
    topLevelCollection: boolean;
    collectionLimit?: number;
  }> = [
    { value: data.settings, depth: 0, topLevelCollection: false },
    ...collections.map((value) => ({ value, depth: 0, topLevelCollection: true }))
  ];
  let traversedValues = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current) break;
    traversedValues += 1;
    if (traversedValues > limits.maximumTraversedValues || current.depth > limits.maximumNestingDepth) {
      throw new ImportProcessingLimitError();
    }
    if (Array.isArray(current.value)) {
      if (!current.topLevelCollection) {
        if (current.value.length > (current.collectionLimit ?? limits.maximumCollectionRecords)) {
          throw new ImportProcessingLimitError();
        }
        recordCount += current.value.length;
        if (recordCount > limits.maximumTotalRecords) {
          throw new ImportProcessingLimitError();
        }
      }
      for (const value of current.value) {
        stack.push({ value, depth: current.depth + 1, topLevelCollection: false });
      }
      continue;
    }
    if (typeof current.value === "object" && current.value !== null) {
      const values = Object.values(current.value);
      if (values.length > limits.maximumObjectProperties) {
        throw new ImportProcessingLimitError();
      }
      for (const [key, value] of Object.entries(current.value)) {
        const collectionLimit = key === "childIds" || key === "actualChildIds" || key === "segments"
          ? limits.maximumChildRelationsPerRecord
          : key === "trips"
            ? limits.maximumTripsPerRecord
            : key === "costs"
              ? limits.maximumCostsPerRecord
              : undefined;
        stack.push({
          value,
          depth: current.depth + 1,
          topLevelCollection: false,
          ...(collectionLimit === undefined ? {} : { collectionLimit })
        });
      }
    }
  }
}
