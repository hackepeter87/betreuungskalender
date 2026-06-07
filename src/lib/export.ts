import {
  costCategoryLabels,
  handoverLabels,
  holidayAssignmentLabels,
  locationLabels,
  paidByLabels,
  statusLabels,
  tripPurposeLabels
  ,
  unavailableCategoryLabels
} from "./labels";
import type { AppData } from "../types";

function csvCell(value: unknown): string {
  const normalized =
    value === undefined || value === null
      ? ""
      : typeof value === "boolean"
        ? value
          ? "ja"
          : "nein"
        : String(value);
  return `"${normalized.replaceAll('"', '""')}"`;
}

function csv(rows: unknown[][]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
}

export function downloadText(
  filename: string,
  content: string,
  type = "text/csv;charset=utf-8"
): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function childNames(data: AppData, childIds: string[]): string {
  return childIds
    .map((id) => data.children.find((child) => child.id === id)?.name ?? id)
    .join(", ");
}

export function exportEntriesCsv(data: AppData): void {
  const rows: unknown[][] = [
    [
      "ID",
      "Datum",
      "Beginn",
      "Ende",
      "Kinder",
      "Kinder-IDs",
      "Status",
      "Zusatzbetreuung",
      "Regel-ID",
      "Soll-Termin",
      "Übernachtung",
      "Schulübergabe",
      "Ferientag",
      "Wochenende",
      "Betreuungsort",
      "Anderer Ort",
      "Übergabe von",
      "Übergabe an",
      "Ausfallgrund",
      "Notizen",
      "Beleg vorhanden",
      "Belegreferenz",
      "Fahrten vollständig",
      "Kosten vollständig",
      "Erstellt",
      "Geändert",
      "Gelöscht am"
    ]
  ];

  for (const entry of data.entries) {
    rows.push([
      entry.id,
      entry.date,
      entry.startDateTime,
      entry.endDateTime,
      childNames(data, entry.childIds),
      entry.childIds.join(","),
      statusLabels[entry.status],
      entry.additionalCare,
      entry.generatedByPatternId,
      entry.ruleOccurrenceDate,
      entry.overnight,
      entry.schoolHandover,
      entry.holiday,
      entry.weekend,
      locationLabels[entry.location],
      entry.customLocation,
      handoverLabels[entry.handoverFrom],
      handoverLabels[entry.handoverTo],
      entry.cancellationReason,
      entry.notes,
      entry.hasEvidence,
      entry.evidenceReference,
      JSON.stringify(entry.trips),
      JSON.stringify(entry.costs),
      entry.createdAt,
      entry.updatedAt,
      entry.deletedAt
    ]);
  }

  downloadText("betreuungseintraege.csv", csv(rows));
}

export function exportTripsCsv(data: AppData): void {
  const rows: unknown[][] = [
    [
      "Fahrt-ID",
      "Eintrag-ID",
      "Datum",
      "Kinder",
      "Zweck",
      "Kilometer",
      "Eigener Pkw",
      "Erstattet",
      "Erstattungsbetrag EUR",
      "Notiz",
      "Eintrag gelöscht am",
      "Fahrt gelöscht am"
    ]
  ];
  for (const entry of data.entries) {
    for (const trip of entry.trips) {
      rows.push([
        trip.id,
        entry.id,
        entry.date,
        childNames(data, entry.childIds),
        tripPurposeLabels[trip.purpose],
        trip.km,
        trip.ownCar,
        trip.reimbursed,
        trip.reimbursementAmount,
        trip.notes,
        entry.deletedAt,
        trip.deletedAt
      ]);
    }
  }
  downloadText("fahrten.csv", csv(rows));
}

export function exportCostsCsv(data: AppData): void {
  const rows: unknown[][] = [
    [
      "Kosten-ID",
      "Eintrag-ID",
      "Datum",
      "Kinder",
      "Kategorie",
      "Betrag EUR",
      "Gezahlt von",
      "Notiz",
      "Eintrag gelöscht am",
      "Kosten gelöscht am"
    ]
  ];
  for (const entry of data.entries) {
    for (const cost of entry.costs) {
      rows.push([
        cost.id,
        entry.id,
        entry.date,
        childNames(data, entry.childIds),
        costCategoryLabels[cost.category],
        cost.amount.toFixed(2),
        paidByLabels[cost.paidBy],
        cost.notes,
        entry.deletedAt,
        cost.deletedAt
      ]);
    }
  }
  downloadText("kosten.csv", csv(rows));
}

export function exportHolidaysCsv(data: AppData): void {
  const rows: unknown[][] = [
    ["Ferien-ID", "Bezeichnung", "Von", "Bis", "Kinder", "Zuordnung", "Notiz", "Gelöscht am"]
  ];
  for (const period of data.holidayPeriods) {
    rows.push([
      period.id,
      period.name,
      period.startDate,
      period.endDate,
      childNames(data, period.childIds),
      holidayAssignmentLabels[period.assignedTo],
      period.notes,
      period.deletedAt
    ]);
  }
  downloadText("ferien.csv", csv(rows));
}

export function exportUnavailablePeriodsCsv(data: AppData): void {
  const rows: unknown[][] = [
    [
      "ID",
      "Beginn",
      "Ende",
      "Kategorie",
      "Dienstlich veranlasst",
      "Betrifft Umgang",
      "Betrifft Ferienplanung",
      "Ort",
      "Notiz",
      "Beleg vorhanden",
      "Belegreferenz",
      "Erstellt von",
      "Geändert von",
      "Erstellt",
      "Geändert",
      "Gelöscht am"
    ]
  ];
  for (const period of data.unavailablePeriods) {
    rows.push([
      period.id,
      period.startDateTime,
      period.endDateTime,
      unavailableCategoryLabels[period.category],
      period.dutyRelated,
      period.affectsContact,
      period.affectsHolidays,
      period.location,
      period.notes,
      period.hasEvidence,
      period.evidenceReference,
      period.createdBy,
      period.updatedBy,
      period.createdAt,
      period.updatedAt,
      period.deletedAt
    ]);
  }
  downloadText("nichtverfuegbarkeiten.csv", csv(rows));
}
