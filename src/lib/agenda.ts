import { occupiedDateRangeForTimedRange } from "../../shared/temporal";
import { entryDateKeys } from "./date";

export type AgendaDayPhase = "single" | "start" | "middle" | "end";

export function agendaDateKeys(
  startDateTime: string,
  endDateTime: string,
  visibleStartDate: string,
  visibleEndDate: string
): string[] {
  return entryDateKeys(startDateTime, endDateTime, {
    clipStart: visibleStartDate,
    clipEnd: visibleEndDate,
    maximumDays: 366
  });
}

export function agendaDayPhase(
  startDateTime: string,
  endDateTime: string,
  dateKey: string
): AgendaDayPhase | null {
  const range = occupiedDateRangeForTimedRange(startDateTime, endDateTime);
  if (!range || dateKey < range.startDate || dateKey > range.endDate) return null;
  if (range.startDate === range.endDate) return "single";
  if (dateKey === range.startDate) return "start";
  if (dateKey === range.endDate) return "end";
  return "middle";
}
