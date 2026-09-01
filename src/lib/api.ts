import type {
  ApiActorLabel,
  ApiAuditEntry,
  ApiAuditPage,
  ApiAppUser,
  ApiCalendarFeedStatus,
  ApiCalendarFeedScope,
  ApiCreatedInvitation,
  ApiCareConflictList,
  ApiCareConflictPreview,
  ApiCareConflictResolutionInput,
  ApiCareConfirmationAnswer,
  ApiCareConfirmationRequest,
  ApiCareEntry,
  ApiCareParty,
  ApiCarePartySummary,
  ApiChild,
  ApiChildSummary,
  ApiContactRule,
  ApiContactRuleSyncPreview,
  ApiLogout,
  ApiSession,
  ApiScheduleEntry,
  ApiSetupFirstUse,
  ApiSetupFirstUseInput,
  ApiUserCarePartyAssignment,
  ApiMonthlyClosing,
  ApiUnavailablePeriod,
  ApiExternalCalendarEvent,
  ApiExternalCalendarBackupEvent,
  ApiExternalCalendarSource,
  ApiExternalCalendarHolidayDeriveResult,
  ApiInvitation,
  ApiInstanceReadiness,
  ApiImportedTransferActor,
  ApiMember,
  ApiNotificationPreferencesResponse,
  ApiNotificationPreference,
  ApiPushSubscriptionInput,
  ApiWorkspaceRole,
  ApiTransferDryRunResult,
  ApiReportSnapshot,
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
  CareLocation,
  CareConfirmationRequest,
  CareParty,
  Child,
  ContactRule,
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

async function request<T>(path: string, init?: RequestInit, timeoutMs = 5_000): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      signal: init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers
      }
    });
  } catch {
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
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

export function mapReportSnapshotData(snapshot: ApiReportSnapshot): AppData {
  const empty = createEmptyData();
  return {
    ...empty,
    schemaVersion: snapshot.data.schemaVersion as AppData["schemaVersion"],
    children: snapshot.data.children as Child[],
    careParties: snapshot.data.careParties as CareParty[],
    entries: snapshot.data.entries.map(mapEntry),
    holidayPeriods: snapshot.data.holidayPeriods,
    unavailablePeriods: snapshot.data.unavailablePeriods.map(({ warnings: _warnings, ...period }) => period),
    settings: { ...empty.settings, ...snapshot.data.settings } as AppSettings,
    auditLog: snapshot.data.auditLog.map(mapAudit),
    monthClosures: snapshot.data.monthClosures as MonthlyClosure[],
    updatedAt: snapshot.dataUpdatedAt
  };
}

async function requestOptionalCareConflicts(): Promise<ApiCareConflictList> {
  try {
    return await request<ApiCareConflictList>("/api/care-conflicts");
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { items: [], complete: true };
    }
    throw error;
  }
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
    contactRuleId: entry.contactRuleId,
    contactRuleSegmentId: entry.contactRuleSegmentId,
    contactRuleOccurrenceKey: entry.contactRuleOccurrenceKey,
    responsiblePartyId: entry.responsiblePartyId,
    actualResponsiblePartyId: entry.actualResponsiblePartyId,
    contactRuleSyncState: entry.contactRuleSyncState,
    startDateTime: entry.startDateTime,
    endDateTime: entry.endDateTime,
    plannedStartDateTime: entry.plannedStartDateTime,
    plannedEndDateTime: entry.plannedEndDateTime,
    actualStartDateTime: entry.actualStartDateTime,
    actualEndDateTime: entry.actualEndDateTime,
    childIds: entry.childIds,
    actualChildIds: entry.actualChildIds,
    status: entry.status,
    deviationType: entry.deviationType,
    deviationNote: entry.deviationNote,
    confirmationState: entry.confirmationState,
    confirmedAt: entry.confirmedAt,
    confirmedBy: entry.confirmedBy,
    confirmationNote: entry.confirmationNote,
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

function mapConfirmation(request: ApiCareConfirmationRequest): CareConfirmationRequest {
  return {
    ...request,
    entry: mapEntry(request.entry)
  };
}

type CareEntryWriteInput = Omit<CareEntry, "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt"> & {
  confirmPlannedConflict?: boolean;
  conflictFingerprint?: string;
};
type ScheduleEntryWriteInput = Pick<
  CareEntryWriteInput,
  "startDateTime" | "endDateTime" | "childIds" | "responsiblePartyId" |
  "confirmPlannedConflict" | "conflictFingerprint"
> & {
  location?: Exclude<CareLocation, "other">;
};
type CarePartyWriteInput = Omit<CareParty, "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt">;
type ChildWriteInput = Omit<Child, "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt">;
type HolidayWriteInput = Omit<HolidayPeriod, "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt" | "deletedAt">;
type ContactPatternWriteInput = Omit<ContactPattern, "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt">;
type ContactRuleWriteInput = Omit<ContactRule, "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt" | "syncSummary" | "sourceContactPatternId">;

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
    contactRuleId: entry.contactRuleId,
    contactRuleSegmentId: entry.contactRuleSegmentId,
    contactRuleOccurrenceKey: entry.contactRuleOccurrenceKey,
    responsiblePartyId: entry.responsiblePartyId,
    contactRuleSyncState: entry.contactRuleSyncState,
    startDateTime: entry.startDateTime,
    endDateTime: entry.endDateTime,
    plannedStartDateTime: entry.plannedStartDateTime,
    plannedEndDateTime: entry.plannedEndDateTime,
    actualStartDateTime: entry.actualStartDateTime,
    actualEndDateTime: entry.actualEndDateTime,
    actualChildIds: entry.actualChildIds,
    actualResponsiblePartyId: entry.actualResponsiblePartyId,
    childIds: entry.childIds,
    status: entry.status,
    deviationType: entry.deviationType,
    deviationNote: entry.deviationNote,
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
      .map(({ createdBy: _createdBy, updatedBy: _updatedBy, deletedAt: _deletedAt, ...cost }) => cost),
    confirmPlannedConflict: entry.confirmPlannedConflict,
    conflictFingerprint: entry.conflictFingerprint
  };
}

const objectTypeMap: Record<string, AuditObjectType> = {
  care_entry: "careEntry",
  trip: "trip",
  cost: "cost",
  holiday_period: "holiday",
  unavailable_period: "unavailablePeriod",
  child: "child",
  care_party: "careParty",
  contact_pattern: "contactPattern",
  settings: "settings",
  month_closure: "monthClosure",
  app_data: "appData",
  user_care_party_assignment: "userCarePartyAssignment",
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

export function mapAudit(entry: ApiAuditEntry): AppData["auditLog"][number] {
  return {
    id: String(entry.id),
    timestamp: entry.timestamp,
    userId: entry.userEmail,
    userDisplayName: entry.userDisplayName,
    objectType: objectTypeMap[entry.entityType] ?? "appData",
    objectId: entry.entityId,
    objectLabel: `${entry.entityType} ${entry.entityId}`,
    effectiveDate: entry.effectiveDate,
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

export async function loadAppData(options: {
  includeSettings?: boolean;
} = {}): Promise<AppData> {
  const includeSettings = options.includeSettings ?? true;
  const [
    children,
    careParties,
    entries,
    careConflictList,
    holidayPeriods,
    unavailablePeriods,
    contactPatterns,
    contactRules,
    rawSettings,
    monthClosures,
    externalCalendarSources
  ] = await Promise.all([
    request<ApiChild[]>("/api/children"),
    request<ApiCareParty[]>("/api/care-parties"),
    request<ApiCareEntry[]>("/api/care-entries"),
    requestOptionalCareConflicts(),
    request<ApiHolidayPeriod[]>("/api/holiday-periods"),
    request<ApiUnavailablePeriod[]>("/api/unavailable-periods"),
    request<ApiContactPattern[]>("/api/contact-patterns"),
    request<ApiContactRule[]>("/api/contact-rules"),
    includeSettings
      ? request<Record<string, unknown>>("/api/settings")
      : Promise.resolve({} as Record<string, unknown>),
    request<ApiMonthlyClosing[]>("/api/month-closings"),
    request<ApiExternalCalendarSource[]>("/api/external-calendars")
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
    careParties: careParties as CareParty[],
    entries: mappedEntries,
    careConflicts: careConflictList.items,
    careConflictsComplete: careConflictList.complete,
    holidayPeriods,
    unavailablePeriods: mappedUnavailable,
    externalCalendarSources,
    contactPatterns,
    contactRules,
    settings: { ...empty.settings, ...settings } as AppSettings,
    lastJsonBackupAt:
      typeof lastJsonBackupAt === "string" ? lastJsonBackupAt : undefined,
    auditLog: [],
    monthClosures: mappedClosures,
    updatedAt: newestTimestamp([
      ...children.flatMap((item) => [item.createdAt, item.updatedAt]),
      ...careParties.flatMap((item) => [item.createdAt, item.updatedAt]),
      ...mappedEntries.flatMap((item) => [item.createdAt, item.updatedAt]),
      ...holidayPeriods.flatMap((item) => [item.createdAt, item.updatedAt]),
      ...mappedUnavailable.flatMap((item) => [item.createdAt, item.updatedAt]),
      ...contactPatterns.flatMap((item) => [item.createdAt, item.updatedAt]),
      ...contactRules.flatMap((item) => [item.createdAt, item.updatedAt]),
      ...mappedClosures.flatMap((item) => [
        item.closedAt,
        item.changedAfterCloseAt
      ])
    ])
  };
}

export async function loadRestrictedAppData(): Promise<AppData> {
  const [children, careParties, entries] = await Promise.all([
    request<ApiChildSummary[]>("/api/children/summary"),
    request<ApiCarePartySummary[]>("/api/care-parties/summary"),
    request<ApiScheduleEntry[]>("/api/care-entries/schedule")
  ]);
  const empty = createEmptyData();
  const timestamp = new Date().toISOString();
  return {
    ...empty,
    children: children.map((child) => ({
      ...child,
      birthMonth: 1,
      birthYear: 1970,
      createdBy: "",
      updatedBy: "",
      createdAt: timestamp,
      updatedAt: timestamp
    })),
    careParties: careParties.map((party) => ({
      ...party,
      kind: "other",
      createdBy: "",
      updatedBy: "",
      createdAt: timestamp,
      updatedAt: timestamp
    })),
    entries: entries.map((entry) => ({
      id: entry.id,
      date: entry.startDateTime.slice(0, 10),
      startDateTime: entry.startDateTime,
      endDateTime: entry.endDateTime,
      childIds: entry.children.map((child) => child.id),
      status: entry.status,
      responsiblePartyId: entry.responsibleParty?.id,
      additionalCare: false,
      overnight: false,
      schoolHandover: false,
      holiday: false,
      weekend: false,
      location: (entry.location ?? "other") as CareEntry["location"],
      handoverFrom: "mother",
      handoverTo: "mother",
      hasEvidence: false,
      trips: [],
      costs: [],
      createdBy: "",
      updatedBy: "",
      createdAt: timestamp,
      updatedAt: timestamp
    })),
    careConflicts: [],
    careConflictsComplete: true,
    updatedAt: timestamp
  };
}

export const api = {
  async listAuditPage(options: {
    objectType?: AuditObjectType;
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
  } = {}) {
    const query = new URLSearchParams({
      limit: String(options.limit ?? 50)
    });
    if (options.objectType) {
      const entityType = Object.entries(objectTypeMap).find(
        ([, objectType]) => objectType === options.objectType
      )?.[0];
      if (entityType) query.set("entityType", entityType);
    }
    if (options.cursor) query.set("cursor", options.cursor);
    const page = await request<ApiAuditPage>(`/api/audit-log/page?${query}`, {
      signal: options.signal
    });
    return {
      items: page.items.map(mapAudit),
      nextCursor: page.nextCursor
    };
  },
  resolveActorLabels(ids: string[]) {
    return request<ApiActorLabel[]>("/api/actor-labels/resolve", {
      method: "POST",
      body: JSON.stringify({ ids })
    });
  },
  previewCareConflicts(input: CareEntryWriteInput, entryId?: string) {
    const query = entryId ? `?entryId=${encodeURIComponent(entryId)}` : "";
    return request<ApiCareConflictPreview>(`/api/care-conflicts/preview${query}`, {
      method: "POST",
      body: JSON.stringify(entryPayload(input))
    });
  },
  resolveCareConflict(input: ApiCareConflictResolutionInput) {
    return request<ApiCareEntry>("/api/care-conflicts/resolve", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  reportSnapshot(startDate: string, endDate: string, includeAuditHistory: boolean, signal?: AbortSignal) {
    const query = new URLSearchParams({
      startDate,
      endDate,
      includeAuditHistory: String(includeAuditHistory)
    });
    return request<ApiReportSnapshot>(`/api/reports/snapshot?${query}`, { signal }, 15_000);
  },
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
  createCareParty(input: CarePartyWriteInput) {
    return request<ApiCareParty>("/api/care-parties", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  updateCareParty(id: string, input: CarePartyWriteInput) {
    return request<ApiCareParty>(`/api/care-parties/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },
  deleteCareParty(id: string) {
    return request<void>(`/api/care-parties/${encodeURIComponent(id)}`, {
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
  createScheduleEntry(input: ScheduleEntryWriteInput) {
    return request<ApiScheduleEntry>("/api/care-entries", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  updateScheduleEntry(id: string, input: ScheduleEntryWriteInput) {
    return request<ApiScheduleEntry>(`/api/care-entries/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },
  deleteEntry(id: string) {
    return request<void>(`/api/care-entries/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
  },
  async listOpenCareConfirmations() {
    const result = await request<ApiCareConfirmationRequest[]>("/api/care-confirmations/open");
    return result.map(mapConfirmation);
  },
  async answerCareConfirmation(id: string, input: ApiCareConfirmationAnswer) {
    const result = await request<ApiCareConfirmationRequest>(
      `/api/care-confirmations/${encodeURIComponent(id)}/answer`,
      { method: "POST", body: JSON.stringify(input) }
    );
    return mapConfirmation(result);
  },
  async remindCareConfirmationLater(id: string, nextReminderAt?: string) {
    const result = await request<ApiCareConfirmationRequest>(
      `/api/care-confirmations/${encodeURIComponent(id)}/remind-later`,
      { method: "POST", body: JSON.stringify({ nextReminderAt }) }
    );
    return mapConfirmation(result);
  },
  getNotificationPreferences() {
    return request<ApiNotificationPreferencesResponse>("/api/notification-preferences");
  },
  updateNotificationPreferences(preferences: ApiNotificationPreference[]) {
    return request<ApiNotificationPreferencesResponse>("/api/notification-preferences", {
      method: "PUT",
      body: JSON.stringify({ preferences })
    });
  },
  savePushSubscription(input: ApiPushSubscriptionInput) {
    return request<void>("/api/push-subscriptions", {
      method: "POST",
      body: JSON.stringify(input)
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
  createContactRule(input: ContactRuleWriteInput) {
    return request<ApiContactRule>("/api/contact-rules", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  updateContactRule(id: string, input: ContactRuleWriteInput) {
    return request<ApiContactRule>(
      `/api/contact-rules/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify(input) }
    );
  },
  previewContactRuleSync(id: string, input: { startDate: string; endDate: string }) {
    return request<ApiContactRuleSyncPreview>(
      `/api/contact-rules/${encodeURIComponent(id)}/sync-preview`,
      { method: "POST", body: JSON.stringify(input) }
    );
  },
  syncContactRule(id: string, input?: { startDate: string; endDate: string; previewFingerprint: string }) {
    return request<ApiContactRule>(
      `/api/contact-rules/${encodeURIComponent(id)}/sync`,
      {
        method: "POST",
        ...(input ? { body: JSON.stringify(input) } : {})
      }
    );
  },
  deleteContactRule(id: string) {
    return request<void>(`/api/contact-rules/${encodeURIComponent(id)}`, {
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
  loadEdgeCaseDemoData() {
    return request<void>("/api/demo-data/edge-cases", { method: "POST" });
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
  getCalendarFeed(scope: ApiCalendarFeedScope = "legacy") {
    return request<ApiCalendarFeedStatus>(`/api/calendar-feed?scope=${encodeURIComponent(scope)}`);
  },
  rotateCalendarFeed(scope: ApiCalendarFeedScope = "legacy") {
    return request<ApiCalendarFeedStatus>("/api/calendar-feed", {
      method: "POST",
      body: JSON.stringify({ scope })
    });
  },
  revokeCalendarFeed(scope?: ApiCalendarFeedScope) {
    const suffix = scope ? `?scope=${encodeURIComponent(scope)}` : "";
    return request<void>(`/api/calendar-feed${suffix}`, { method: "DELETE" });
  },
  listAppUsers() {
    return request<ApiAppUser[]>("/api/app-users");
  },
  listMembers() {
    return request<ApiMember[]>("/api/members");
  },
  updateMemberRole(userId: string, role: ApiWorkspaceRole) {
    return request<ApiMember>(
      `/api/members/${encodeURIComponent(userId)}/role`,
      { method: "PUT", body: JSON.stringify({ role }) }
    );
  },
  removeMember(userId: string) {
    return request<ApiMember>(
      `/api/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" }
    );
  },
  invitationCapabilities() {
    return request<import("../../shared/api").ApiInvitationCapabilities>(
      "/api/invitations/capabilities"
    );
  },
  listInvitations() {
    return request<ApiInvitation[]>("/api/invitations");
  },
  createInvitation(input: { role: ApiWorkspaceRole; expiresAt: string; emailHint?: string; sendEmail?: boolean }) {
    return request<ApiCreatedInvitation>("/api/invitations", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  revokeInvitation(id: string) {
    return request<ApiInvitation>(
      `/api/invitations/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
  },
  listUserCarePartyAssignments() {
    return request<ApiUserCarePartyAssignment[]>("/api/user-care-party-assignments");
  },
  getInstanceReadiness() {
    return request<ApiInstanceReadiness>("/api/instance-readiness");
  },
  completeFirstUseSetup(input: ApiSetupFirstUseInput) {
    return request<ApiSetupFirstUse>("/api/setup/first-use", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  updateUserCarePartyAssignment(userId: string, carePartyIds: string[]) {
    return request<ApiUserCarePartyAssignment>(
      `/api/user-care-party-assignments/${encodeURIComponent(userId)}`,
      { method: "PUT", body: JSON.stringify({ carePartyIds }) }
    );
  },
  exportPortableTransfer() {
    return request<unknown>("/api/data-transfer/export", undefined, 30_000);
  },
  dryRunPortableTransfer(packageData: unknown) {
    return request<ApiTransferDryRunResult>("/api/data-transfer/dry-run", {
      method: "POST",
      body: JSON.stringify(packageData)
    }, 60_000);
  },
  importPortableTransfer(input: {
    package: unknown;
    fingerprint: string;
    dryRunReceipt: string;
    confirmWarnings: boolean;
  }) {
    return request<ApiTransferDryRunResult>("/api/data-transfer/import", {
      method: "PUT",
      body: JSON.stringify(input)
    }, 120_000);
  },
  listTransferActors() {
    return request<ApiImportedTransferActor[]>("/api/data-transfer/actors");
  },
  mapTransferActor(id: string, input: {
    userId: string;
    role: ApiWorkspaceRole;
    carePartyIds: string[];
  }) {
    return request<{ mapped: true }>(`/api/data-transfer/actors/${encodeURIComponent(id)}/mapping`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },
  inviteTransferActor(id: string, input: {
    role: ApiWorkspaceRole;
    expiresAt: string;
    emailHint?: string;
  }) {
    return request<ApiCreatedInvitation>(`/api/data-transfer/actors/${encodeURIComponent(id)}/invitation`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }
  ,listExternalCalendarEvents(from: string, to: string) {
    return request<ApiExternalCalendarEvent[]>(`/api/external-calendar-events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  },
  listExternalCalendarBackupEvents() {
    return request<ApiExternalCalendarBackupEvent[]>("/api/external-calendar-events/export");
  },
  importExternalCalendar(input: { name: string; color: string; sourceType: ExternalCalendarSource["sourceType"]; content: string }) {
    return request<{ source: ExternalCalendarSource; importedEvents: number }>("/api/external-calendars/import", { method: "POST", body: JSON.stringify(input) });
  },
  replaceExternalCalendar(id: string, input: { name: string; color: string; sourceType: ExternalCalendarSource["sourceType"]; content: string }) {
    return request<{ source: ExternalCalendarSource; importedEvents: number }>(`/api/external-calendars/${encodeURIComponent(id)}/import`, { method: "PUT", body: JSON.stringify(input) });
  },
  importExternalCalendarFeed(input: { name: string; color: string; sourceType: ExternalCalendarSource["sourceType"]; url: string }) {
    return request<{ source: ExternalCalendarSource; importedEvents: number }>("/api/external-calendars/feed", { method: "POST", body: JSON.stringify(input) });
  },
  replaceExternalCalendarFeed(id: string, input: { name: string; color: string; sourceType: ExternalCalendarSource["sourceType"]; url: string }) {
    return request<{ source: ExternalCalendarSource; importedEvents: number }>(`/api/external-calendars/${encodeURIComponent(id)}/feed`, { method: "PUT", body: JSON.stringify(input) });
  },
  refreshExternalCalendarFeed(id: string) {
    return request<{ source: ExternalCalendarSource; importedEvents: number }>(`/api/external-calendars/${encodeURIComponent(id)}/refresh`, { method: "POST" });
  },
  updateExternalCalendar(id: string, input: Partial<Pick<ExternalCalendarSource, "name" | "color" | "visible" | "sourceType">>) {
    return request<ExternalCalendarSource>(`/api/external-calendars/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
  },
  deriveHolidaysFromExternalCalendar(id: string, input: { childIds: string[]; assignedTo: HolidayPeriod["assignedTo"] }) {
    return request<ApiExternalCalendarHolidayDeriveResult>(`/api/external-calendars/${encodeURIComponent(id)}/derive-holidays`, { method: "POST", body: JSON.stringify(input) });
  },
  deleteExternalCalendar(id: string) { return request<void>(`/api/external-calendars/${encodeURIComponent(id)}`, { method: "DELETE" }); }
};
