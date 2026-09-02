import type { ApiAppSettings } from "../../shared/api.js";
import type { DatabaseExecutor } from "../db/runtime.js";
import {
  getPersistedClientSettings,
  getPersistedDefaultResponsiblePartyId,
  getPersistedSettingValues
} from "./domainPersistence.js";
import { normalizeSettingsValues, settingsDefaults } from "./settingsContract.js";

export { settingsDefaults } from "./settingsContract.js";

export async function isActiveCarePartyId(
  value: string,
  database: DatabaseExecutor
): Promise<boolean> {
  return Boolean(await database.selectFrom("care_parties")
    .select("id")
    .where("id", "=", value)
    .where("deleted_at", "is", null)
    .executeTakeFirst());
}

export async function getStoredSettings(
  database: DatabaseExecutor
): Promise<Record<string, unknown>> {
  return getPersistedSettingValues(database);
}

export async function normalizeClientSettings(
  values: Record<string, unknown>,
  database: DatabaseExecutor
): Promise<ApiAppSettings> {
  const activeRows = await database.selectFrom("care_parties")
    .select("id")
    .where("deleted_at", "is", null)
    .execute();
  return normalizeSettingsValues(values, new Set(activeRows.map((row) => row.id)));
}

export async function getClientSettings(
  database: DatabaseExecutor
): Promise<ApiAppSettings> {
  return getPersistedClientSettings(database);
}

export async function getDefaultResponsiblePartyId(
  database: DatabaseExecutor
): Promise<string | undefined> {
  return getPersistedDefaultResponsiblePartyId(database);
}
