import { createEmptyData } from "../data/defaults";
import type {
  AppData,
  BackupEnvelope,
  CareEntry,
  Child,
  DataQualityStats,
  MonthlyClosureSummary
} from "../types";
import { SCHEMA_VERSION } from "../types";
import { nowIso } from "./date";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChild(value: unknown): value is Child {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.birthMonth === "number" &&
    typeof value.birthYear === "number" &&
    typeof value.color === "string"
  );
}

function isEntry(value: unknown): value is CareEntry {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.date === "string" &&
    typeof value.startDateTime === "string" &&
    typeof value.endDateTime === "string" &&
    Array.isArray(value.childIds) &&
    value.childIds.every((id) => typeof id === "string") &&
    ["planned", "completed", "cancelled"].includes(String(value.status))
  );
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeDataQuality(value: unknown): DataQualityStats {
  const quality = isObject(value) ? value : {};
  const incompleteEntries = numberValue(quality.incompleteEntries);
  const cancellationsWithoutReason = numberValue(quality.cancellationsWithoutReason);
  const tripsWithoutPurpose = numberValue(quality.tripsWithoutPurpose);
  const costsWithoutCategory = numberValue(quality.costsWithoutCategory);
  const overduePlannedEntries = numberValue(quality.overduePlannedEntries);
  return {
    incompleteEntries,
    cancellationsWithoutReason,
    tripsWithoutPurpose,
    costsWithoutCategory,
    overduePlannedEntries,
    totalIssues: numberValue(
      quality.totalIssues,
      incompleteEntries +
        cancellationsWithoutReason +
        tripsWithoutPurpose +
        costsWithoutCategory +
        overduePlannedEntries
    )
  };
}

function normalizeClosureSummary(value: unknown): MonthlyClosureSummary {
  const summary = isObject(value) ? value : {};
  return {
    entryCount: numberValue(summary.entryCount),
    careDays: numberValue(summary.careDays),
    overnights: numberValue(summary.overnights),
    weekends: numberValue(summary.weekends),
    completedEntries: numberValue(summary.completedEntries),
    plannedEntries: numberValue(summary.plannedEntries),
    cancelledEntries: numberValue(summary.cancelledEntries),
    completeness: numberValue(summary.completeness),
    dataQuality: normalizeDataQuality(summary.dataQuality),
    warnings: Array.isArray(summary.warnings)
      ? summary.warnings.filter(
          (warning): warning is string => typeof warning === "string"
        )
      : []
  };
}

export function normalizeBackupData(value: unknown): AppData {
  if (
    !isObject(value) ||
    (value.schemaVersion !== 1 &&
      value.schemaVersion !== 2 &&
      value.schemaVersion !== 3 &&
      value.schemaVersion !== 4 &&
      value.schemaVersion !== 5 &&
      value.schemaVersion !== SCHEMA_VERSION)
  ) {
    throw new Error("Die Sicherung verwendet eine nicht unterstützte Datenversion.");
  }
  if (!Array.isArray(value.children) || !value.children.every(isChild)) {
    throw new Error("Die Kinderdaten der Sicherung sind ungültig.");
  }
  if (!Array.isArray(value.entries) || !value.entries.every(isEntry)) {
    throw new Error("Die Betreuungseinträge der Sicherung sind ungültig.");
  }

  const empty = createEmptyData();
  return {
    ...empty,
    ...value,
    schemaVersion: SCHEMA_VERSION,
    children: value.children.map((child) => ({
      ...child,
      createdBy: typeof child.createdBy === "string" ? child.createdBy : "local-dev",
      updatedBy: typeof child.updatedBy === "string" ? child.updatedBy : "local-dev"
    })),
    careParties: Array.isArray(value.careParties)
      ? value.careParties.filter(isObject).map((party) => ({
          id: String(party.id ?? ""),
          name: String(party.name ?? "Betreuende Person"),
          kind:
            party.kind === "father" ||
            party.kind === "mother" ||
            party.kind === "grandparent" ||
            party.kind === "foster_caregiver" ||
            party.kind === "other"
              ? party.kind
              : "other",
          createdBy: typeof party.createdBy === "string" ? party.createdBy : "local-dev",
          updatedBy: typeof party.updatedBy === "string" ? party.updatedBy : "local-dev",
          createdAt: typeof party.createdAt === "string" ? party.createdAt : nowIso(),
          updatedAt: typeof party.updatedAt === "string" ? party.updatedAt : nowIso()
        }))
      : [],
    entries: value.entries.map((entry) => ({
      ...entry,
      createdBy: typeof entry.createdBy === "string" ? entry.createdBy : "local-dev",
      updatedBy: typeof entry.updatedBy === "string" ? entry.updatedBy : "local-dev",
      additionalCare: Boolean(entry.additionalCare),
      generatedByPatternId:
        typeof entry.generatedByPatternId === "string"
          ? entry.generatedByPatternId
          : undefined,
      ruleOccurrenceDate:
        typeof entry.ruleOccurrenceDate === "string" ? entry.ruleOccurrenceDate : undefined,
      trips: Array.isArray(entry.trips)
        ? entry.trips.map((trip) =>
            isObject(trip)
              ? {
                  ...trip,
                  ownCar: typeof trip.ownCar === "boolean" ? trip.ownCar : true,
                  createdBy:
                    typeof trip.createdBy === "string" ? trip.createdBy : "local-dev",
                  updatedBy:
                    typeof trip.updatedBy === "string" ? trip.updatedBy : "local-dev",
                  deletedAt:
                    typeof trip.deletedAt === "string" ? trip.deletedAt : undefined
                }
              : trip
          )
        : [],
      costs: Array.isArray(entry.costs)
        ? entry.costs.map((cost) =>
            isObject(cost)
              ? {
                  ...cost,
                  createdBy:
                    typeof cost.createdBy === "string" ? cost.createdBy : "local-dev",
                  updatedBy:
                    typeof cost.updatedBy === "string" ? cost.updatedBy : "local-dev",
                  deletedAt:
                    typeof cost.deletedAt === "string" ? cost.deletedAt : undefined
                }
              : cost
          )
        : [],
      hasEvidence: Boolean(entry.hasEvidence),
      schoolHandover: Boolean(entry.schoolHandover),
      holiday: Boolean(entry.holiday),
      weekend: Boolean(entry.weekend),
      overnight: Boolean(entry.overnight),
      deletedAt:
        typeof entry.deletedAt === "string" ? entry.deletedAt : undefined
    })),
    holidayPeriods: Array.isArray(value.holidayPeriods)
      ? value.holidayPeriods
          .filter(isObject)
          .map((period) => ({
            id: String(period.id ?? ""),
            name: String(period.name ?? "Ferien"),
            startDate: String(period.startDate ?? ""),
            endDate: String(period.endDate ?? ""),
            childIds: Array.isArray(period.childIds)
              ? period.childIds.filter((id): id is string => typeof id === "string")
              : [],
            assignedTo:
              period.assignedTo === "mother" || period.assignedTo === "shared"
                ? period.assignedTo
                : "father",
            notes: typeof period.notes === "string" ? period.notes : undefined,
            createdBy:
              typeof period.createdBy === "string" ? period.createdBy : "local-dev",
            updatedBy:
              typeof period.updatedBy === "string" ? period.updatedBy : "local-dev",
            createdAt:
              typeof period.createdAt === "string" ? period.createdAt : nowIso(),
            updatedAt:
              typeof period.updatedAt === "string" ? period.updatedAt : nowIso(),
            deletedAt:
              typeof period.deletedAt === "string" ? period.deletedAt : undefined
          }))
      : [],
    unavailablePeriods: Array.isArray(value.unavailablePeriods)
      ? value.unavailablePeriods
          .filter(isObject)
          .map((period) => ({
            id: String(period.id ?? ""),
            startDateTime: String(period.startDateTime ?? ""),
            endDateTime: String(period.endDateTime ?? ""),
            category:
              period.category === "duty" ||
              period.category === "training_course" ||
              period.category === "exercise" ||
              period.category === "guard_duty" ||
              period.category === "standby" ||
              period.category === "deployment" ||
              period.category === "business_trip" ||
              period.category === "illness" ||
              period.category === "private_unavailability" ||
              period.category === "vacation_without_children" ||
              period.category === "other"
                ? period.category
                : "other",
            dutyRelated: Boolean(period.dutyRelated),
            affectsContact: Boolean(period.affectsContact),
            affectsHolidays: Boolean(period.affectsHolidays),
            location:
              typeof period.location === "string" ? period.location : undefined,
            notes: typeof period.notes === "string" ? period.notes : undefined,
            hasEvidence: Boolean(period.hasEvidence),
            evidenceReference:
              typeof period.evidenceReference === "string"
                ? period.evidenceReference
                : undefined,
            createdBy:
              typeof period.createdBy === "string" ? period.createdBy : "local-dev",
            updatedBy:
              typeof period.updatedBy === "string" ? period.updatedBy : "local-dev",
            createdAt:
              typeof period.createdAt === "string" ? period.createdAt : nowIso(),
            updatedAt:
              typeof period.updatedAt === "string" ? period.updatedAt : nowIso(),
            deletedAt:
              typeof period.deletedAt === "string" ? period.deletedAt : undefined
          }))
      : [],
    externalCalendarSources: Array.isArray(value.externalCalendarSources)
      ? value.externalCalendarSources.filter(isObject).map((source) => ({
          id: String(source.id ?? ""),
          name: String(source.name ?? ""),
          color: String(source.color ?? "#2563eb"),
          visible: Boolean(source.visible),
          lastImportedAt: String(source.lastImportedAt ?? nowIso()),
          createdAt: String(source.createdAt ?? nowIso()),
          updatedAt: String(source.updatedAt ?? nowIso())
        }))
      : [],
    externalCalendarEvents: Array.isArray(value.externalCalendarEvents)
      ? value.externalCalendarEvents.filter(isObject).map((event) => ({
          id: String(event.id ?? ""),
          sourceId: String(event.sourceId ?? ""),
          icalUid: String(event.icalUid ?? ""),
          recurrenceId: String(event.recurrenceId ?? ""),
          title: String(event.title ?? ""),
          description: typeof event.description === "string" ? event.description : undefined,
          startDateTime: String(event.startDateTime ?? ""),
          endDateTime: String(event.endDateTime ?? ""),
          allDay: Boolean(event.allDay),
          location: typeof event.location === "string" ? event.location : undefined,
          rawHash: String(event.rawHash ?? ""),
          createdAt: String(event.createdAt ?? nowIso()),
          updatedAt: String(event.updatedAt ?? nowIso())
        }))
      : [],
    contactPatterns: Array.isArray(value.contactPatterns)
      ? value.contactPatterns
          .filter(isObject)
          .map((pattern) => ({
            id: String(pattern.id ?? ""),
            name: String(pattern.name ?? "14-Tage-Regel"),
            startDate: String(pattern.startDate ?? ""),
            frequency: "biweekly" as const,
            fridayStartTime:
              typeof pattern.fridayStartTime === "string"
                ? pattern.fridayStartTime
                : typeof pattern.startTime === "string"
                  ? pattern.startTime
                  : "16:00",
            sundayEndTime:
              typeof pattern.sundayEndTime === "string"
                ? pattern.sundayEndTime
                : typeof pattern.endTime === "string"
                  ? pattern.endTime
                  : "18:00",
            childIds: Array.isArray(pattern.childIds)
              ? pattern.childIds.filter((id): id is string => typeof id === "string")
              : [],
            active: typeof pattern.active === "boolean" ? pattern.active : true,
            createdBy:
              typeof pattern.createdBy === "string" ? pattern.createdBy : "local-dev",
            updatedBy:
              typeof pattern.updatedBy === "string" ? pattern.updatedBy : "local-dev",
            createdAt:
              typeof pattern.createdAt === "string" ? pattern.createdAt : nowIso(),
            updatedAt:
              typeof pattern.updatedAt === "string" ? pattern.updatedAt : nowIso()
          }))
      : [],
    auditLog: Array.isArray(value.auditLog)
      ? value.auditLog.filter(isObject).map((entry) => ({
          id: String(entry.id ?? ""),
          timestamp: String(entry.timestamp ?? ""),
          userId: String(entry.userId ?? "local-dev"),
          userDisplayName:
            typeof entry.userDisplayName === "string"
              ? entry.userDisplayName
              : undefined,
          objectType:
            entry.objectType === "trip" ||
            entry.objectType === "cost" ||
            entry.objectType === "holiday" ||
            entry.objectType === "unavailablePeriod" ||
            entry.objectType === "child" ||
            entry.objectType === "careParty" ||
            entry.objectType === "contactPattern" ||
            entry.objectType === "settings" ||
            entry.objectType === "monthClosure" ||
            entry.objectType === "appData" ||
            entry.objectType === "userCarePartyAssignment" ||
            entry.objectType === "legacyMigration"
              ? entry.objectType
              : "careEntry",
          objectId: String(entry.objectId ?? ""),
          objectLabel: String(entry.objectLabel ?? ""),
          field: String(entry.field ?? ""),
          oldValue: String(entry.oldValue ?? "–"),
          newValue: String(entry.newValue ?? "–"),
          action:
            entry.action === "created" || entry.action === "deleted"
              ? entry.action
              : "updated",
          effectiveDate:
            typeof entry.effectiveDate === "string"
              ? entry.effectiveDate
              : undefined
        }))
      : [],
    monthClosures: Array.isArray(value.monthClosures)
      ? value.monthClosures
          .filter(isObject)
          .map((closure) => ({
            monthKey: String(closure.monthKey ?? ""),
            closedAt: String(closure.closedAt ?? ""),
            closedBy: String(closure.closedBy ?? "local-dev"),
            dataUpdatedAt: String(closure.dataUpdatedAt ?? ""),
            summary: normalizeClosureSummary(closure.summary),
            changedAfterCloseAt:
              typeof closure.changedAfterCloseAt === "string"
                ? closure.changedAfterCloseAt
                : undefined,
            updatedBy: String(closure.updatedBy ?? closure.closedBy ?? "local-dev")
          }))
      : [],
    lastJsonBackupAt:
      typeof value.lastJsonBackupAt === "string"
        ? value.lastJsonBackupAt
        : undefined,
    settings: isObject(value.settings)
      ? { ...empty.settings, ...value.settings }
      : empty.settings,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : nowIso()
  } as AppData;
}

export function createBackup(data: AppData): BackupEnvelope {
  return {
    application: "betreuungskalender",
    exportedAt: nowIso(),
    data
  };
}

export function parseBackup(raw: string): AppData {
  const parsed: unknown = JSON.parse(raw);
  if (isObject(parsed) && parsed.application === "betreuungskalender" && "data" in parsed) {
    return normalizeBackupData(parsed.data);
  }
  return normalizeBackupData(parsed);
}
