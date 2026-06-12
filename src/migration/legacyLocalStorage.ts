import type { LegacyDataCounts } from "../../shared/migration";
import { normalizeBackupData } from "../lib/storage";
import type { AppData } from "../types";

export const LEGACY_STORAGE_KEYS = ["betreuungskalender:data:v1"] as const;
const IGNORE_PREFERENCE_KEY = "betreuungskalender:ui:legacy-migration:v1";

export interface LegacyBrowserData {
  key: string;
  fingerprint: string;
  sourceSchemaVersion?: number;
  data?: AppData;
  counts: LegacyDataCounts;
  invalidRecords: number;
  warnings: string[];
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayLength(record: Record<string, unknown>, key: string): number {
  return Array.isArray(record[key]) ? record[key].length : 0;
}

function sourceCounts(value: unknown): LegacyDataCounts {
  const record = isRecord(value) ? value : {};
  const entries = Array.isArray(record.entries)
    ? record.entries.filter(isRecord)
    : [];
  return {
    children: arrayLength(record, "children"),
    entries: entries.length,
    holidays: arrayLength(record, "holidayPeriods"),
    contactPatterns: arrayLength(record, "contactPatterns"),
    trips: entries.reduce((total, entry) => total + arrayLength(entry, "trips"), 0),
    costs: entries.reduce((total, entry) => total + arrayLength(entry, "costs"), 0),
    unavailablePeriods: arrayLength(record, "unavailablePeriods"),
    settings: isRecord(record.settings) ? Object.keys(record.settings).length : 0,
    monthClosures: arrayLength(record, "monthClosures")
  };
}

function fingerprint(raw: string): string {
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${raw.length}-${(hash >>> 0).toString(16)}`;
}

export function detectLegacyBrowserData(): LegacyBrowserData | null {
  for (const key of LEGACY_STORAGE_KEYS) {
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    const result: LegacyBrowserData = {
      key,
      fingerprint: fingerprint(raw),
      counts: sourceCounts(undefined),
      invalidRecords: 0,
      warnings: []
    };
    try {
      const parsed: unknown = JSON.parse(raw);
      const source = isRecord(parsed) && parsed.application === "betreuungskalender"
        ? parsed.data
        : parsed;
      result.counts = sourceCounts(source);
      result.sourceSchemaVersion =
        isRecord(source) && typeof source.schemaVersion === "number"
          ? source.schemaVersion
          : undefined;
      if (isRecord(source)) {
        const known = new Set([
          "schemaVersion", "children", "entries", "holidayPeriods",
          "unavailablePeriods", "contactPatterns", "auditLog",
          "monthClosures", "lastJsonBackupAt", "settings", "updatedAt"
        ]);
        const unknown = Object.keys(source).filter((keyName) => !known.has(keyName));
        if (unknown.length) {
          result.warnings.push(
            `Unbekannte alte Datenbereiche: ${unknown.slice(0, 10).join(", ")}.`
          );
        }
      }
      result.data = normalizeBackupData(source);
      const normalized = sourceCounts(result.data);
      result.invalidRecords = Math.max(
        0,
        Object.keys(result.counts).reduce(
          (total, keyName) =>
            total +
            Math.max(
              0,
              result.counts[keyName as keyof LegacyDataCounts] -
                normalized[keyName as keyof LegacyDataCounts]
            ),
          0
        )
      );
      if (result.sourceSchemaVersion && result.sourceSchemaVersion < 4) {
        result.warnings.push(
          `Alte Datenversion ${result.sourceSchemaVersion} erkannt; Werte werden vor dem Import normalisiert.`
        );
      }
    } catch (error) {
      result.invalidRecords = Object.values(result.counts).reduce(
        (total, value) => total + value,
        0
      ) || 1;
      result.error =
        error instanceof Error
          ? error.message
          : "Die alten Browserdaten konnten nicht gelesen werden.";
      result.warnings.push("Die Legacy-Struktur ist ungültig und kann nicht importiert werden.");
    }
    return result;
  }
  return null;
}

export function isLegacyFingerprintIgnored(value: string): boolean {
  return window.localStorage.getItem(IGNORE_PREFERENCE_KEY) === value;
}

export function ignoreLegacyFingerprint(value: string): void {
  window.localStorage.setItem(IGNORE_PREFERENCE_KEY, value);
}
