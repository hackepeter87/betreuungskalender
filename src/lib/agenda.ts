import { entryDateKeys } from "./date";

export type AgendaDayPhase = "single" | "start" | "middle" | "end";

export function agendaDateKeys(
  startDateTime: string,
  endDateTime: string,
  visibleStartDate: string,
  visibleEndDate: string
): string[] {
  return entryDateKeys(startDateTime, endDateTime).filter(
    (dateKey) => dateKey >= visibleStartDate && dateKey <= visibleEndDate
  );
}

export function agendaDayPhase(
  startDateTime: string,
  endDateTime: string,
  dateKey: string
): AgendaDayPhase | null {
  const dateKeys = entryDateKeys(startDateTime, endDateTime);
  const index = dateKeys.indexOf(dateKey);
  if (index < 0) return null;
  if (dateKeys.length === 1) return "single";
  if (index === 0) return "start";
  if (index === dateKeys.length - 1) return "end";
  return "middle";
}
