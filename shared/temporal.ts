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
  const start = new Date(startDateTime);
  const lastTouchedInstant = new Date(Date.parse(endDateTime) - 1);
  return dateKeysForInclusiveRange(localDateKey(start), localDateKey(lastTouchedInstant));
}

export function timedRangesOverlap(
  firstStart: string,
  firstEnd: string,
  secondStart: string,
  secondEnd: string
): boolean {
  return Date.parse(firstStart) < Date.parse(secondEnd) && Date.parse(firstEnd) > Date.parse(secondStart);
}

export function formatDateTimeRange(
  startDateTime: string,
  endDateTime: string,
  locale: string
): FormattedDateTimeRange {
  const start = new Date(startDateTime);
  const end = new Date(endDateTime);
  const date = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit"
  });
  const sameDay = localDateKey(start) === localDateKey(end);

  if (sameDay) {
    return {
      start: date.format(start),
      end: `${time.format(start)}–${time.format(end)}`,
      sameDay
    };
  }

  return {
    start: `${date.format(start)}, ${time.format(start)}`,
    end: `${date.format(end)}, ${time.format(end)}`,
    sameDay
  };
}
