import type { ApiSetupState } from "../../shared/api.js";
import type { PersistenceExecutor } from "../db/runtime.js";

export interface DetailedSetupState extends ApiSetupState {
  source: "explicit" | "existing-data" | "fresh";
  completedAt?: string;
  completedBy?: string;
  counts: {
    children: number;
    careParties: number;
    appUsers: number;
  };
}

async function setting(database: PersistenceExecutor, key: string): Promise<unknown> {
  const row = await database.one<{ valueJson: string }>(`
    SELECT value_json AS valueJson
    FROM settings
    WHERE key = ? AND deleted_at IS NULL
  `, [key]);
  return row ? JSON.parse(row.valueJson) as unknown : undefined;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export async function buildSetupState(
  database: PersistenceExecutor
): Promise<DetailedSetupState> {
  const [completedAtValue, completedByValue, counts] = await Promise.all([
    setting(database, "setup.completedAt"),
    setting(database, "setup.completedBy"),
    database.one<{ children: number; careParties: number; appUsers: number }>(`
      SELECT
        (SELECT COUNT(*) FROM children WHERE deleted_at IS NULL) AS children,
        (SELECT COUNT(*) FROM care_parties WHERE deleted_at IS NULL) AS careParties,
        (SELECT COUNT(*) FROM app_users WHERE deleted_at IS NULL) AS appUsers
    `)
  ]);
  const completedAt = optionalText(completedAtValue);
  const completedBy = optionalText(completedByValue);
  const children = Number(counts?.children ?? 0);
  const careParties = Number(counts?.careParties ?? 0);
  const appUsers = Number(counts?.appUsers ?? 0);
  const hasExistingSetupData = children > 0 && careParties > 0;
  const complete = Boolean(completedAt) || hasExistingSetupData;
  const source = completedAt
    ? "explicit"
    : hasExistingSetupData
      ? "existing-data"
      : "fresh";

  return {
    complete,
    required: !complete,
    source,
    ...(completedAt ? { completedAt } : {}),
    ...(completedBy ? { completedBy } : {}),
    counts: {
      children,
      careParties,
      appUsers
    }
  };
}

export async function publicSetupState(database: PersistenceExecutor): Promise<ApiSetupState> {
  const state = await buildSetupState(database);
  return {
    complete: state.complete,
    required: state.required
  };
}
