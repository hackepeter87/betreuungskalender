import type Database from "better-sqlite3";
import { db } from "../db/connection.js";
import type { ApiSetupState } from "../../shared/api.js";

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

function countActive(database: Database.Database, table: string): number {
  const row = database.prepare(`
    SELECT COUNT(*) AS count
    FROM ${table}
    WHERE deleted_at IS NULL
  `).get() as { count: number };
  return row.count;
}

function setting(database: Database.Database, key: string): unknown {
  const row = database.prepare(`
    SELECT value_json AS valueJson
    FROM settings
    WHERE key = ? AND deleted_at IS NULL
  `).get(key) as { valueJson: string } | undefined;
  return row ? JSON.parse(row.valueJson) as unknown : undefined;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function buildSetupState(database: Database.Database = db): DetailedSetupState {
  const completedAt = optionalText(setting(database, "setup.completedAt"));
  const completedBy = optionalText(setting(database, "setup.completedBy"));
  const children = countActive(database, "children");
  const careParties = countActive(database, "care_parties");
  const appUsers = countActive(database, "app_users");
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

export function publicSetupState(database: Database.Database = db): ApiSetupState {
  const state = buildSetupState(database);
  return {
    complete: state.complete,
    required: state.required
  };
}
