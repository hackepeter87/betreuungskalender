export interface FormattedDateTimeRange {
  start: string;
  end: string;
  sameDay: boolean;
}

export const SUPPORTED_DATE_MIN = "1900-01-01";
export const SUPPORTED_DATE_MAX = "2200-12-31";
export const MAX_DOMAIN_RANGE_DAYS = 366;
export const MAX_ENUMERATED_DATE_KEYS = 3_660;

export interface DateRangeEnumerationOptions {
  clipStart?: string;
  clipEnd?: string;
  maximumDays?: number;
}

function dateFromKey(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
}

interface CivilDateTimeParts {
  dateKey: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function civilDateTimeParts(value: string): CivilDateTimeParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const dateKey = `${yearText}-${monthText}-${dayText}`;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!isValidDateKey(dateKey) || hour > 23 || minute > 59) return null;
  return {
    dateKey,
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour,
    minute
  };
}

function previousDateKey(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}

export function isSupportedDateKey(value: string): boolean {
  return isValidDateKey(value) && value >= SUPPORTED_DATE_MIN && value <= SUPPORTED_DATE_MAX;
}

function inclusiveDayCount(startDate: string, endDate: string): number {
  return Math.floor((dateFromKey(endDate).getTime() - dateFromKey(startDate).getTime()) / 86_400_000) + 1;
}

export function isInclusiveDateRangeWithinDays(startDate: string, endDate: string, maximumDays: number): boolean {
  return isSupportedDateKey(startDate) && isSupportedDateKey(endDate) &&
    startDate <= endDate && inclusiveDayCount(startDate, endDate) <= maximumDays;
}

export function isTimedRangeWithinDays(startDateTime: string, endDateTime: string, maximumDays: number): boolean {
  const range = occupiedDateRangeForTimedRange(startDateTime, endDateTime);
  return Boolean(range && isInclusiveDateRangeWithinDays(range.startDate, range.endDate, maximumDays));
}

export function dateKeysForInclusiveRange(
  startDate: string,
  endDate: string,
  options: DateRangeEnumerationOptions = {}
): string[] {
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) return [];
  if (options.clipStart && !isValidDateKey(options.clipStart)) return [];
  if (options.clipEnd && !isValidDateKey(options.clipEnd)) return [];
  const boundedStart = options.clipStart && options.clipStart > startDate ? options.clipStart : startDate;
  const boundedEnd = options.clipEnd && options.clipEnd < endDate ? options.clipEnd : endDate;
  const cursor = dateFromKey(boundedStart);
  const end = dateFromKey(boundedEnd);
  if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(end.getTime()) || cursor > end) return [];

  const maximumDays = options.maximumDays ?? MAX_ENUMERATED_DATE_KEYS;
  if (!Number.isInteger(maximumDays) || maximumDays < 1) {
    throw new RangeError("Date enumeration requires a positive integer budget.");
  }
  if (inclusiveDayCount(boundedStart, boundedEnd) > maximumDays) {
    throw new RangeError(`Date range exceeds the processing budget of ${maximumDays} days.`);
  }

  const result: string[] = [];
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export function isValidTimedRange(startDateTime: string, endDateTime: string): boolean {
  const start = Date.parse(startDateTime);
  const end = Date.parse(endDateTime);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

export function occupiedDateRangeForTimedRange(
  startDateTime: string,
  endDateTime: string
): { startDate: string; endDate: string } | null {
  if (!isValidTimedRange(startDateTime, endDateTime)) return null;
  const start = civilDateTimeParts(startDateTime);
  const end = civilDateTimeParts(endDateTime);
  if (!start || !end) return null;
  const lastDateKey = end.hour === 0 && end.minute === 0
    ? previousDateKey(end.dateKey)
    : end.dateKey;
  if (lastDateKey < start.dateKey) return null;
  return { startDate: start.dateKey, endDate: lastDateKey };
}

export function dateKeysForTimedRange(
  startDateTime: string,
  endDateTime: string,
  options: DateRangeEnumerationOptions = {}
): string[] {
  const range = occupiedDateRangeForTimedRange(startDateTime, endDateTime);
  return range ? dateKeysForInclusiveRange(range.startDate, range.endDate, options) : [];
}

export function timedRangesOverlap(
  firstStart: string,
  firstEnd: string,
  secondStart: string,
  secondEnd: string
): boolean {
  return Date.parse(firstStart) < Date.parse(secondEnd) && Date.parse(firstEnd) > Date.parse(secondStart);
}

export function formatCivilTime(value: string, locale: string): string {
  const parts = civilDateTimeParts(value);
  if (!parts) return value;
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)));
}

export function formatDateTimeRange(
  startDateTime: string,
  endDateTime: string,
  locale: string
): FormattedDateTimeRange {
  const start = civilDateTimeParts(startDateTime);
  const end = civilDateTimeParts(endDateTime);
  if (!start || !end) {
    return { start: startDateTime, end: endDateTime, sameDay: false };
  }
  const date = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC"
  });
  const startValue = new Date(Date.UTC(start.year, start.month - 1, start.day, start.hour, start.minute));
  const endValue = new Date(Date.UTC(end.year, end.month - 1, end.day, end.hour, end.minute));
  const startTime = formatCivilTime(startDateTime, locale);
  const endTime = formatCivilTime(endDateTime, locale);
  const sameDay = start.dateKey === end.dateKey;

  if (sameDay) {
    return {
      start: date.format(startValue),
      end: `${startTime}–${endTime}`,
      sameDay
    };
  }

  return {
    start: `${date.format(startValue)}, ${startTime}`,
    end: `${date.format(endValue)}, ${endTime}`,
    sameDay
  };
}
