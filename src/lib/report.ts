import {
  calculatePeriodStats,
  entriesForRange,
  unavailablePeriodsForRange
} from "./analytics";
import { formatDate, formatDateTime, formatTime } from "./date";
import {
  costCategoryLabel,
  statusLabel,
  unavailableCategoryLabel
} from "./labels";
import { reportClosureDescription } from "./monthClosure";
import type { AppData } from "../types";
import { localeMetadata, type AppLocale } from "../i18n/resources";
import { reportMessages } from "../i18n/reportMessages";

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
    locale: AppLocale;
  }
): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable")
  ]);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const messages = reportMessages[options.locale];
  const intlLocale = localeMetadata[options.locale].intlLocale;
  const euro = new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency: "EUR"
  });
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
  const closureDescription = reportClosureDescription(
    data,
    startDate,
    endDate,
    options.locale
  );
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
    title: `${messages.filePrefix} ${formatDate(startDate, intlLocale)} ${messages.through} ${formatDate(endDate, intlLocale)}`,
    subject: messages.pdfSubject,
    creator: "Betreuungskalender"
  });
  doc.setTextColor(20, 33, 61);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(messages.documentTitle, 14, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80, 92, 112);
  doc.text(`${messages.reportId}: ${options.reportId}`, 14, 25);
  doc.text(`${messages.createdAt}: ${formatDateTime(createdAt, intlLocale)}`, 14, 30);
  doc.text(`${messages.dataAsOf}: ${formatDateTime(data.updatedAt, intlLocale)}`, 14, 35);
  doc.text(`${messages.period}: ${formatDate(startDate, intlLocale)} ${messages.through} ${formatDate(endDate, intlLocale)}`, 14, 40);
  doc.text(
    `${messages.children}: ${data.children.map((child) => child.name).join(", ") || messages.noChildren}`,
    14,
    45
  );
  doc.text(closureDescription, 14, 50, { maxWidth: 180 });

  autoTable(doc, {
    startY: 57,
    head: [[messages.child, messages.days, messages.nights, messages.weekends, messages.additional, messages.holidayDays, messages.dayQuote, messages.nightQuote]],
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
    head: [[messages.plannedDates, messages.completed, messages.cancelledDuty, messages.cancelledOther, messages.overlaps, messages.additional, messages.tripKm, messages.costs]],
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
  doc.text(messages.costsByCategory, 14, 112);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const costText = Object.entries(stats.costsByCategory)
    .filter(([, amount]) => amount > 0)
    .map(([category, amount]) => `${costCategoryLabel(category as keyof typeof stats.costsByCategory, options.locale)}: ${euro.format(amount)}`)
    .join(" · ");
  doc.text(costText || messages.noCosts, 14, 118, {
    maxWidth: 180
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(messages.dailyList, 14, 129);

  autoTable(doc, {
    startY: 133,
    head: [[messages.period, messages.children, `${messages.status} / ${messages.classification}`, `${messages.days} / ${messages.nights}`, `km / ${messages.costs}`, messages.notesOrReason]],
    body: entries.map((entry) => {
      const entryCosts = entry.costs
        .filter((cost) => !cost.deletedAt)
        .reduce((sum, cost) => sum + cost.amount, 0);
      const entryKm = entry.trips
        .filter((trip) => !trip.deletedAt)
        .reduce((sum, trip) => sum + trip.km, 0);
      return [
        `${formatDate(entry.startDateTime, intlLocale)} ${formatTime(entry.startDateTime, intlLocale)}\n${messages.through} ${formatDate(entry.endDateTime, intlLocale)} ${formatTime(entry.endDateTime, intlLocale)}`,
        namesForEntry(data, entry.childIds),
        `${statusLabel(entry.status, options.locale)}${entry.additionalCare ? `\n${messages.additionalCare}` : ""}${entry.generatedByPatternId ? `\n${messages.plannedDate}` : ""}`,
        `${entry.overnight ? messages.overnight : messages.dayCare}${entry.schoolHandover ? `\n${messages.schoolHandover}` : ""}${entry.holiday ? `\n${messages.holiday}` : ""}`,
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
      doc.text(`${messages.page} ${pageNumber}`, 196, 289, { align: "right" });
    }
  });

  doc.addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(20, 33, 61);
  doc.text(messages.dutyUnavailabilityTitle, 14, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(75, 86, 105);
  doc.text(
    messages.unavailabilityNote,
    14,
    24,
    { maxWidth: 180 }
  );
  autoTable(doc, {
    startY: 32,
    head: [[messages.period, messages.category, messages.dutyRelated, messages.affects, messages.location, messages.evidenceReference, messages.note]],
    body: unavailablePeriods.map((period) => [
      `${formatDate(period.startDateTime, intlLocale)} ${formatTime(period.startDateTime, intlLocale)}\n${messages.through} ${formatDate(period.endDateTime, intlLocale)} ${formatTime(period.endDateTime, intlLocale)}`,
      unavailableCategoryLabel(period.category, options.locale),
      period.dutyRelated ? messages.yes : messages.no,
      [
        period.affectsContact ? messages.contact : "",
        period.affectsHolidays ? messages.holidays : ""
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
      doc.text(`${messages.page} ${pageNumber}`, 196, 289, { align: "right" });
    }
  });
  if (!unavailablePeriods.length) {
    doc.setFontSize(8);
    doc.text(messages.noUnavailable, 14, 39);
  }

  if (options.includeAuditHistory) {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(20, 33, 61);
    doc.text(messages.changeHistory, 14, 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(
      messages.historyNote,
      14,
      24
    );
    autoTable(doc, {
      startY: 30,
      head: [[messages.timestamp, messages.object, messages.action, messages.field, messages.oldValue, messages.newValue]],
      body: auditEntries.map((entry) => [
        formatDateTime(entry.timestamp, intlLocale),
        entry.objectLabel,
        entry.action === "created"
          ? messages.created
          : entry.action === "deleted"
            ? messages.deleted
            : messages.changed,
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
        doc.text(`${messages.page} ${pageNumber}`, 196, 289, { align: "right" });
      }
    });
  }

  const finalPage = doc.getNumberOfPages();
  doc.setPage(finalPage);
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(75, 86, 105);
  doc.text(messages.disclaimer, 14, pageHeight - 12, { maxWidth: 175 });

  doc.save(
    `${messages.filePrefix}-${options.reportId}-${startDate}-${messages.through}-${endDate}.pdf`
  );
}

export function makeReportId(): string {
  const datePart = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `BK-${datePart}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}
