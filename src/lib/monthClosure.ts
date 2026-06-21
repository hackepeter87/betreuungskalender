import type { AppData, MonthlyClosure, MonthlyClosureSummary } from "../types";
import { calculateDataQuality, calculateMonthlyStats, entriesForMonth } from "./analytics";
import { addMonths, rangeForMonth, toMonthKey } from "./date";

export function monthKeysForRange(startDate: string, endDate: string): string[] {
  let cursor = startDate.slice(0, 7);
  const last = endDate.slice(0, 7);
  const months: string[] = [];
  while (cursor <= last) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return months;
}

export function buildMonthlyClosureSummary(
  data: AppData,
  monthKey: string
): MonthlyClosureSummary {
  const stats = calculateMonthlyStats(data, monthKey);
  const entries = entriesForMonth(data.entries, monthKey);
  const range = rangeForMonth(monthKey);
  const dataQuality = calculateDataQuality(
    data.entries,
    range.startDate,
    range.endDate
  );
  const warnings: string[] = [];

  if (!entries.length) warnings.push("Für diesen Monat sind keine Einträge vorhanden.");
  if (dataQuality.incompleteEntries) {
    warnings.push(
      `${dataQuality.incompleteEntries} Eintrag/Einträge sind unvollständig.`
    );
  }
  if (dataQuality.cancellationsWithoutReason) {
    warnings.push(
      `${dataQuality.cancellationsWithoutReason} Ausfall/Ausfälle haben keinen dokumentierten Grund.`
    );
  }
  if (dataQuality.overduePlannedEntries) {
    warnings.push(
      `${dataQuality.overduePlannedEntries} vergangene Soll-Termine sind noch als geplant markiert.`
    );
  }
  if (dataQuality.tripsWithoutPurpose) {
    warnings.push(
      `${dataQuality.tripsWithoutPurpose} Fahrt/Fahrten haben keinen Zweck.`
    );
  }
  if (dataQuality.costsWithoutCategory) {
    warnings.push(
      `${dataQuality.costsWithoutCategory} Kostenposten haben keine Kategorie.`
    );
  }

  return {
    entryCount: entries.length,
    careDays: stats.careDays,
    overnights: stats.overnights,
    weekends: stats.weekends,
    completedEntries: stats.completedEntries,
    plannedEntries: stats.plannedEntries,
    cancelledEntries: stats.cancelledEntries,
    completeness: stats.completeness,
    dataQuality,
    warnings
  };
}

export function closuresForRange(
  data: AppData,
  startDate: string,
  endDate: string
): MonthlyClosure[] {
  const keys = new Set(monthKeysForRange(startDate, endDate));
  return data.monthClosures.filter((closure) => keys.has(closure.monthKey));
}

export function reportClosureDescription(
  data: AppData,
  startDate: string,
  endDate: string,
  locale: "de" | "en" = "de"
): string {
  const months = monthKeysForRange(startDate, endDate);
  const closures = new Map(data.monthClosures.map((closure) => [closure.monthKey, closure]));
  const openMonths = months.filter((month) => !closures.has(month));
  const changedMonths = months.filter((month) => closures.get(month)?.changedAfterCloseAt);

  if (openMonths.length) {
    return locale === "en"
      ? `Contains open monthly data (${openMonths.join(", ")}).`
      : `Enthält noch offene Monatsdaten (${openMonths.join(", ")}).`;
  }
  if (changedMonths.length) {
    return locale === "en"
      ? `Contains closed monthly data changed after closure (${changedMonths.join(", ")}).`
      : `Enthält abgeschlossene, nachträglich geänderte Monatsdaten (${changedMonths.join(", ")}).`;
  }
  return locale === "en"
    ? "Contains closed monthly data only."
    : "Enthält ausschließlich abgeschlossene Monatsdaten.";
}

export function monthKeyForEntryDate(value: string): string {
  return toMonthKey(new Date(`${value.slice(0, 10)}T12:00:00`));
}
