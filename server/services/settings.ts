import type Database from "better-sqlite3";
import type { ApiAppSettings } from "../../shared/api.js";
import { db } from "../db/connection.js";
import { normalizeSettingsValues, settingsDefaults } from "./settingsContract.js";

export { settingsDefaults } from "./settingsContract.js";

export function isActiveCarePartyId(
  value: string,
  database: Database.Database = db
): boolean {
  return Boolean(database.prepare(`
    SELECT 1 FROM care_parties WHERE id = ? AND deleted_at IS NULL
  `).get(value));
}

export function getStoredSettings(database: Database.Database = db): Record<string, unknown> {
  const rows = database.prepare(`
    SELECT key, value_json AS valueJson
    FROM settings
    WHERE deleted_at IS NULL
  `).all() as Array<{ key: string; valueJson: string }>;
  const stored: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      stored[row.key] = JSON.parse(row.valueJson) as unknown;
    } catch {
      // Invalid historical values are ignored by all consumers.
    }
  }
  return { ...settingsDefaults, ...stored };
}

export function normalizeClientSettings(
  values: Record<string, unknown>,
  database: Database.Database = db
): ApiAppSettings {
  const activeRows = database.prepare("SELECT id FROM care_parties WHERE deleted_at IS NULL").all() as Array<{ id: string }>;
  return normalizeSettingsValues(values, new Set(activeRows.map((row) => row.id)));
}

export function getClientSettings(database: Database.Database = db): ApiAppSettings {
  return normalizeClientSettings(getStoredSettings(database), database);
}

export function getDefaultResponsiblePartyId(database: Database.Database = db): string | undefined {
  const configured = getStoredSettings(database).defaultResponsiblePartyId;
  if (typeof configured === "string" && configured.trim()) {
    const active = database.prepare("SELECT 1 FROM care_parties WHERE id = ? AND deleted_at IS NULL").get(configured);
    if (active) return configured;
  }
  const row = database.prepare(`
    SELECT id
    FROM care_parties
    WHERE deleted_at IS NULL
    ORDER BY CASE WHEN id = 'party_primary' THEN 0 ELSE 1 END, created_at, id
    LIMIT 1
  `).get() as { id: string } | undefined;
  return row?.id;
}
