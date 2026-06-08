import type {
  ApiAuditEntry,
  ApiCareEntry,
  ApiChild,
  ApiMonthlyClosing,
  ApiUnavailablePeriod,
  CareScope
} from "../../shared/api";
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
  UnavailablePeriod
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
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}

function careScopeFor(entry: Omit<CareEntry, "id" | "createdAt" | "updatedAt">): CareScope {
  if (entry.overnight) return "overnight";
  const duration =
    (Date.parse(entry.endDateTime) - Date.parse(entry.startDateTime)) / 60000;
  if (duration >= 12 * 60) return "full_day";
  if (duration >= 5 * 60) return "half_day";
  return "hourly";
}

function entryPayload(entry: Omit<CareEntry, "id" | "createdAt" | "updatedAt">) {
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
      .map(({ deletedAt: _deletedAt, ...trip }) => trip),
    costs: entry.costs
      .filter((cost) => !cost.deletedAt)
      .map(({ deletedAt: _deletedAt, ...cost }) => cost)
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
  app_data: "appData"
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
  ] = await Promise.all([
    request<ApiChild[]>("/api/children"),
    request<ApiCareEntry[]>("/api/care-entries"),
    request<ApiHolidayPeriod[]>("/api/holiday-periods"),
    request<ApiUnavailablePeriod[]>("/api/unavailable-periods"),
    request<ApiContactPattern[]>("/api/contact-patterns"),
    request<Record<string, unknown>>("/api/settings"),
    request<ApiAuditEntry[]>("/api/audit-log?limit=50000"),
    request<ApiMonthlyClosing[]>("/api/month-closings")
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
  createChild(input: Omit<Child, "id" | "createdAt" | "updatedAt">) {
    return request<ApiChild>("/api/children", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  updateChild(id: string, input: Omit<Child, "id" | "createdAt" | "updatedAt">) {
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
  createEntry(input: Omit<CareEntry, "id" | "createdAt" | "updatedAt">) {
    return request<ApiCareEntry>("/api/care-entries", {
      method: "POST",
      body: JSON.stringify(entryPayload(input))
    });
  },
  updateEntry(
    id: string,
    input: Omit<CareEntry, "id" | "createdAt" | "updatedAt">
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
  createHoliday(input: Omit<HolidayPeriod, "id">) {
    return request<HolidayPeriod>("/api/holiday-periods", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  updateHoliday(id: string, input: Omit<HolidayPeriod, "id">) {
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
  createPattern(input: Omit<ContactPattern, "id">) {
    return request<ApiContactPattern>("/api/contact-patterns", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  updatePattern(id: string, input: Omit<ContactPattern, "id">) {
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
  }
};
