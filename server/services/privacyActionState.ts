import { sql } from "kysely";
import type { DatabaseExecutor } from "../db/runtime.js";

const domainStateId = "domain";

export async function currentPrivacyActionDataGeneration(
  database: DatabaseExecutor
): Promise<number> {
  const row = await database.selectFrom("privacy_action_state")
    .select("data_generation")
    .where("id", "=", domainStateId)
    .executeTakeFirstOrThrow();
  return Number(row.data_generation);
}

export async function claimPrivacyActionDataGeneration(
  database: DatabaseExecutor
): Promise<number> {
  const result = await database.updateTable("privacy_action_state")
    .set({ data_generation: sql<number>`${sql.ref("data_generation")}` })
    .where("id", "=", domainStateId)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) !== 1) {
    throw new Error("Privacy action data generation is unavailable.");
  }
  return currentPrivacyActionDataGeneration(database);
}

export async function advancePrivacyActionDataGeneration(
  database: DatabaseExecutor,
  timestamp: string
): Promise<number> {
  const result = await database.updateTable("privacy_action_state")
    .set({
      data_generation: sql<number>`${sql.ref("data_generation")} + 1`,
      updated_at: timestamp
    })
    .where("id", "=", domainStateId)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) !== 1) {
    throw new Error("Privacy action data generation is unavailable.");
  }
  return currentPrivacyActionDataGeneration(database);
}
