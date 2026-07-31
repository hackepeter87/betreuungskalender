import { db } from "../db/connection.js";

export const settingsDefaults: Record<string, unknown> = {
  kilometerRate: 0.3,
  defaultLocation: "commuterApartment",
  defaultHandoverFrom: "mother",
  defaultHandoverTo: "mother"
};

const internalSettingPrefixes = ["setup."];

export function isClientSettingKey(key: string): boolean {
  return !internalSettingPrefixes.some((prefix) => key.startsWith(prefix));
}

export function getStoredSettings(): Record<string, unknown> {
  const rows = db.prepare(`
    SELECT key, value_json AS valueJson
    FROM settings
    WHERE deleted_at IS NULL
  `).all() as Array<{ key: string; valueJson: string }>;
  const stored = Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.valueJson) as unknown]));
  return { ...settingsDefaults, ...stored };
}

export function getClientSettings(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(getStoredSettings()).filter(([key]) => isClientSettingKey(key))
  );
}

export function getDefaultResponsiblePartyId(): string | undefined {
  const configured = getStoredSettings().defaultResponsiblePartyId;
  if (typeof configured === "string" && configured.trim()) {
    const active = db.prepare("SELECT 1 FROM care_parties WHERE id = ? AND deleted_at IS NULL").get(configured);
    if (active) return configured;
  }
  const row = db.prepare(`
    SELECT id
    FROM care_parties
    WHERE deleted_at IS NULL
    ORDER BY CASE WHEN id = 'party_primary' THEN 0 ELSE 1 END, created_at, id
    LIMIT 1
  `).get() as { id: string } | undefined;
  return row?.id;
}
