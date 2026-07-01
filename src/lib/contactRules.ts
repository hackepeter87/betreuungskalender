import type {
  ApiContactRuleSegment,
  ContactRuleRecurrence,
  ContactRuleWeekday
} from "../../shared/api";
import { addDays } from "./date";

const weekdayIndexes: Record<ContactRuleWeekday, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6
};

const indexWeekdays: ContactRuleWeekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export interface ExpandedContactRuleEntry {
  occurrenceDate: string;
  occurrenceKey: string;
  segmentId: string;
  startDateTime: string;
  endDateTime: string;
}

function differenceInDays(first: string, second: string): number {
  const firstDate = new Date(`${first}T12:00:00`);
  const secondDate = new Date(`${second}T12:00:00`);
  return Math.round((secondDate.getTime() - firstDate.getTime()) / 86_400_000);
}

function startOfWeek(date: string): string {
  return addDays(date, -new Date(`${date}T12:00:00`).getDay());
}

function weekdayFor(date: string): ContactRuleWeekday {
  return indexWeekdays[new Date(`${date}T12:00:00`).getDay()] ?? "SU";
}

function firstDayOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function addMonths(date: string, months: number): string {
  const [year = 0, month = 1] = date.split("-").map(Number);
  const value = new Date(year, month - 1 + months, 1, 12);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-01`;
}

function monthsBetween(first: string, second: string): number {
  const [firstYear = 0, firstMonth = 1] = first.split("-").map(Number);
  const [secondYear = 0, secondMonth = 1] = second.split("-").map(Number);
  return (secondYear - firstYear) * 12 + (secondMonth - firstMonth);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0, 12).getDate();
}

function dateInMonth(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthlyOrdinalDate(
  year: number,
  month: number,
  weekday: ContactRuleWeekday,
  ordinal: 1 | 2 | 3 | 4 | 5 | -1
): string | undefined {
  const targetWeekday = weekdayIndexes[weekday];
  if (ordinal === -1) {
    for (let day = daysInMonth(year, month); day >= 1; day -= 1) {
      const date = dateInMonth(year, month, day);
      if (new Date(`${date}T12:00:00`).getDay() === targetWeekday) return date;
    }
    return undefined;
  }
  let count = 0;
  for (let day = 1; day <= daysInMonth(year, month); day += 1) {
    const date = dateInMonth(year, month, day);
    if (new Date(`${date}T12:00:00`).getDay() !== targetWeekday) continue;
    count += 1;
    if (count === ordinal) return date;
  }
  return undefined;
}

function weeklyDates(
  recurrence: Extract<ContactRuleRecurrence, { kind: "weekly" }>,
  anchorDate: string,
  startDate: string,
  endDate: string
): string[] {
  const result: string[] = [];
  const anchorWeek = startOfWeek(anchorDate);
  let current = startDate;
  while (current <= endDate) {
    const weekOffset = Math.floor(differenceInDays(anchorWeek, startOfWeek(current)) / 7);
    if (
      weekOffset >= 0 &&
      weekOffset % recurrence.intervalWeeks === 0 &&
      recurrence.weekdays.includes(weekdayFor(current))
    ) {
      result.push(current);
    }
    current = addDays(current, 1);
  }
  return result;
}

function monthlyDates(
  recurrence: Extract<ContactRuleRecurrence, { kind: "monthlyByWeekday" }>,
  anchorDate: string,
  startDate: string,
  endDate: string
): string[] {
  const result: string[] = [];
  let currentMonth = firstDayOfMonth(startDate);
  const endMonth = firstDayOfMonth(endDate);
  const anchorMonth = firstDayOfMonth(anchorDate);

  while (currentMonth <= endMonth) {
    const offset = monthsBetween(anchorMonth, currentMonth);
    if (offset >= 0 && offset % recurrence.intervalMonths === 0) {
      const [year = 0, month = 1] = currentMonth.split("-").map(Number);
      for (const ordinal of recurrence.ordinals) {
        for (const weekday of recurrence.weekdays) {
          const date = monthlyOrdinalDate(year, month, weekday, ordinal);
          if (date && date >= startDate && date <= endDate) result.push(date);
        }
      }
    }
    currentMonth = addMonths(currentMonth, 1);
  }
  return [...new Set(result)].sort();
}

export function expandContactRule(input: {
  startDate: string;
  endDate?: string;
  recurrence: ContactRuleRecurrence;
  segments: ApiContactRuleSegment[];
  active: boolean;
  childIds: string[];
  rangeStart: string;
  rangeEnd: string;
}): ExpandedContactRuleEntry[] {
  if (!input.active || !input.childIds.length || !input.segments.length) return [];
  const rangeStart = input.rangeStart > input.startDate ? input.rangeStart : input.startDate;
  const rangeEnd = input.endDate && input.endDate < input.rangeEnd ? input.endDate : input.rangeEnd;
  if (rangeEnd < rangeStart) return [];

  const dates =
    input.recurrence.kind === "weekly"
      ? weeklyDates(input.recurrence, input.startDate, rangeStart, rangeEnd)
      : monthlyDates(input.recurrence, input.startDate, rangeStart, rangeEnd);

  return dates.flatMap((occurrenceDate) =>
    input.segments
      .filter((segment) => segment.endDayOffset >= segment.startDayOffset)
      .map((segment) => {
        const startDate = addDays(occurrenceDate, segment.startDayOffset);
        const endDate = addDays(occurrenceDate, segment.endDayOffset);
        return {
          occurrenceDate,
          occurrenceKey: `${occurrenceDate}:${segment.id}`,
          segmentId: segment.id,
          startDateTime: `${startDate}T${segment.startTime}`,
          endDateTime: `${endDate}T${segment.endTime}`
        };
      })
  ).sort((a, b) => a.startDateTime.localeCompare(b.startDateTime));
}
