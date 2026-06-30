import type { AppData, CareEntry, ContactPattern } from "../types";
import { addDays, makeId, nowIso } from "./date";

function differenceInDays(first: string, second: string): number {
  const firstDate = new Date(`${first}T12:00:00`);
  const secondDate = new Date(`${second}T12:00:00`);
  return Math.round((secondDate.getTime() - firstDate.getTime()) / 86_400_000);
}

export function generatePatternEntries(
  data: AppData,
  pattern: ContactPattern,
  startDate: string,
  endDate: string
): CareEntry[] {
  if (!pattern.active || !pattern.childIds.length || !pattern.startDate) return [];

  const existingKeys = new Set(
    data.entries
      .filter((entry) => entry.generatedByPatternId === pattern.id)
      .map((entry) => entry.ruleOccurrenceDate)
      .filter((value): value is string => Boolean(value))
  );

  const offset = differenceInDays(pattern.startDate, startDate);
  const periodsToSkip = offset > 0 ? Math.ceil(offset / 14) : 0;
  let occurrence = addDays(pattern.startDate, periodsToSkip * 14);
  const generated: CareEntry[] = [];
  const timestamp = nowIso();

  while (occurrence <= endDate) {
    const occurrenceEnd = addDays(occurrence, 2);
    if (occurrenceEnd >= startDate && !existingKeys.has(occurrence)) {
      generated.push({
        id: makeId("entry"),
        date: occurrence,
        startDateTime: `${occurrence}T${pattern.fridayStartTime}`,
        endDateTime: `${occurrenceEnd}T${pattern.sundayEndTime}`,
        childIds: pattern.childIds,
        status: "planned",
        additionalCare: false,
        generatedByPatternId: pattern.id,
        ruleOccurrenceDate: occurrence,
        overnight: true,
        schoolHandover: false,
        holiday: false,
        weekend: true,
        location: data.settings.defaultLocation,
        handoverFrom: data.settings.defaultHandoverFrom,
        handoverTo: data.settings.defaultHandoverTo,
        hasEvidence: false,
        trips: [],
        costs: [],
        createdBy: "local-dev",
        updatedBy: "local-dev",
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
    occurrence = addDays(occurrence, 14);
  }

  return generated;
}
