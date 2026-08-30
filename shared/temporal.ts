export interface FormattedDateTimeRange {
  start: string;
  end: string;
  sameDay: boolean;
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(value: string): Date {
  return new Date(`${value}T12:00:00`);
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

export function dateKeysForInclusiveRange(startDate: string, endDate: string): string[] {
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) return [];
  const cursor = dateFromKey(startDate);
  const end = dateFromKey(endDate);
  if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(end.getTime()) || cursor > end) return [];

  const result: string[] = [];
  while (cursor <= end) {
    result.push(localDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

export function isValidTimedRange(startDateTime: string, endDateTime: string): boolean {
  const start = Date.parse(startDateTime);
  const end = Date.parse(endDateTime);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

export function dateKeysForTimedRange(startDateTime: string, endDateTime: string): string[] {
  if (!isValidTimedRange(startDateTime, endDateTime)) return [];
  const start = civilDateTimeParts(startDateTime);
  const end = civilDateTimeParts(endDateTime);
  if (!start || !end) return [];
  const lastDateKey = end.hour === 0 && end.minute === 0
    ? previousDateKey(end.dateKey)
    : end.dateKey;
  return dateKeysForInclusiveRange(start.dateKey, lastDateKey);
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
