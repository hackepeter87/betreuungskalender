import {
  calculatePeriodStats,
  entriesForRange,
  unavailablePeriodsForRange
} from "./analytics";
import { formatDate, formatDateTime, formatTime } from "./date";
import {
  costCategoryLabels,
  statusLabels,
  unavailableCategoryLabels
} from "./labels";
import { reportClosureDescription } from "./monthClosure";
import type { AppData } from "../types";

const euro = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR"
});

function namesForEntry(data: AppData, childIds: string[]): string {
  return childIds
    .map((id) => data.children.find((child) => child.id === id)?.name ?? id)
    .join(", ");
}

export async function exportPdfReport(
  data: AppData,
  startDate: string,
  endDate: string,
  options: {
    reportId: string;
    includeAuditHistory: boolean;
    createdAt: string;
  }
): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable")
  ]);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const stats = calculatePeriodStats(data, startDate, endDate);
  const entries = entriesForRange(data.entries, startDate, endDate)
    .slice()
    .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime));
  const unavailablePeriods = unavailablePeriodsForRange(
    data.unavailablePeriods,
    startDate,
    endDate
  ).sort((a, b) => a.startDateTime.localeCompare(b.startDateTime));
  const createdAt = new Date(options.createdAt);
  const closureDescription = reportClosureDescription(data, startDate, endDate);
  const auditEntries = data.auditLog
    .filter(
      (entry) =>
        entry.effectiveDate &&
        entry.effectiveDate >= startDate &&
        entry.effectiveDate <= endDate
    )
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  doc.setProperties({
    title: `Betreuungsbericht ${formatDate(startDate)} bis ${formatDate(endDate)}`,
    subject: "Dokumentierte Betreuungszeiten",
    creator: "Betreuungskalender"
  });
  doc.setTextColor(20, 33, 61);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Bericht zu dokumentierten Betreuungszeiten", 14, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80, 92, 112);
  doc.text(`Berichts-ID: ${options.reportId}`, 14, 25);
  doc.text(`Erstellt am: ${formatDateTime(createdAt)}`, 14, 30);
  doc.text(`Datenstand: ${formatDateTime(data.updatedAt)}`, 14, 35);
  doc.text(`Zeitraum: ${formatDate(startDate)} bis ${formatDate(endDate)}`, 14, 40);
  doc.text(
    `Kinder: ${data.children.map((child) => child.name).join(", ") || "Keine Kinder erfasst"}`,
    14,
    45
  );
  doc.text(closureDescription, 14, 50, { maxWidth: 180 });

  autoTable(doc, {
    startY: 57,
    head: [["Kind", "Tage", "Nächte", "Wochenenden", "Zusätzlich", "Ferientage", "Tagquote", "Nachtquote"]],
    body: stats.byChild.map((childStats) => [
      data.children.find((child) => child.id === childStats.childId)?.name ?? "",
      childStats.careDays,
      childStats.overnights,
      childStats.weekends,
      childStats.additionalEntries,
      childStats.holidayDays,
      `${childStats.careDayQuote} %`,
      `${childStats.overnightQuote} %`
    ]),
    theme: "grid",
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: 2 },
    headStyles: { fillColor: [8, 127, 123], textColor: 255 }
  });

  autoTable(doc, {
    startY: 88,
    head: [["Soll-Termine", "Durchgeführt", "Dienstlich ausgefallen", "Sonstig ausgefallen", "Überschneidungen", "Zusätzlich", "Fahrt-km", "Kosten"]],
    body: [[
      stats.contact.scheduled,
      stats.contact.completed,
      stats.contact.cancelledDutyRelated,
      stats.contact.cancelledOther,
      stats.contact.unavailableOverlaps,
      stats.contact.additional,
      stats.tripKm.toFixed(1),
      euro.format(stats.costsTotal)
    ]],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: 2 },
    headStyles: { fillColor: [52, 64, 84], textColor: 255 }
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(20, 33, 61);
  doc.text("Kosten nach Kategorie", 14, 112);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const costText = Object.entries(stats.costsByCategory)
    .filter(([, amount]) => amount > 0)
    .map(([category, amount]) => `${costCategoryLabels[category as keyof typeof costCategoryLabels]}: ${euro.format(amount)}`)
    .join(" · ");
  doc.text(costText || "Keine Kosten im Zeitraum dokumentiert.", 14, 118, {
    maxWidth: 180
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Tabellarische Tagesliste", 14, 129);

  autoTable(doc, {
    startY: 133,
    head: [["Datum / Zeit", "Kinder", "Status / Einordnung", "Tage / Nächte", "km / Kosten", "Notizen / Ausfallgrund"]],
    body: entries.map((entry) => {
      const entryCosts = entry.costs
        .filter((cost) => !cost.deletedAt)
        .reduce((sum, cost) => sum + cost.amount, 0);
      const entryKm = entry.trips
        .filter((trip) => !trip.deletedAt)
        .reduce((sum, trip) => sum + trip.km, 0);
      return [
        `${formatDate(entry.startDateTime)} ${formatTime(entry.startDateTime)}\nbis ${formatDate(entry.endDateTime)} ${formatTime(entry.endDateTime)}`,
        namesForEntry(data, entry.childIds),
        `${statusLabels[entry.status]}${entry.additionalCare ? "\nZusatzbetreuung" : ""}${entry.generatedByPatternId ? "\nSoll-Termin" : ""}`,
        `${entry.overnight ? "Übernachtung" : "Tagesbetreuung"}${entry.schoolHandover ? "\nSchulübergabe" : ""}${entry.holiday ? "\nFerientag" : ""}`,
        `${entryKm.toFixed(1)} km\n${euro.format(entryCosts)}`,
        entry.cancellationReason || entry.notes || "–"
      ];
    }),
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 6.8,
      cellPadding: 1.6,
      overflow: "linebreak",
      valign: "top"
    },
    headStyles: { fillColor: [8, 127, 123], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 31 },
      1: { cellWidth: 24 },
      2: { cellWidth: 28 },
      3: { cellWidth: 30 },
      4: { cellWidth: 23 },
      5: { cellWidth: 49 }
    },
    didDrawPage: () => {
      const pageNumber = doc.getNumberOfPages();
      doc.setFontSize(7);
      doc.setTextColor(110, 120, 135);
      doc.text(`Seite ${pageNumber}`, 196, 289, { align: "right" });
    }
  });

  doc.addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(20, 33, 61);
  doc.text("Dienstlich bedingte Nichtverfügbarkeit", 14, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(75, 86, 105);
  doc.text(
    "Dokumentierte Nichtverfügbarkeiten werden gesondert ausgewiesen und nicht automatisch als nicht wahrgenommene Betreuung bewertet.",
    14,
    24,
    { maxWidth: 180 }
  );
  autoTable(doc, {
    startY: 32,
    head: [["Zeitraum", "Kategorie", "Dienstlich", "Betrifft", "Ort", "Belegreferenz", "Notiz"]],
    body: unavailablePeriods.map((period) => [
      `${formatDate(period.startDateTime)} ${formatTime(period.startDateTime)}\nbis ${formatDate(period.endDateTime)} ${formatTime(period.endDateTime)}`,
      unavailableCategoryLabels[period.category],
      period.dutyRelated ? "Ja" : "Nein",
      [
        period.affectsContact ? "Umgang" : "",
        period.affectsHolidays ? "Ferien" : ""
      ].filter(Boolean).join(", ") || "–",
      period.location || "–",
      period.evidenceReference || "–",
      period.notes || "–"
    ]),
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 6.8,
      cellPadding: 1.6,
      overflow: "linebreak",
      valign: "top"
    },
    headStyles: { fillColor: [94, 82, 154], textColor: 255 },
    didDrawPage: () => {
      const pageNumber = doc.getNumberOfPages();
      doc.setFontSize(7);
      doc.setTextColor(110, 120, 135);
      doc.text(`Seite ${pageNumber}`, 196, 289, { align: "right" });
    }
  });
  if (!unavailablePeriods.length) {
    doc.setFontSize(8);
    doc.text("Im Zeitraum sind keine Nichtverfügbarkeiten dokumentiert.", 14, 39);
  }

  if (options.includeAuditHistory) {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(20, 33, 61);
    doc.text("Änderungshistorie", 14, 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(
      "Enthalten sind protokollierte Änderungen mit einem Bezugsdatum im Berichtszeitraum.",
      14,
      24
    );
    autoTable(doc, {
      startY: 30,
      head: [["Zeitpunkt", "Objekt", "Vorgang", "Feld", "Alter Wert", "Neuer Wert"]],
      body: auditEntries.map((entry) => [
        formatDateTime(entry.timestamp),
        entry.objectLabel,
        entry.action === "created"
          ? "Erstellt"
          : entry.action === "deleted"
            ? "Gelöscht"
            : "Geändert",
        entry.field,
        entry.oldValue,
        entry.newValue
      ]),
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 6.5,
        cellPadding: 1.5,
        overflow: "linebreak",
        valign: "top"
      },
      headStyles: { fillColor: [52, 64, 84], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 27 },
        1: { cellWidth: 31 },
        2: { cellWidth: 18 },
        3: { cellWidth: 25 },
        4: { cellWidth: 42 },
        5: { cellWidth: 42 }
      },
      didDrawPage: () => {
        const pageNumber = doc.getNumberOfPages();
        doc.setFontSize(7);
        doc.setTextColor(110, 120, 135);
        doc.text(`Seite ${pageNumber}`, 196, 289, { align: "right" });
      }
    });
  }

  const finalPage = doc.getNumberOfPages();
  doc.setPage(finalPage);
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(75, 86, 105);
  const disclaimer =
    "Die Auswertung basiert auf den vom Nutzer dokumentierten tatsächlichen Betreuungszeiten.";
  doc.text(disclaimer, 14, pageHeight - 12, { maxWidth: 175 });

  doc.save(`betreuungsbericht-${options.reportId}-${startDate}-bis-${endDate}.pdf`);
}

export function makeReportId(): string {
  const datePart = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `BK-${datePart}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}
