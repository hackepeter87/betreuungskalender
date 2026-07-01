import type {
  ApiAuditEntry,
  ApiCalendarFeedStatus,
  ApiCareEntry,
  ApiChild,
  ApiLogout,
  ApiSession,
  ApiMonthlyClosing,
  ApiUnavailablePeriod,
  ApiExternalCalendarEvent,
  ApiExternalCalendarBackupEvent,
  ApiExternalCalendarSource,
  CareScope
} from "../../shared/api";
import type {
  LegacyDataCounts,
  LegacyDatabaseSummary,
  LegacyDuplicatePolicy,
  LegacyMigrationPreview,
  LegacyMigrationReport
} from "../../shared/migration";
import { createEmptyData } from "../data/defaults";
import type {
  AppData,
  AppSettings,
  AuditAction,
  AuditObjectType,
  CareEntry,
  Child,
  ContactPattern,
  HolidayPeriod,
  MonthlyClosure,
  UnavailablePeriod,
  ExternalCalendarSource
} from "../types";

export const SERVER_UNAVAILABLE_MESSAGE =
  "Die Serververbindung ist nicht verfügbar. Änderungen können derzeit nicht gespeichert werden.";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly unavailable = false
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers
      }
    });
  } catch {
    throw new ApiError(SERVER_UNAVAILABLE_MESSAGE, 0, true);
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) {
    let message = `Serveranfrage fehlgeschlagen (${response.status}).`;
    try {
      const body = (await response.json()) as {
        message?: string;
        issues?: Array<{ message?: string }>;
      };
      message = body.message ?? body.issues?.[0]?.message ?? message;
    } catch {
      // Keep the status-based message for non-JSON responses.
    }
    const unavailable = [502, 503, 504].includes(response.status);
    throw new ApiError(
      unavailable ? SERVER_UNAVAILABLE_MESSAGE : message,
      response.status,
      unavailable
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function checkServer(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch("/api/health", {
      cache: "no-store",
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function loadSession(): Promise<ApiSession> {
  return request<ApiSession>("/api/session");
}

export async function logoutSession(logoutUrl: string): Promise<ApiLogout> {
  return request<ApiLogout>(logoutUrl, { method: "POST" });
}

interface ApiHolidayPeriod extends HolidayPeriod {
  createdAt: string;
  updatedAt: string;
}

interface ApiContactPattern extends ContactPattern {
  createdAt: string;
  updatedAt: string;
}

function mapEntry(entry: ApiCareEntry): CareEntry {
  return {
    id: entry.id,
    date: entry.startDateTime.slice(0, 10),
    generatedByPatternId: entry.generatedByPatternId,
    ruleOccurrenceDate: entry.ruleOccurrenceDate,
    startDateTime: entry.startDateTime,
    endDateTime: entry.endDateTime,
    childIds: entry.childIds,
    status: entry.status,
    additionalCare: entry.additionalCare,
    overnight: entry.overnight,
    schoolHandover: entry.schoolHandover,
    holiday: entry.holiday,
    weekend: entry.weekend,
    location: (entry.location ?? "other") as CareEntry["location"],
    customLocation: entry.customLocation,
    handoverFrom: (entry.handoverFrom ?? "mother") as CareEntry["handoverFrom"],
    handoverTo: (entry.handoverTo ?? "mother") as CareEntry["handoverTo"],
    cancellationReason: entry.cancellationReason,
    notes: entry.notes,
    hasEvidence: entry.hasEvidence,
    evidenceReference: entry.evidenceReference,
    trips: entry.trips.map((trip) => ({
      ...trip,
      purpose: trip.purpose as CareEntry["trips"][number]["purpose"]
    })),
    costs: entry.costs.map((cost) => ({
      ...cost,
      category: cost.category as CareEntry["costs"][number]["category"],
      paidBy: cost.paidBy as CareEntry["costs"][number]["paidBy"]
    })),
    createdBy: entry.createdBy,
    updatedBy: entry.updatedBy,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}

type CareEntryWriteInput = Omit<CareEntry, "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt">;
type ChildWriteInput = Omit<Child, "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt">;
type HolidayWriteInput = Omit<HolidayPeriod, "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt" | "deletedAt">;
type ContactPatternWriteInput = Omit<ContactPattern, "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt">;

function careScopeFor(entry: CareEntryWriteInput): CareScope {
  if (entry.overnight) return "overnight";
  const duration =
    (Date.parse(entry.endDateTime) - Date.parse(entry.startDateTime)) / 60000;
  if (duration >= 12 * 60) return "full_day";
  if (duration >= 5 * 60) return "half_day";
  return "hourly";
}

function entryPayload(entry: CareEntryWriteInput) {
  return {
    generatedByPatternId: entry.generatedByPatternId,
    ruleOccurrenceDate: entry.ruleOccurrenceDate,
    startDateTime: entry.startDateTime,
    endDateTime: entry.endDateTime,
    childIds: entry.childIds,
    status: entry.status,
    careScope: careScopeFor(entry),
    cancellationReason: entry.cancellationReason,
    overnight: entry.overnight,
    schoolHandover: entry.schoolHandover,
    holiday: entry.holiday,
    weekend: entry.weekend,
    additionalCare: entry.additionalCare,
    location: entry.location,
    customLocation: entry.customLocation,
    handoverFrom: entry.handoverFrom,
    handoverTo: entry.handoverTo,
    notes: entry.notes,
    evidenceReference: entry.evidenceReference,
    hasEvidence: entry.hasEvidence,
    trips: entry.trips
      .filter((trip) => !trip.deletedAt)
      .map(({ createdBy: _createdBy, updatedBy: _updatedBy, deletedAt: _deletedAt, ...trip }) => trip),
    costs: entry.costs
      .filter((cost) => !cost.deletedAt)
      .map(({ createdBy: _createdBy, updatedBy: _updatedBy, deletedAt: _deletedAt, ...cost }) => cost)
  };
}

const objectTypeMap: Record<string, AuditObjectType> = {
  care_entry: "careEntry",
  trip: "trip",
  cost: "cost",
  holiday_period: "holiday",
  unavailable_period: "unavailablePeriod",
  child: "child",
  contact_pattern: "contactPattern",
  settings: "settings",
  month_closure: "monthClosure",
  app_data: "appData",
  legacy_migration: "legacyMigration"
};

const actionMap: Record<string, AuditAction> = {
  created: "created",
  updated: "updated",
  deleted: "deleted",
  post_close_change: "postCloseChange"
};

function displayValue(value?: string): string {
  if (!value) return "–";
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "string" ? parsed : JSON.stringify(parsed);
  } catch {
    return value;
  }
}

function mapAudit(entry: ApiAuditEntry): AppData["auditLog"][number] {
  return {
    id: String(entry.id),
    timestamp: entry.timestamp,
    userId: entry.userEmail,
    userDisplayName: entry.userDisplayName,
    objectType: objectTypeMap[entry.entityType] ?? "appData",
    objectId: entry.entityId,
    objectLabel: `${entry.entityType} ${entry.entityId}`,
    field: entry.fieldName ?? entry.action,
    oldValue: displayValue(entry.oldValue),
    newValue: displayValue(entry.newValue),
    action: actionMap[entry.action] ?? "updated"
  };
}

function newestTimestamp(values: Array<string | undefined>): string {
  return values
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? new Date().toISOString();
}

export async function loadAppData(): Promise<AppData> {
  const [
    children,
    entries,
    holidayPeriods,
    unavailablePeriods,
    contactPatterns,
    rawSettings,
    auditLog,
    monthClosures
    ,externalCalendarSources
  ] = await Promise.all([
    request<ApiChild[]>("/api/children"),
    request<ApiCareEntry[]>("/api/care-entries"),
    request<ApiHolidayPeriod[]>("/api/holiday-periods"),
    request<ApiUnavailablePeriod[]>("/api/unavailable-periods"),
    request<ApiContactPattern[]>("/api/contact-patterns"),
    request<Record<string, unknown>>("/api/settings"),
    request<ApiAuditEntry[]>("/api/audit-log?limit=50000"),
    request<ApiMonthlyClosing[]>("/api/month-closings")
    ,request<ApiExternalCalendarSource[]>("/api/external-calendars")
  ]);
  const empty = createEmptyData();
  const { lastJsonBackupAt, ...settings } = rawSettings;
  const mappedEntries = entries.map(mapEntry);
  const mappedUnavailable: UnavailablePeriod[] = unavailablePeriods.map(
    ({ warnings: _warnings, ...period }) => period
  );
  const mappedClosures = monthClosures as MonthlyClosure[];
  return {
    ...empty,
    children: children as Child[],
    entries: mappedEntries,
    holidayPeriods,
    unavailablePeriods: mappedUnavailable,
    externalCalendarSources,
    contactPatterns,
    settings: { ...empty.settings, ...settings } as AppSettings,
    lastJsonBackupAt:
      typeof lastJsonBackupAt === "string" ? lastJsonBackupAt : undefined,
    auditLog: auditLog.map(mapAudit),
    monthClosures: mappedClosures,
    updatedAt: newestTimestamp([
      ...children.flatMap((item) => [item.createdAt, item.updatedAt]),
      ...mappedEntries.flatMap((item) => [item.createdAt, item.updatedAt]),
      ...holidayPeriods.flatMap((item) => [item.createdAt, item.updatedAt]),
      ...mappedUnavailable.flatMap((item) => [item.createdAt, item.updatedAt]),
      ...contactPatterns.flatMap((item) => [item.createdAt, item.updatedAt]),
      ...auditLog.map((item) => item.timestamp),
      ...mappedClosures.flatMap((item) => [
        item.closedAt,
        item.changedAfterCloseAt
      ])
    ])
  };
}

export const api = {
  getSession() {
    return loadSession();
  },
  createChild(input: ChildWriteInput) {
    return request<ApiChild>("/api/children", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  updateChild(id: string, input: ChildWriteInput) {
    return request<ApiChild>(`/api/children/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },
  deleteChild(id: string) {
    return request<void>(`/api/children/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
  },
  createEntry(input: CareEntryWriteInput) {
    return request<ApiCareEntry>("/api/care-entries", {
      method: "POST",
      body: JSON.stringify(entryPayload(input))
    });
  },
  updateEntry(
    id: string,
    input: CareEntryWriteInput
  ) {
    return request<ApiCareEntry>(`/api/care-entries/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(entryPayload(input))
    });
  },
  deleteEntry(id: string) {
    return request<void>(`/api/care-entries/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
  },
  createHoliday(input: HolidayWriteInput) {
    return request<HolidayPeriod>("/api/holiday-periods", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  updateHoliday(id: string, input: HolidayWriteInput) {
    return request<HolidayPeriod>(
      `/api/holiday-periods/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify(input) }
    );
  },
  deleteHoliday(id: string) {
    return request<void>(`/api/holiday-periods/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
  },
  createUnavailable(input: Omit<
    UnavailablePeriod,
    "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt" | "deletedAt"
  >) {
    return request<ApiUnavailablePeriod>("/api/unavailable-periods", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  updateUnavailable(
    id: string,
    input: Omit<
      UnavailablePeriod,
      "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt" | "deletedAt"
    >
  ) {
    return request<ApiUnavailablePeriod>(
      `/api/unavailable-periods/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify(input) }
    );
  },
  deleteUnavailable(id: string) {
    return request<void>(`/api/unavailable-periods/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
  },
  createPattern(input: ContactPatternWriteInput) {
    return request<ApiContactPattern>("/api/contact-patterns", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  updatePattern(id: string, input: ContactPatternWriteInput) {
    return request<ApiContactPattern>(
      `/api/contact-patterns/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify(input) }
    );
  },
  deletePattern(id: string) {
    return request<void>(`/api/contact-patterns/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
  },
  updateSettings(settings: Partial<AppSettings> & { lastJsonBackupAt?: string }) {
    return request<Record<string, unknown>>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(settings)
    });
  },
  closeMonth(closure: {
    monthKey: string;
    dataUpdatedAt: string;
    summary: MonthlyClosure["summary"];
  }) {
    return request<ApiMonthlyClosing>("/api/month-closings", {
      method: "POST",
      body: JSON.stringify(closure)
    });
  },
  replaceData(data: AppData) {
    return request<void>("/api/app-data", {
      method: "PUT",
      body: JSON.stringify(data)
    });
  },
  clearData() {
    return request<void>("/api/app-data", { method: "DELETE" });
  },
  getLegacyMigrationSummary() {
    return request<{
      database: LegacyDatabaseSummary;
      reports: LegacyMigrationReport[];
    }>("/api/migration/legacy-summary");
  },
  recordLegacyDetected(input: {
    fingerprint: string;
    counts: LegacyDataCounts;
  }) {
    return request<void>("/api/migration/legacy-detected", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  recordLegacySkip(input: {
    fingerprint: string;
    counts: LegacyDataCounts;
    reason: string;
  }) {
    return request<void>("/api/migration/legacy-skip", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  previewLegacyMigration(input: {
    data: AppData;
    fingerprint: string;
    invalidRecords: number;
    warnings: string[];
  }) {
    return request<LegacyMigrationPreview>("/api/migration/legacy-preview", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  importLegacyMigration(input: {
    data: AppData;
    fingerprint: string;
    invalidRecords: number;
    warnings: string[];
    mode: "add" | "replace";
    duplicatePolicy: LegacyDuplicatePolicy;
  }) {
    return request<LegacyMigrationReport>("/api/migration/legacy-import", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  getCalendarFeed() {
    return request<ApiCalendarFeedStatus>("/api/calendar-feed");
  },
  rotateCalendarFeed() {
    return request<ApiCalendarFeedStatus>("/api/calendar-feed", { method: "POST" });
  },
  revokeCalendarFeed() {
    return request<void>("/api/calendar-feed", { method: "DELETE" });
  }
  ,listExternalCalendarEvents(from: string, to: string) {
    return request<ApiExternalCalendarEvent[]>(`/api/external-calendar-events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  },
  listExternalCalendarBackupEvents() {
    return request<ApiExternalCalendarBackupEvent[]>("/api/external-calendar-events/export");
  },
  importExternalCalendar(input: { name: string; color: string; content: string }) {
    return request<{ source: ExternalCalendarSource; importedEvents: number }>("/api/external-calendars/import", { method: "POST", body: JSON.stringify(input) });
  },
  replaceExternalCalendar(id: string, input: { name: string; color: string; content: string }) {
    return request<{ source: ExternalCalendarSource; importedEvents: number }>(`/api/external-calendars/${encodeURIComponent(id)}/import`, { method: "PUT", body: JSON.stringify(input) });
  },
  updateExternalCalendar(id: string, input: Partial<Pick<ExternalCalendarSource, "name" | "color" | "visible">>) {
    return request<ExternalCalendarSource>(`/api/external-calendars/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
  },
  deleteExternalCalendar(id: string) { return request<void>(`/api/external-calendars/${encodeURIComponent(id)}`, { method: "DELETE" }); }
};
