import type {
  AuditAction,
  AuditLogEntry,
  AuditObjectType,
  CareEntry,
  Cost,
  HolidayPeriod,
  Trip,
  UnavailablePeriod
} from "../types";
import { makeId } from "./date";

const fieldLabels: Record<string, string> = {
  object: "Objekt",
  date: "Datum",
  startDateTime: "Beginn",
  endDateTime: "Ende",
  childIds: "Kinder",
  status: "Status",
  additionalCare: "Zusatzbetreuung",
  overnight: "Übernachtung",
  schoolHandover: "Schulübergabe",
  holiday: "Ferienkennzeichnung",
  weekend: "Wochenende",
  location: "Betreuungsort",
  customLocation: "Eigener Betreuungsort",
  handoverFrom: "Übergabe von",
  handoverTo: "Übergabe an",
  cancellationReason: "Ausfallgrund",
  notes: "Notiz",
  hasEvidence: "Beleg vorhanden",
  evidenceReference: "Belegreferenz",
  purpose: "Zweck",
  km: "Kilometer",
  ownCar: "Eigener Pkw",
  reimbursed: "Erstattet",
  reimbursementAmount: "Erstattungsbetrag",
  category: "Kategorie",
  amount: "Betrag",
  paidBy: "Gezahlt von",
  name: "Bezeichnung",
  startDate: "Beginn",
  endDate: "Ende",
  assignedTo: "Zuordnung"
  ,
  dutyRelated: "Dienstlich veranlasst",
  affectsContact: "Betrifft Umgang",
  affectsHolidays: "Betrifft Ferienplanung"
};

function auditValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "–";
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "–";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function makeAuditEntry(
  objectType: AuditObjectType,
  objectId: string,
  objectLabel: string,
  field: string,
  oldValue: unknown,
  newValue: unknown,
  action: AuditAction,
  timestamp: string,
  effectiveDate?: string
): AuditLogEntry {
  return {
    id: makeId("audit"),
    timestamp,
    objectType,
    objectId,
    objectLabel,
    field: fieldLabels[field] ?? field,
    oldValue: auditValue(oldValue),
    newValue: auditValue(newValue),
    action,
    effectiveDate
  };
}

function diffFields(
  objectType: AuditObjectType,
  objectId: string,
  objectLabel: string,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  fields: string[],
  timestamp: string,
  effectiveDate?: string
): AuditLogEntry[] {
  if (!before) {
    return [
      makeAuditEntry(
        objectType,
        objectId,
        objectLabel,
        "object",
        undefined,
        "erstellt",
        "created",
        timestamp,
        effectiveDate
      )
    ];
  }

  return fields.flatMap((field) => {
    const oldSerialized = auditValue(before[field]);
    const newSerialized = auditValue(after[field]);
    if (oldSerialized === newSerialized) return [];
    return [
      makeAuditEntry(
        objectType,
        objectId,
        objectLabel,
        field,
        before[field],
        after[field],
        "updated",
        timestamp,
        effectiveDate
      )
    ];
  });
}

function nestedDiff<T extends Trip | Cost>(
  objectType: "trip" | "cost",
  objectLabel: string,
  before: T[],
  after: T[],
  fields: string[],
  timestamp: string,
  effectiveDate: string
): AuditLogEntry[] {
  const previous = new Map(before.map((item) => [item.id, item]));
  const changes: AuditLogEntry[] = [];

  for (const item of after) {
    const oldItem = previous.get(item.id);
    if (!oldItem) {
      changes.push(
        makeAuditEntry(
          objectType,
          item.id,
          objectLabel,
          "object",
          undefined,
          "erstellt",
          "created",
          timestamp,
          effectiveDate
        )
      );
      continue;
    }
    if (!oldItem.deletedAt && item.deletedAt) {
      changes.push(
        makeAuditEntry(
          objectType,
          item.id,
          objectLabel,
          "object",
          "vorhanden",
          "gelöscht",
          "deleted",
          timestamp,
          effectiveDate
        )
      );
      continue;
    }
    changes.push(
      ...diffFields(
        objectType,
        item.id,
        objectLabel,
        oldItem as unknown as Record<string, unknown>,
        item as unknown as Record<string, unknown>,
        fields,
        timestamp,
        effectiveDate
      )
    );
  }

  return changes;
}

export function auditEntryChange(
  before: CareEntry | undefined,
  after: CareEntry,
  timestamp: string
): AuditLogEntry[] {
  const effectiveDate = after.startDateTime.slice(0, 10);
  const label = `Betreuungseintrag ${effectiveDate}`;
  if (before && !before.deletedAt && after.deletedAt) {
    return [
      makeAuditEntry(
        "careEntry",
        after.id,
        label,
        "object",
        "vorhanden",
        "gelöscht",
        "deleted",
        timestamp,
        effectiveDate
      ),
      ...nestedDiff(
        "trip",
        `Fahrt zu ${effectiveDate}`,
        before.trips,
        after.trips,
        ["purpose", "km", "ownCar", "reimbursed", "reimbursementAmount", "notes"],
        timestamp,
        effectiveDate
      ),
      ...nestedDiff(
        "cost",
        `Kosten zu ${effectiveDate}`,
        before.costs,
        after.costs,
        ["category", "amount", "paidBy", "notes"],
        timestamp,
        effectiveDate
      )
    ];
  }

  const entryChanges = diffFields(
    "careEntry",
    after.id,
    label,
    before as unknown as Record<string, unknown> | undefined,
    after as unknown as Record<string, unknown>,
    [
      "date",
      "startDateTime",
      "endDateTime",
      "childIds",
      "status",
      "additionalCare",
      "overnight",
      "schoolHandover",
      "holiday",
      "weekend",
      "location",
      "customLocation",
      "handoverFrom",
      "handoverTo",
      "cancellationReason",
      "notes",
      "hasEvidence",
      "evidenceReference"
    ],
    timestamp,
    effectiveDate
  );

  return [
    ...entryChanges,
    ...nestedDiff(
      "trip",
      `Fahrt zu ${effectiveDate}`,
      before?.trips ?? [],
      after.trips,
      ["purpose", "km", "ownCar", "reimbursed", "reimbursementAmount", "notes"],
      timestamp,
      effectiveDate
    ),
    ...nestedDiff(
      "cost",
      `Kosten zu ${effectiveDate}`,
      before?.costs ?? [],
      after.costs,
      ["category", "amount", "paidBy", "notes"],
      timestamp,
      effectiveDate
    )
  ];
}

export function auditHolidayChange(
  before: HolidayPeriod | undefined,
  after: HolidayPeriod,
  timestamp: string
): AuditLogEntry[] {
  const label = `Ferienblock ${after.name}`;
  if (before && !before.deletedAt && after.deletedAt) {
    return [
      makeAuditEntry(
        "holiday",
        after.id,
        label,
        "object",
        "vorhanden",
        "gelöscht",
        "deleted",
        timestamp,
        after.startDate
      )
    ];
  }
  return diffFields(
    "holiday",
    after.id,
    label,
    before as unknown as Record<string, unknown> | undefined,
    after as unknown as Record<string, unknown>,
    ["name", "startDate", "endDate", "childIds", "assignedTo", "notes"],
    timestamp,
    after.startDate
  );
}

export function auditUnavailablePeriodChange(
  before: UnavailablePeriod | undefined,
  after: UnavailablePeriod,
  timestamp: string
): AuditLogEntry[] {
  const effectiveDate = after.startDateTime.slice(0, 10);
  const label = `Nichtverfügbarkeit ${effectiveDate}`;
  if (before && !before.deletedAt && after.deletedAt) {
    return [
      makeAuditEntry(
        "unavailablePeriod",
        after.id,
        label,
        "object",
        "vorhanden",
        "gelöscht",
        "deleted",
        timestamp,
        effectiveDate
      )
    ];
  }
  return diffFields(
    "unavailablePeriod",
    after.id,
    label,
    before as unknown as Record<string, unknown> | undefined,
    after as unknown as Record<string, unknown>,
    [
      "startDateTime",
      "endDateTime",
      "category",
      "dutyRelated",
      "affectsContact",
      "affectsHolidays",
      "location",
      "notes",
      "hasEvidence",
      "evidenceReference"
    ],
    timestamp,
    effectiveDate
  );
}

export function softDeleteMissing<T extends { id: string; deletedAt?: string }>(
  previous: T[],
  submitted: T[],
  timestamp: string
): T[] {
  const submittedIds = new Set(submitted.map((item) => item.id));
  const removed = previous
    .filter((item) => !item.deletedAt && !submittedIds.has(item.id))
    .map((item) => ({ ...item, deletedAt: timestamp }));
  const alreadyDeleted = previous.filter((item) => item.deletedAt);
  return [...submitted, ...removed, ...alreadyDeleted];
}
