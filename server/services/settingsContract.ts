import {
  careLocations,
  handoverParties,
  type ApiAppSettings,
  type ApiCareLocation,
  type ApiHandoverParty
} from "../../shared/api.js";
import { isValidDateKey } from "../../shared/temporal.js";

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

export function normalizeSettingsValues(
  values: Record<string, unknown>,
  activeCarePartyIds: ReadonlySet<string>
): ApiAppSettings {
  const settings: ApiAppSettings = { ...settingsDefaults };
  if (typeof values.kilometerRate === "number" && Number.isFinite(values.kilometerRate) && values.kilometerRate >= 0) {
    settings.kilometerRate = values.kilometerRate;
  }
  if (isCareLocation(values.defaultLocation)) settings.defaultLocation = values.defaultLocation;
  if (isHandoverParty(values.defaultHandoverFrom)) settings.defaultHandoverFrom = values.defaultHandoverFrom;
  if (isHandoverParty(values.defaultHandoverTo)) settings.defaultHandoverTo = values.defaultHandoverTo;
  if (typeof values.primaryCarePartyId === "string" && activeCarePartyIds.has(values.primaryCarePartyId)) {
    settings.primaryCarePartyId = values.primaryCarePartyId;
  }
  if (
    typeof values.defaultResponsiblePartyId === "string" &&
    activeCarePartyIds.has(values.defaultResponsiblePartyId)
  ) {
    settings.defaultResponsiblePartyId = values.defaultResponsiblePartyId;
  }
  if (typeof values.rhythmStartDate === "string" && isValidDateKey(values.rhythmStartDate)) {
    settings.rhythmStartDate = values.rhythmStartDate;
  }
  if (isIsoTimestamp(values.lastJsonBackupAt)) settings.lastJsonBackupAt = values.lastJsonBackupAt;
  return settings;
}
