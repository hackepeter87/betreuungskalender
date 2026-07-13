import type Database from "better-sqlite3";
import type {
  ApiCareConflict,
  ApiCareConflictSeverity,
  ApiEntryStatus
} from "../../shared/api.js";

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

interface EntryRow {
  id: string;
  status: ApiEntryStatus;
  start_datetime: string;
  end_datetime: string;
  actual_start_datetime: string | null;
  actual_end_datetime: string | null;
}

export class CareEntryConflictError extends Error {
  readonly code = "care_entry_conflict";
  readonly statusCode = 409;

  constructor() {
    super("Der tatsächliche Betreuungszeitraum überschneidet sich mit einem bestehenden Eintrag.");
    this.name = "CareEntryConflictError";
  }
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

export function listCareConflictEntries(
  database: Database.Database
): CareConflictEntry[] {
  const rows = database.prepare(`
    SELECT id, status, start_datetime, end_datetime,
      actual_start_datetime, actual_end_datetime
    FROM care_entries
    WHERE deleted_at IS NULL AND status != 'cancelled'
    ORDER BY start_datetime, id
  `).all() as EntryRow[];
  const plannedChildren = new Map<string, string[]>();
  for (const row of database.prepare(`
    SELECT care_entry_id AS entryId, child_id AS childId
    FROM care_entry_children
    WHERE deleted_at IS NULL
    ORDER BY care_entry_id, child_id
  `).all() as Array<{ entryId: string; childId: string }>) {
    const ids = plannedChildren.get(row.entryId) ?? [];
    ids.push(row.childId);
    plannedChildren.set(row.entryId, ids);
  }
  const actualChildren = new Map<string, string[]>();
  for (const row of database.prepare(`
    SELECT care_entry_id AS entryId, child_id AS childId
    FROM care_entry_actual_children
    WHERE deleted_at IS NULL
    ORDER BY care_entry_id, child_id
  `).all() as Array<{ entryId: string; childId: string }>) {
    const ids = actualChildren.get(row.entryId) ?? [];
    ids.push(row.childId);
    actualChildren.set(row.entryId, ids);
  }
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    startDateTime: row.start_datetime,
    endDateTime: row.end_datetime,
    childIds: plannedChildren.get(row.id) ?? [],
    actualStartDateTime: row.actual_start_datetime ?? undefined,
    actualEndDateTime: row.actual_end_datetime ?? undefined,
    actualChildIds: actualChildren.get(row.id) ?? []
  }));
}

export function listCareConflicts(
  database: Database.Database
): ApiCareConflict[] {
  return detectCareConflicts(listCareConflictEntries(database));
}

export function assertNoActualCareConflict(
  candidate: CareConflictEntry,
  database: Database.Database
): void {
  if (!isActualStatus(candidate.status)) return;
  const entries = listCareConflictEntries(database).filter((entry) => entry.id !== candidate.id);
  const conflict = detectCareConflicts([...entries, candidate]).find(
    (item) => item.severity === "unresolved_actual" && item.entryIds.includes(candidate.id)
  );
  if (conflict) throw new CareEntryConflictError();
}

export function isCareEntryConflictError(error: unknown): error is CareEntryConflictError {
  return error instanceof CareEntryConflictError ||
    (error instanceof Error && (error as { code?: string }).code === "care_entry_conflict");
}
