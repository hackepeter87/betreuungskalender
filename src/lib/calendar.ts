import type { ExternalCalendarEvent, ExternalCalendarSource } from "../types";
import { getCalendarDays } from "./date";

export function calendarGridRange(monthKey: string): { startDate: string; endDate: string } {
  const days = getCalendarDays(monthKey);
  return {
    startDate: days[0]?.dateKey ?? `${monthKey}-01`,
    endDate: days.at(-1)?.dateKey ?? `${monthKey}-01`
  };
}

export function filterCalendarOverlayEvents(
  events: ExternalCalendarEvent[],
  sources: ExternalCalendarSource[]
): ExternalCalendarEvent[] {
  const holidaySourceIds = new Set(
    sources.filter((source) => source.sourceType === "holiday").map((source) => source.id)
  );
  return events.filter((event) => !holidaySourceIds.has(event.sourceId));
}
