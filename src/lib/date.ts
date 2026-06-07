const germanMonthFormatter = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric"
});

const germanDateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

const shortDateFormatter = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit"
});

export function localDate(value: string | Date): Date {
  if (value instanceof Date) return new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00`);
  return new Date(value);
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function toMonthKey(date: Date): string {
  return toDateKey(date).slice(0, 7);
}

export function parseMonthKey(monthKey: string): Date {
  return new Date(`${monthKey}-01T12:00:00`);
}

export function formatMonth(monthKey: string): string {
  return germanMonthFormatter.format(parseMonthKey(monthKey));
}

export function formatDate(value: string | Date): string {
  return germanDateFormatter.format(localDate(value));
}

export function formatShortDate(value: string | Date): string {
  return shortDateFormatter.format(localDate(value));
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function addMonths(monthKey: string, amount: number): string {
  const date = parseMonthKey(monthKey);
  date.setMonth(date.getMonth() + amount);
  return toMonthKey(date);
}

export function daysInMonth(monthKey: string): number {
  const date = parseMonthKey(monthKey);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function enumerateDateKeys(start: string | Date, end: string | Date): string[] {
  const cursor = localDate(start);
  cursor.setHours(12, 0, 0, 0);
  const last = localDate(end);
  last.setHours(12, 0, 0, 0);
  const dates: string[] = [];

  while (cursor <= last) {
    dates.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

export function addDays(dateKey: string, amount: number): string {
  const date = localDate(dateKey);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
}

export function daysBetween(startDate: string, endDate: string): number {
  return enumerateDateKeys(startDate, endDate).length;
}

export function countEntryOvernights(startDateTime: string, endDateTime: string): number {
  const start = localDate(startDateTime.slice(0, 10));
  const end = localDate(endDateTime.slice(0, 10));
  const difference = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return Math.max(0, difference);
}

export function rangeForMonth(monthKey: string): { startDate: string; endDate: string } {
  return {
    startDate: `${monthKey}-01`,
    endDate: `${monthKey}-${String(daysInMonth(monthKey)).padStart(2, "0")}`
  };
}

export function rangeForQuarter(monthKey: string): { startDate: string; endDate: string } {
  const anchor = parseMonthKey(monthKey);
  const quarterStartMonth = Math.floor(anchor.getMonth() / 3) * 3;
  const start = new Date(anchor.getFullYear(), quarterStartMonth, 1, 12);
  const end = new Date(anchor.getFullYear(), quarterStartMonth + 3, 0, 12);
  return { startDate: toDateKey(start), endDate: toDateKey(end) };
}

export function rangeForYear(year: number): { startDate: string; endDate: string } {
  return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
}

export function rangesOverlap(
  firstStart: string,
  firstEnd: string,
  secondStart: string,
  secondEnd: string
): boolean {
  return firstStart <= secondEnd && firstEnd >= secondStart;
}

export function getCalendarDays(monthKey: string): Array<{
  dateKey: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
}> {
  const first = parseMonthKey(monthKey);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - mondayOffset);
  const todayKey = toDateKey(new Date());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const dateKey = toDateKey(date);
    return {
      dateKey,
      day: date.getDate(),
      inMonth: toMonthKey(date) === monthKey,
      isToday: dateKey === todayKey,
      isWeekend: date.getDay() === 0 || date.getDay() === 6
    };
  });
}

export function entryDateKeys(startDateTime: string, endDateTime: string): string[] {
  return enumerateDateKeys(startDateTime.slice(0, 10), endDateTime.slice(0, 10));
}

export function isWeekendDate(dateKey: string): boolean {
  const day = localDate(dateKey).getDay();
  return day === 0 || day === 6;
}

export function weekendKey(dateKey: string): string {
  const date = localDate(dateKey);
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -1 : day === 6 ? 0 : 6 - day));
  return toDateKey(date);
}

export function isWeekdayOvernight(startDateTime: string): boolean {
  const day = new Date(startDateTime).getDay();
  return day >= 1 && day <= 4;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
