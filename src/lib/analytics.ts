import type {
  AppData,
  CareEntry,
  ContactStats,
  CostCategory,
  DataQualityStats,
  HolidayPeriod,
  HolidayStats,
  MonthlyChildStats,
  MonthlyStats,
  PeriodChildStats,
  PeriodStats,
  UnavailablePeriod
} from "../types";
import {
  addDays,
  countEntryOvernights,
  daysBetween,
  entryDateKeys,
  enumerateDateKeys,
  isWeekdayOvernight,
  isWeekendDate,
  rangeForMonth,
  rangesOverlap,
  weekendKey
} from "./date";

const costCategories: CostCategory[] = [
  "food",
  "leisure",
  "school",
  "clothing",
  "travel",
  "other"
];

function emptyCosts(): Record<CostCategory, number> {
  return {
    food: 0,
    leisure: 0,
    school: 0,
    clothing: 0,
    travel: 0,
    other: 0
  };
}

function activeTrips(entry: CareEntry) {
  return entry.trips.filter((trip) => !trip.deletedAt);
}

function activeCosts(entry: CareEntry) {
  return entry.costs.filter((cost) => !cost.deletedAt);
}

export function isEntryComplete(entry: CareEntry): boolean {
  return Boolean(
    !entry.deletedAt &&
    entry.childIds.length &&
      entry.startDateTime &&
      entry.endDateTime &&
      new Date(entry.endDateTime) > new Date(entry.startDateTime) &&
      entry.location &&
      entry.handoverFrom &&
      entry.handoverTo &&
      activeCosts(entry).every((cost) => cost.amount > 0 && Boolean(cost.category)) &&
      activeTrips(entry).every((trip) => trip.km > 0 && Boolean(trip.purpose)) &&
      (entry.status !== "cancelled" || entry.cancellationReason?.trim())
  );
}

export function entriesForRange(
  entries: CareEntry[],
  startDate: string,
  endDate: string
): CareEntry[] {
  return entries.filter(
    (entry) =>
      !entry.deletedAt &&
      rangesOverlap(
        entry.startDateTime.slice(0, 10),
        entry.endDateTime.slice(0, 10),
        startDate,
        endDate
      )
  );
}

export function entriesForMonth(entries: CareEntry[], monthKey: string): CareEntry[] {
  const range = rangeForMonth(monthKey);
  return entriesForRange(entries, range.startDate, range.endDate);
}

export function unavailablePeriodsForRange(
  periods: UnavailablePeriod[],
  startDate: string,
  endDate: string
): UnavailablePeriod[] {
  return periods.filter(
    (period) =>
      !period.deletedAt &&
      rangesOverlap(
        period.startDateTime.slice(0, 10),
        period.endDateTime.slice(0, 10),
        startDate,
        endDate
      )
  );
}

export function dateTimeRangesOverlap(
  firstStart: string,
  firstEnd: string,
  secondStart: string,
  secondEnd: string
): boolean {
  return Date.parse(firstStart) < Date.parse(secondEnd) &&
    Date.parse(firstEnd) > Date.parse(secondStart);
}

export function unavailableForEntry(
  entry: CareEntry,
  periods: UnavailablePeriod[],
  options?: { affectsContactOnly?: boolean; dutyRelatedOnly?: boolean }
): UnavailablePeriod[] {
  return periods.filter(
    (period) =>
      !period.deletedAt &&
      (!options?.affectsContactOnly || period.affectsContact) &&
      (!options?.dutyRelatedOnly || period.dutyRelated) &&
      dateTimeRangesOverlap(
        entry.startDateTime,
        entry.endDateTime,
        period.startDateTime,
        period.endDateTime
      )
  );
}

function clippedEntryDates(entry: CareEntry, startDate: string, endDate: string): string[] {
  return entryDateKeys(entry.startDateTime, entry.endDateTime).filter(
    (dateKey) => dateKey >= startDate && dateKey <= endDate
  );
}

function clippedOvernightCount(
  entry: CareEntry,
  startDate: string,
  endDate: string
): number {
  if (!entry.overnight) return 0;
  const totalNights = countEntryOvernights(entry.startDateTime, entry.endDateTime);
  if (totalNights === 0) return 1;
  const firstNight = entry.startDateTime.slice(0, 10);
  const lastNight = addDays(entry.endDateTime.slice(0, 10), -1);
  if (!rangesOverlap(firstNight, lastNight, startDate, endDate)) return 0;
  const clippedStart = firstNight > startDate ? firstNight : startDate;
  const clippedEnd = lastNight < endDate ? lastNight : endDate;
  return daysBetween(clippedStart, clippedEnd);
}

export function calculateHolidayStats(
  periods: HolidayPeriod[],
  startDate: string,
  endDate: string,
  childId?: string,
  unavailablePeriods: UnavailablePeriod[] = []
): HolidayStats {
  const assignments = new Map<string, HolidayPeriod["assignedTo"]>();

  for (const period of periods) {
    if (period.deletedAt) continue;
    if (childId && period.childIds.length && !period.childIds.includes(childId)) continue;
    if (!rangesOverlap(period.startDate, period.endDate, startDate, endDate)) continue;
    const clippedStart = period.startDate > startDate ? period.startDate : startDate;
    const clippedEnd = period.endDate < endDate ? period.endDate : endDate;
    for (const dateKey of enumerateDateKeys(clippedStart, clippedEnd)) {
      const existing = assignments.get(dateKey);
      assignments.set(
        dateKey,
        existing && existing !== period.assignedTo ? "shared" : period.assignedTo
      );
    }
  }

  let fatherDays = 0;
  let motherDays = 0;
  for (const assignment of assignments.values()) {
    if (assignment === "father") fatherDays += 1;
    if (assignment === "mother") motherDays += 1;
    if (assignment === "shared") {
      fatherDays += 0.5;
      motherDays += 0.5;
    }
  }

  const totalDays = assignments.size;
  const halfTarget = totalDays / 2;
  const relevantHolidayPeriods = periods.filter(
    (period) =>
      !period.deletedAt &&
      (!childId || !period.childIds.length || period.childIds.includes(childId)) &&
      rangesOverlap(period.startDate, period.endDate, startDate, endDate)
  );
  const unavailableCount = unavailablePeriods.filter(
    (period) =>
      !period.deletedAt &&
      period.dutyRelated &&
      period.affectsHolidays &&
      relevantHolidayPeriods.some((holiday) =>
        rangesOverlap(
          period.startDateTime.slice(0, 10),
          period.endDateTime.slice(0, 10),
          holiday.startDate,
          holiday.endDate
        )
      )
  ).length;
  return {
    totalDays,
    fatherDays,
    motherDays,
    fatherQuote: totalDays ? Math.round((fatherDays / totalDays) * 1000) / 10 : 0,
    halfTarget,
    differenceFromHalf: fatherDays - halfTarget,
    unavailablePeriods: unavailableCount
  };
}

export function calculateContactStats(
  entries: CareEntry[],
  unavailablePeriods: UnavailablePeriod[],
  startDate: string,
  endDate: string
): ContactStats {
  const relevant = entriesForRange(entries, startDate, endDate);
  const scheduled = relevant.filter((entry) => entry.generatedByPatternId);
  const cancelled = scheduled.filter((entry) => entry.status === "cancelled");
  const cancelledDutyRelated = cancelled.filter(
    (entry) =>
      unavailableForEntry(entry, unavailablePeriods, {
        affectsContactOnly: true,
        dutyRelatedOnly: true
      }).length > 0
  ).length;
  return {
    scheduled: scheduled.length,
    pending: scheduled.filter((entry) => entry.status === "planned").length,
    completed: scheduled.filter((entry) => entry.status === "completed").length,
    cancelled: cancelled.length,
    cancelledDutyRelated,
    cancelledOther: cancelled.length - cancelledDutyRelated,
    unavailableOverlaps: scheduled.filter(
      (entry) =>
        unavailableForEntry(entry, unavailablePeriods, {
          affectsContactOnly: true
        }).length > 0
    ).length,
    additional: relevant.filter(
      (entry) => entry.additionalCare && entry.status === "completed"
    ).length
  };
}

function calculateEntityStats(
  data: AppData,
  entries: CareEntry[],
  startDate: string,
  endDate: string,
  childId?: string
): PeriodChildStats {
  const relevant = childId
    ? entries.filter((entry) => entry.childIds.includes(childId))
    : entries;
  const completed = relevant.filter((entry) => entry.status === "completed");
  const careDays = new Set<string>();
  const weekendDays = new Set<string>();
  const weekends = new Set<string>();
  let overnights = 0;
  let careHours = 0;
  let schoolHandovers = 0;
  let weekdayOvernights = 0;
  let tripKm = 0;
  let calculatedTravelCost = 0;
  let reimbursedAmount = 0;
  let costsTotal = 0;

  for (const entry of completed) {
    const rangeStart = new Date(`${startDate}T00:00:00`).getTime();
    const rangeEnd = new Date(`${addDays(endDate, 1)}T00:00:00`).getTime();
    const clippedStart = Math.max(new Date(entry.startDateTime).getTime(), rangeStart);
    const clippedEnd = Math.min(new Date(entry.endDateTime).getTime(), rangeEnd);
    careHours += Math.max(0, clippedEnd - clippedStart) / 3_600_000;

    for (const dateKey of clippedEntryDates(entry, startDate, endDate)) {
      careDays.add(dateKey);
      if (isWeekendDate(dateKey)) {
        weekendDays.add(dateKey);
        weekends.add(weekendKey(dateKey));
      }
    }

    const share = childId ? 1 / Math.max(1, entry.childIds.length) : 1;
    const entryOvernights = clippedOvernightCount(entry, startDate, endDate);
    overnights += entryOvernights;
    if (entry.schoolHandover) schoolHandovers += 1;
    if (entry.overnight && isWeekdayOvernight(entry.startDateTime)) {
      weekdayOvernights += entryOvernights;
    }

    for (const trip of activeTrips(entry)) {
      tripKm += trip.km * share;
      if (trip.ownCar) calculatedTravelCost += trip.km * data.settings.kilometerRate * share;
      if (trip.reimbursed) reimbursedAmount += (trip.reimbursementAmount ?? 0) * share;
    }
    for (const cost of activeCosts(entry)) costsTotal += cost.amount * share;
  }

  const totalDays = daysBetween(startDate, endDate);
  const holidayStats = calculateHolidayStats(
    data.holidayPeriods,
    startDate,
    endDate,
    childId,
    data.unavailablePeriods
  );

  return {
    childId,
    careHours: Math.round(careHours * 10) / 10,
    careDays: careDays.size,
    overnights,
    weekendDays: weekendDays.size,
    weekends: weekends.size,
    schoolHandovers,
    weekdayOvernights,
    additionalEntries: completed.filter((entry) => entry.additionalCare).length,
    holidayDays: holidayStats.fatherDays,
    plannedEntries: relevant.filter((entry) => entry.status === "planned").length,
    completedEntries: completed.length,
    cancelledEntries: relevant.filter((entry) => entry.status === "cancelled").length,
    careDayQuote: totalDays ? Math.round((careDays.size / totalDays) * 1000) / 10 : 0,
    overnightQuote: totalDays ? Math.round((overnights / totalDays) * 1000) / 10 : 0,
    tripKm: Math.round(tripKm * 10) / 10,
    calculatedTravelCost: Math.round(calculatedTravelCost * 100) / 100,
    reimbursedAmount: Math.round(reimbursedAmount * 100) / 100,
    costsTotal: Math.round(costsTotal * 100) / 100
  };
}

export function calculatePeriodStats(
  data: AppData,
  startDate: string,
  endDate: string
): PeriodStats {
  const entries = entriesForRange(data.entries, startDate, endDate);
  const aggregate = calculateEntityStats(data, entries, startDate, endDate);
  const costsByCategory = emptyCosts();

  for (const entry of entries) {
    if (entry.status !== "completed") continue;
    for (const cost of activeCosts(entry)) costsByCategory[cost.category] += cost.amount;
  }

  for (const category of costCategories) {
    costsByCategory[category] = Math.round(costsByCategory[category] * 100) / 100;
  }

  return {
    ...aggregate,
    startDate,
    endDate,
    totalDays: daysBetween(startDate, endDate),
    completeness: entries.length
      ? Math.round((entries.filter(isEntryComplete).length / entries.length) * 100)
      : 100,
    contact: calculateContactStats(
      data.entries,
      data.unavailablePeriods,
      startDate,
      endDate
    ),
    holidays: calculateHolidayStats(
      data.holidayPeriods,
      startDate,
      endDate,
      undefined,
      data.unavailablePeriods
    ),
    costsByCategory,
    byChild: data.children.map((child) =>
      calculateEntityStats(data, entries, startDate, endDate, child.id)
    )
  };
}

export function calculateDataQuality(
  entries: CareEntry[],
  startDate?: string,
  endDate?: string,
  now = new Date()
): DataQualityStats {
  const relevant =
    startDate && endDate
      ? entriesForRange(entries, startDate, endDate)
      : entries.filter((entry) => !entry.deletedAt);
  const incompleteEntries = relevant.filter((entry) => !isEntryComplete(entry)).length;
  const cancellationsWithoutReason = relevant.filter(
    (entry) => entry.status === "cancelled" && !entry.cancellationReason?.trim()
  ).length;
  const tripsWithoutPurpose = relevant.reduce(
    (sum, entry) =>
      sum + activeTrips(entry).filter((trip) => !trip.purpose).length,
    0
  );
  const costsWithoutCategory = relevant.reduce(
    (sum, entry) =>
      sum + activeCosts(entry).filter((cost) => !cost.category).length,
    0
  );
  const overduePlannedEntries = relevant.filter(
    (entry) => entry.status === "planned" && new Date(entry.endDateTime) < now
  ).length;

  return {
    incompleteEntries,
    cancellationsWithoutReason,
    tripsWithoutPurpose,
    costsWithoutCategory,
    overduePlannedEntries,
    totalIssues:
      incompleteEntries +
      cancellationsWithoutReason +
      tripsWithoutPurpose +
      costsWithoutCategory +
      overduePlannedEntries
  };
}

export function calculateMonthlyStats(data: AppData, monthKey: string): MonthlyStats {
  const range = rangeForMonth(monthKey);
  const period = calculatePeriodStats(data, range.startDate, range.endDate);
  const byChild: MonthlyChildStats[] = period.byChild.map((child) => ({
    childId: child.childId ?? "",
    careDays: child.careDays,
    overnights: child.overnights,
    weekendDays: child.weekendDays,
    weekends: child.weekends,
    schoolHandovers: child.schoolHandovers,
    weekdayOvernights: child.weekdayOvernights,
    plannedEntries: child.plannedEntries,
    completedEntries: child.completedEntries,
    cancelledEntries: child.cancelledEntries
  }));

  return {
    monthKey,
    careDays: period.careDays,
    overnights: period.overnights,
    weekends: period.weekends,
    completeness: period.completeness,
    completedEntries: period.completedEntries,
    plannedEntries: period.plannedEntries,
    cancelledEntries: period.cancelledEntries,
    byChild
  };
}
