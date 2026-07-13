import type Database from "better-sqlite3";
import type { ApiCareConflict, ApiEntryStatus } from "../../shared/api.js";
import {
  CareConflictDetectionLimitError,
  detectCareConflicts,
  type CareConflictEntry
} from "../../shared/careConflicts.js";

export {
  CareConflictDetectionLimitError,
  detectCareConflicts,
  type CareConflictEntry
} from "../../shared/careConflicts.js";

export const MAX_CARE_CONFLICT_ENTRIES = 10_000;
export const MAX_CARE_CONFLICT_CHILD_LINKS = 20_000;
export const MAX_CARE_CONFLICT_RESULTS = 5_000;
const MAX_ACTUAL_CONFLICT_CANDIDATES = 1_000;
const MAX_ACTUAL_CONFLICT_CHILD_LINKS = 4_000;

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

export class CareConflictWorkLimitError extends Error {
  readonly code = "care_conflict_work_limit";

  constructor() {
    super("Care conflict work limit exceeded.");
    this.name = "CareConflictWorkLimitError";
  }
}

function isActualStatus(status: ApiEntryStatus): boolean {
  return status === "completed" || status === "partial";
}

interface CareConflictEntryQuery {
  actualOnly?: boolean;
  childIds?: string[];
  endAfter?: string;
  excludeId?: string;
  maxChildLinks?: number;
  maxEntries?: number;
  startBefore?: string;
}

function positiveLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("Care conflict limits must be positive integers.");
  }
  return value;
}

function loadChildIds(
  database: Database.Database,
  table: "care_entry_children" | "care_entry_actual_children",
  entryIds: string[],
  maxRows: number
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let loadedRows = 0;
  for (let offset = 0; offset < entryIds.length; offset += 400) {
    const chunk = entryIds.slice(offset, offset + 400);
    const placeholders = chunk.map(() => "?").join(", ");
    const remaining = maxRows - loadedRows;
    const rows = database.prepare(`
      SELECT care_entry_id AS entryId, child_id AS childId
      FROM ${table}
      WHERE deleted_at IS NULL AND care_entry_id IN (${placeholders})
      ORDER BY care_entry_id, child_id
      LIMIT ?
    `).all(...chunk, remaining + 1) as Array<{ entryId: string; childId: string }>;
    if (rows.length > remaining) throw new CareConflictWorkLimitError();
    loadedRows += rows.length;
    for (const row of rows) {
      const ids = result.get(row.entryId) ?? [];
      ids.push(row.childId);
      result.set(row.entryId, ids);
    }
  }
  return result;
}

export function listCareConflictEntries(
  database: Database.Database,
  options: CareConflictEntryQuery = {}
): CareConflictEntry[] {
  const maxEntries = positiveLimit(options.maxEntries ?? MAX_CARE_CONFLICT_ENTRIES);
  const maxChildLinks = positiveLimit(options.maxChildLinks ?? MAX_CARE_CONFLICT_CHILD_LINKS);
  const conditions = ["deleted_at IS NULL", "status != 'cancelled'"];
  const values: string[] = [];
  if (options.actualOnly) conditions.push("status IN ('completed', 'partial')");
  if (options.excludeId) {
    conditions.push("id != ?");
    values.push(options.excludeId);
  }
  if (options.startBefore) {
    conditions.push(`julianday(
      CASE WHEN status = 'partial'
        THEN COALESCE(actual_start_datetime, start_datetime)
        ELSE start_datetime
      END
    ) < julianday(?)`);
    values.push(options.startBefore);
  }
  if (options.endAfter) {
    conditions.push(`julianday(
      CASE WHEN status = 'partial'
        THEN COALESCE(actual_end_datetime, end_datetime)
        ELSE end_datetime
      END
    ) > julianday(?)`);
    values.push(options.endAfter);
  }
  const childIds = [...new Set(options.childIds ?? [])];
  if (childIds.length) {
    const placeholders = childIds.map(() => "?").join(", ");
    conditions.push(`(
      (status = 'partial' AND (
        EXISTS (
          SELECT 1 FROM care_entry_actual_children actual_child
          WHERE actual_child.care_entry_id = care_entries.id
            AND actual_child.deleted_at IS NULL
            AND actual_child.child_id IN (${placeholders})
        )
        OR (
          NOT EXISTS (
            SELECT 1 FROM care_entry_actual_children any_actual_child
            WHERE any_actual_child.care_entry_id = care_entries.id
              AND any_actual_child.deleted_at IS NULL
          )
          AND EXISTS (
            SELECT 1 FROM care_entry_children planned_child
            WHERE planned_child.care_entry_id = care_entries.id
              AND planned_child.deleted_at IS NULL
              AND planned_child.child_id IN (${placeholders})
          )
        )
      ))
      OR (status = 'completed' AND EXISTS (
        SELECT 1 FROM care_entry_children completed_child
        WHERE completed_child.care_entry_id = care_entries.id
          AND completed_child.deleted_at IS NULL
          AND completed_child.child_id IN (${placeholders})
      ))
    )`);
    values.push(...childIds, ...childIds, ...childIds);
  }
  const rows = database.prepare(`
    SELECT id, status, start_datetime, end_datetime,
      actual_start_datetime, actual_end_datetime
    FROM care_entries
    WHERE ${conditions.join(" AND ")}
    ORDER BY start_datetime, id
    LIMIT ?
  `).all(...values, maxEntries + 1) as EntryRow[];
  if (rows.length > maxEntries) throw new CareConflictWorkLimitError();
  const entryIds = rows.map((row) => row.id);
  const plannedChildren = loadChildIds(database, "care_entry_children", entryIds, maxChildLinks);
  const actualChildren = loadChildIds(database, "care_entry_actual_children", entryIds, maxChildLinks);
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
  return detectCareConflicts(listCareConflictEntries(database), {
    maxConflicts: MAX_CARE_CONFLICT_RESULTS
  });
}

export function assertNoActualCareConflict(
  candidate: CareConflictEntry,
  database: Database.Database
): void {
  if (!isActualStatus(candidate.status)) return;
  const partial = candidate.status === "partial";
  const startDateTime = partial && candidate.actualStartDateTime
    ? candidate.actualStartDateTime
    : candidate.startDateTime;
  const endDateTime = partial && candidate.actualEndDateTime
    ? candidate.actualEndDateTime
    : candidate.endDateTime;
  const childIds = partial && candidate.actualChildIds?.length
    ? candidate.actualChildIds
    : candidate.childIds;
  try {
    const entries = listCareConflictEntries(database, {
      actualOnly: true,
      childIds,
      endAfter: startDateTime,
      excludeId: candidate.id,
      maxChildLinks: MAX_ACTUAL_CONFLICT_CHILD_LINKS,
      maxEntries: MAX_ACTUAL_CONFLICT_CANDIDATES,
      startBefore: endDateTime
    });
    const conflict = entries.some((entry) =>
      detectCareConflicts([entry, candidate], { maxConflicts: 1 })
        .some((item) => item.severity === "unresolved_actual")
    );
    if (conflict) throw new CareEntryConflictError();
  } catch (error) {
    if (
      error instanceof CareEntryConflictError ||
      error instanceof CareConflictWorkLimitError ||
      error instanceof CareConflictDetectionLimitError
    ) {
      throw new CareEntryConflictError();
    }
    throw error;
  }
}

export function isCareEntryConflictError(error: unknown): error is CareEntryConflictError {
  return error instanceof CareEntryConflictError ||
    (error instanceof Error && (error as { code?: string }).code === "care_entry_conflict");
}

export function isCareConflictWorkLimitError(error: unknown): boolean {
  return error instanceof CareConflictWorkLimitError ||
    error instanceof CareConflictDetectionLimitError;
}
