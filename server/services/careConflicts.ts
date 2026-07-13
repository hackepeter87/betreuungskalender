import type Database from "better-sqlite3";
import type { ApiCareConflict, ApiEntryStatus } from "../../shared/api.js";
import {
  detectCareConflicts,
  type CareConflictEntry
} from "../../shared/careConflicts.js";

export { detectCareConflicts, type CareConflictEntry } from "../../shared/careConflicts.js";

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
