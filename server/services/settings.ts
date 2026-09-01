import type Database from "better-sqlite3";
import {
  careLocations,
  handoverParties,
  type ApiAppSettings,
  type ApiCareLocation,
  type ApiHandoverParty
} from "../../shared/api.js";
import { isValidDateKey } from "../../shared/temporal.js";
import { db } from "../db/connection.js";

export const settingsDefaults = {
  kilometerRate: 0.3,
  defaultLocation: "commuterApartment",
  defaultHandoverFrom: "mother",
  defaultHandoverTo: "mother"
} satisfies Pick<
  ApiAppSettings,
  "kilometerRate" | "defaultLocation" | "defaultHandoverFrom" | "defaultHandoverTo"
>;

const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && isoTimestamp.test(value) && !Number.isNaN(Date.parse(value));
}

function isCareLocation(value: unknown): value is ApiCareLocation {
  return typeof value === "string" && (careLocations as readonly string[]).includes(value);
}

function isHandoverParty(value: unknown): value is ApiHandoverParty {
  return typeof value === "string" && (handoverParties as readonly string[]).includes(value);
}

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
  const settings: ApiAppSettings = { ...settingsDefaults };
  if (typeof values.kilometerRate === "number" && Number.isFinite(values.kilometerRate) && values.kilometerRate >= 0) {
    settings.kilometerRate = values.kilometerRate;
  }
  if (isCareLocation(values.defaultLocation)) settings.defaultLocation = values.defaultLocation;
  if (isHandoverParty(values.defaultHandoverFrom)) settings.defaultHandoverFrom = values.defaultHandoverFrom;
  if (isHandoverParty(values.defaultHandoverTo)) settings.defaultHandoverTo = values.defaultHandoverTo;
  if (typeof values.primaryCarePartyId === "string" && isActiveCarePartyId(values.primaryCarePartyId, database)) {
    settings.primaryCarePartyId = values.primaryCarePartyId;
  }
  if (
    typeof values.defaultResponsiblePartyId === "string" &&
    isActiveCarePartyId(values.defaultResponsiblePartyId, database)
  ) {
    settings.defaultResponsiblePartyId = values.defaultResponsiblePartyId;
  }
  if (typeof values.rhythmStartDate === "string" && isValidDateKey(values.rhythmStartDate)) {
    settings.rhythmStartDate = values.rhythmStartDate;
  }
  if (isIsoTimestamp(values.lastJsonBackupAt)) settings.lastJsonBackupAt = values.lastJsonBackupAt;
  return settings;
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
