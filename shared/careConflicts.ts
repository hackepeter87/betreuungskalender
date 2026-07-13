import type {
  ApiCareConflict,
  ApiCareConflictSeverity,
  ApiEntryStatus
} from "./api.js";

export interface CareConflictEntry {
  id: string;
  status: ApiEntryStatus;
  startDateTime: string;
  endDateTime: string;
  childIds: string[];
  actualStartDateTime?: string;
  actualEndDateTime?: string;
  actualChildIds?: string[];
}

interface NormalizedConflictEntry {
  id: string;
  status: ApiEntryStatus;
  startDateTime: string;
  endDateTime: string;
  childIds: string[];
  actual: boolean;
}

function isActualStatus(status: ApiEntryStatus): boolean {
  return status === "completed" || status === "partial";
}

function normalizeEntry(entry: CareConflictEntry): NormalizedConflictEntry | undefined {
  if (entry.status === "cancelled") return undefined;
  const partial = entry.status === "partial";
  const childIds = partial && entry.actualChildIds?.length
    ? entry.actualChildIds
    : entry.childIds;
  const startDateTime = partial && entry.actualStartDateTime
    ? entry.actualStartDateTime
    : entry.startDateTime;
  const endDateTime = partial && entry.actualEndDateTime
    ? entry.actualEndDateTime
    : entry.endDateTime;
  if (!childIds.length || Date.parse(startDateTime) >= Date.parse(endDateTime)) return undefined;
  return {
    id: entry.id,
    status: entry.status,
    startDateTime,
    endDateTime,
    childIds: [...new Set(childIds)].sort(),
    actual: isActualStatus(entry.status)
  };
}

function conflictSeverity(
  first: NormalizedConflictEntry,
  second: NormalizedConflictEntry
): ApiCareConflictSeverity {
  return first.actual && second.actual ? "unresolved_actual" : "planned_warning";
}

export function detectCareConflicts(entries: CareConflictEntry[]): ApiCareConflict[] {
  const entriesByChild = new Map<string, NormalizedConflictEntry[]>();
  for (const source of entries) {
    const entry = normalizeEntry(source);
    if (!entry) continue;
    for (const childId of entry.childIds) {
      const childEntries = entriesByChild.get(childId) ?? [];
      childEntries.push(entry);
      entriesByChild.set(childId, childEntries);
    }
  }

  const conflicts = new Map<string, ApiCareConflict>();
  for (const [childId, childEntries] of entriesByChild) {
    childEntries.sort((first, second) =>
      first.startDateTime.localeCompare(second.startDateTime) ||
      first.endDateTime.localeCompare(second.endDateTime) ||
      first.id.localeCompare(second.id)
    );
    let active: NormalizedConflictEntry[] = [];
    for (const current of childEntries) {
      active = active.filter((entry) => entry.endDateTime > current.startDateTime);
      for (const other of active) {
        const startDateTime = other.startDateTime > current.startDateTime
          ? other.startDateTime
          : current.startDateTime;
        const endDateTime = other.endDateTime < current.endDateTime
          ? other.endDateTime
          : current.endDateTime;
        if (startDateTime >= endDateTime) continue;
        const entryIds = [other.id, current.id].sort() as [string, string];
        const severity = conflictSeverity(other, current);
        const key = `${entryIds[0]}|${entryIds[1]}|${startDateTime}|${endDateTime}|${severity}`;
        const existing = conflicts.get(key);
        if (existing) {
          if (!existing.childIds.includes(childId)) existing.childIds.push(childId);
          continue;
        }
        conflicts.set(key, {
          id: key,
          entryIds,
          childIds: [childId],
          startDateTime,
          endDateTime,
          severity
        });
      }
      active.push(current);
    }
  }

  return [...conflicts.values()]
    .map((conflict) => ({ ...conflict, childIds: conflict.childIds.sort() }))
    .sort((first, second) =>
      first.startDateTime.localeCompare(second.startDateTime) ||
      first.endDateTime.localeCompare(second.endDateTime) ||
      first.id.localeCompare(second.id)
    );
}
