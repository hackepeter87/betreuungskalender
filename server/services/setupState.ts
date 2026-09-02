import type { ApiSetupState } from "../../shared/api.js";
import type { DatabaseExecutor } from "../db/runtime.js";

export interface DetailedSetupState extends ApiSetupState {
  source: "explicit" | "existing-data" | "fresh";
  completedAt?: string;
  completedBy?: string;
  counts: { children: number; careParties: number; appUsers: number };
}

async function activeCount(
  database: DatabaseExecutor,
  table: "children" | "care_parties" | "app_users"
): Promise<number> {
  const row = await database.selectFrom(table)
    .select(({ fn }) => fn.count<number>("id").as("count"))
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

async function setting(database: DatabaseExecutor, key: string): Promise<unknown> {
  const row = await database.selectFrom("settings")
    .select("value_json")
    .where("key", "=", key)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  return row ? JSON.parse(row.value_json) as unknown : undefined;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export async function buildSetupState(database: DatabaseExecutor): Promise<DetailedSetupState> {
  const [completedAtValue, completedByValue, children, careParties, appUsers] = await Promise.all([
    setting(database, "setup.completedAt"),
    setting(database, "setup.completedBy"),
    activeCount(database, "children"),
    activeCount(database, "care_parties"),
    activeCount(database, "app_users")
  ]);
  const completedAt = optionalText(completedAtValue);
  const completedBy = optionalText(completedByValue);
  const hasExistingSetupData = children > 0 && careParties > 0;
  const complete = Boolean(completedAt) || hasExistingSetupData;
  const source = completedAt ? "explicit" : hasExistingSetupData ? "existing-data" : "fresh";
  return {
    complete,
    required: !complete,
    source,
    ...(completedAt ? { completedAt } : {}),
    ...(completedBy ? { completedBy } : {}),
    counts: { children, careParties, appUsers }
  };
}

export async function publicSetupState(database: DatabaseExecutor): Promise<ApiSetupState> {
  const state = await buildSetupState(database);
  return { complete: state.complete, required: state.required };
}
