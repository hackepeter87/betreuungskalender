import * as rrule from "rrule";
import type {
  ApiContactRuleSegment,
  ContactRuleMonthlyOrdinal,
  ContactRuleRecurrence,
  ContactRuleWeekday
} from "./api.js";

const rruleExports = rrule as typeof rrule & {
  default?: typeof rrule;
  rrule?: typeof rrule;
};
const { RRule } = rruleExports.default ?? rruleExports.rrule ?? rruleExports;

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

export interface ContactRuleExpansionInput {
  startDate: string;
  endDate?: string;
  recurrence: ContactRuleRecurrence;
  segments: ApiContactRuleSegment[];
  active: boolean;
  childIds: string[];
  rangeStart: string;
  rangeEnd: string;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function differenceInDays(first: string, second: string): number {
  const firstDate = new Date(`${first}T12:00:00Z`);
  const secondDate = new Date(`${second}T12:00:00Z`);
  return Math.round((secondDate.getTime() - firstDate.getTime()) / 86_400_000);
}

function startOfWeek(date: string): string {
  return addDays(date, -new Date(`${date}T12:00:00Z`).getUTCDay());
}

function weekdayFor(date: string): ContactRuleWeekday {
  return indexWeekdays[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? "SU";
}

function firstDayOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function addMonths(date: string, months: number): string {
  const [year = 0, month = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + months, 1, 12)).toISOString().slice(0, 10);
}

function monthsBetween(first: string, second: string): number {
  const [firstYear = 0, firstMonth = 1] = first.split("-").map(Number);
  const [secondYear = 0, secondMonth = 1] = second.split("-").map(Number);
  return (secondYear - firstYear) * 12 + (secondMonth - firstMonth);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
}

function dateInMonth(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day, 12)).toISOString().slice(0, 10);
}

function monthlyOrdinalDate(
  year: number,
  month: number,
  weekday: ContactRuleWeekday,
  ordinal: ContactRuleMonthlyOrdinal
): string | undefined {
  const targetWeekday = weekdayIndexes[weekday];
  if (ordinal === -1) {
    for (let day = daysInMonth(year, month); day >= 1; day -= 1) {
      const date = dateInMonth(year, month, day);
      if (new Date(`${date}T12:00:00Z`).getUTCDay() === targetWeekday) return date;
    }
    return undefined;
  }

  let count = 0;
  for (let day = 1; day <= daysInMonth(year, month); day += 1) {
    const date = dateInMonth(year, month, day);
    if (new Date(`${date}T12:00:00Z`).getUTCDay() !== targetWeekday) continue;
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

function normalizeRRuleLine(value: string): string {
  const trimmed = value.trim();
  return trimmed.toUpperCase().startsWith("RRULE:")
    ? trimmed.slice("RRULE:".length)
    : trimmed;
}

function dateToRRuleDate(date: string): Date {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function rruleDates(
  recurrence: Extract<ContactRuleRecurrence, { kind: "rrule" }>,
  anchorDate: string,
  startDate: string,
  endDate: string
): Array<{ date: string; ruleIndex: number }> {
  return recurrence.rrules.flatMap((line, ruleIndex) => {
    const options = RRule.parseString(normalizeRRuleLine(line));
    const rule = new RRule({
      ...options,
      dtstart: dateToRRuleDate(anchorDate)
    });
    return rule
      .between(dateToRRuleDate(startDate), dateToRRuleDate(endDate), true)
      .map((date) => ({ date: date.toISOString().slice(0, 10), ruleIndex }));
  });
}

function assertValidSegment(segment: ApiContactRuleSegment): void {
  const valid = Number.isInteger(segment.startDayOffset) &&
    Number.isInteger(segment.endDayOffset) &&
    segment.startDayOffset >= 0 &&
    segment.endDayOffset >= segment.startDayOffset &&
    (segment.endDayOffset > segment.startDayOffset || segment.endTime > segment.startTime);
  if (!valid) {
    throw new RangeError("Contact-rule segment end must be after its start.");
  }
}

export function expandContactRule(input: ContactRuleExpansionInput): ExpandedContactRuleEntry[] {
  if (!input.active || !input.childIds.length || !input.segments.length) return [];
  input.segments.forEach(assertValidSegment);
  const rangeStart = input.rangeStart > input.startDate ? input.rangeStart : input.startDate;
  const rangeEnd = input.endDate && input.endDate < input.rangeEnd ? input.endDate : input.rangeEnd;
  if (rangeEnd < rangeStart) return [];

  const occurrenceDates =
    input.recurrence.kind === "weekly"
      ? weeklyDates(input.recurrence, input.startDate, rangeStart, rangeEnd).map((date) => ({ date, ruleIndex: 0 }))
      : input.recurrence.kind === "monthlyByWeekday"
        ? monthlyDates(input.recurrence, input.startDate, rangeStart, rangeEnd).map((date) => ({ date, ruleIndex: 0 }))
        : rruleDates(input.recurrence, input.startDate, rangeStart, rangeEnd);

  const entries: ExpandedContactRuleEntry[] = [];
  for (const occurrence of occurrenceDates) {
    for (const segment of input.segments) {
      const startDate = addDays(occurrence.date, segment.startDayOffset);
      const endDate = addDays(occurrence.date, segment.endDayOffset);
      if (endDate < input.rangeStart || startDate > input.rangeEnd) continue;
      entries.push({
        occurrenceDate: occurrence.date,
        occurrenceKey: input.recurrence.kind === "rrule"
          ? `${occurrence.date}:r${occurrence.ruleIndex}:${segment.id}`
          : `${occurrence.date}:${segment.id}`,
        segmentId: segment.id,
        startDateTime: `${startDate}T${segment.startTime}`,
        endDateTime: `${endDate}T${segment.endTime}`
      });
    }
  }
  return entries.sort((a, b) => a.startDateTime.localeCompare(b.startDateTime));
}
