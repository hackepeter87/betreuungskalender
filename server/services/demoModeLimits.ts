import type { DatabaseExecutor } from "../db/runtime.js";

export class DemoDatasetLimitError extends Error {
  readonly code = "demo_dataset_limit";

  constructor() {
    super("Die maximale Anzahl von Demo-Terminen ist erreicht.");
  }
}

export async function assertDemoCareEntryCapacity(
  database: DatabaseExecutor,
  enabled: boolean,
  maximum = 2000
): Promise<void> {
  if (!enabled) return;
  const result = await database.selectFrom("care_entries")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .executeTakeFirstOrThrow();
  if (Number(result.count) >= maximum) throw new DemoDatasetLimitError();
}

export function isDemoDatasetLimitError(error: unknown): error is DemoDatasetLimitError {
  return error instanceof DemoDatasetLimitError;
}
