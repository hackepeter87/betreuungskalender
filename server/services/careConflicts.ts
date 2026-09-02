import { createHash } from "node:crypto";
import { sql } from "kysely";
import type { ApiCareConflict, ApiEntryStatus } from "../../shared/api.js";
import type { DatabaseExecutor } from "../db/runtime.js";
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

export class PlannedCareConflictPreviewRequiredError extends Error {
  readonly code = "planned_care_conflict_confirmation_required";
  readonly statusCode = 409;

  constructor(readonly fingerprint: string) {
    super("A current conflict preview must be confirmed before saving.");
    this.name = "PlannedCareConflictPreviewRequiredError";
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

async function loadChildIds(
  database: DatabaseExecutor,
  table: "care_entry_children" | "care_entry_actual_children",
  entryIds: string[],
  maxRows: number
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  let loadedRows = 0;
  for (let offset = 0; offset < entryIds.length; offset += 400) {
    const chunk = entryIds.slice(offset, offset + 400);
    const remaining = maxRows - loadedRows;
    const rows = await database.selectFrom(table)
      .select(["care_entry_id", "child_id"])
      .where("deleted_at", "is", null)
      .where("care_entry_id", "in", chunk)
      .orderBy("care_entry_id")
      .orderBy("child_id")
      .limit(remaining + 1)
      .execute();
    if (rows.length > remaining) throw new CareConflictWorkLimitError();
    loadedRows += rows.length;
    for (const row of rows) {
      const ids = result.get(row.care_entry_id) ?? [];
      ids.push(row.child_id);
      result.set(row.care_entry_id, ids);
    }
  }
  return result;
}

export async function listCareConflictEntries(
  database: DatabaseExecutor,
  options: CareConflictEntryQuery = {}
): Promise<CareConflictEntry[]> {
  const maxEntries = positiveLimit(options.maxEntries ?? MAX_CARE_CONFLICT_ENTRIES);
  const maxChildLinks = positiveLimit(options.maxChildLinks ?? MAX_CARE_CONFLICT_CHILD_LINKS);
  let query = database.selectFrom("care_entries")
    .select(["id", "status", "start_datetime", "end_datetime", "actual_start_datetime", "actual_end_datetime"])
    .where("deleted_at", "is", null)
    .where("status", "!=", "cancelled");
  if (options.actualOnly) query = query.where("status", "in", ["completed", "partial"]);
  if (options.excludeId) {
    query = query.where("id", "!=", options.excludeId);
  }
  if (options.startBefore) {
    query = query.where(sql<boolean>`julianday(
      CASE WHEN status = 'partial'
        THEN COALESCE(actual_start_datetime, start_datetime)
        ELSE start_datetime
      END
    ) < julianday(${options.startBefore})`);
  }
  if (options.endAfter) {
    query = query.where(sql<boolean>`julianday(
      CASE WHEN status = 'partial'
        THEN COALESCE(actual_end_datetime, end_datetime)
        ELSE end_datetime
      END
    ) > julianday(${options.endAfter})`);
  }
  const childIds = [...new Set(options.childIds ?? [])];
  if (childIds.length) {
    query = query.where(({ and, eb, exists, not, or, selectFrom }) => {
      const matchingActual = exists(selectFrom("care_entry_actual_children as actual_child")
        .select("actual_child.care_entry_id")
        .whereRef("actual_child.care_entry_id", "=", "care_entries.id")
        .where("actual_child.deleted_at", "is", null)
        .where("actual_child.child_id", "in", childIds));
      const anyActual = exists(selectFrom("care_entry_actual_children as any_actual_child")
        .select("any_actual_child.care_entry_id")
        .whereRef("any_actual_child.care_entry_id", "=", "care_entries.id")
        .where("any_actual_child.deleted_at", "is", null));
      const matchingPlanned = exists(selectFrom("care_entry_children as planned_child")
        .select("planned_child.care_entry_id")
        .whereRef("planned_child.care_entry_id", "=", "care_entries.id")
        .where("planned_child.deleted_at", "is", null)
        .where("planned_child.child_id", "in", childIds));
      return or([
        and([
          eb("status", "=", "partial"),
          or([matchingActual, and([not(anyActual), matchingPlanned])])
        ]),
        and([eb("status", "!=", "partial"), matchingPlanned])
      ]);
    });
  }
  const rows = await query.orderBy("start_datetime").orderBy("id").limit(maxEntries + 1).execute() as EntryRow[];
  if (rows.length > maxEntries) throw new CareConflictWorkLimitError();
  const entryIds = rows.map((row) => row.id);
  const [plannedChildren, actualChildren] = await Promise.all([
    loadChildIds(database, "care_entry_children", entryIds, maxChildLinks),
    loadChildIds(database, "care_entry_actual_children", entryIds, maxChildLinks)
  ]);
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

export async function listCareConflicts(
  database: DatabaseExecutor
): Promise<ApiCareConflict[]> {
  return detectCareConflicts(await listCareConflictEntries(database), {
    maxConflicts: MAX_CARE_CONFLICT_RESULTS
  });
}

const previewCandidateId = "__care_conflict_candidate__";

export async function previewPlannedCareConflicts(
  candidate: Omit<CareConflictEntry, "id">,
  database: DatabaseExecutor,
  excludeId?: string
): Promise<{ conflicts: ApiCareConflict[]; fingerprint: string }> {
  if (candidate.status !== "planned") {
    return { conflicts: [], fingerprint: createHash("sha256").update("no-planned-conflict").digest("hex") };
  }
  const entries = await listCareConflictEntries(database, {
    childIds: candidate.childIds,
    endAfter: candidate.startDateTime,
    excludeId,
    maxChildLinks: MAX_ACTUAL_CONFLICT_CHILD_LINKS,
    maxEntries: MAX_ACTUAL_CONFLICT_CANDIDATES,
    startBefore: candidate.endDateTime
  });
  const conflicts = detectCareConflicts([
    ...entries,
    { ...candidate, id: previewCandidateId }
  ], { maxConflicts: MAX_ACTUAL_CONFLICT_CANDIDATES })
    .filter((conflict) => conflict.entryIds.includes(previewCandidateId));
  const fingerprint = createHash("sha256").update(JSON.stringify({
    candidate: {
      startDateTime: candidate.startDateTime,
      endDateTime: candidate.endDateTime,
      childIds: [...new Set(candidate.childIds)].sort(),
      status: candidate.status
    },
    conflicts: conflicts.map((conflict) => ({
      entryIds: conflict.entryIds.filter((id) => id !== previewCandidateId),
      childIds: conflict.childIds,
      startDateTime: conflict.startDateTime,
      endDateTime: conflict.endDateTime,
      severity: conflict.severity
    }))
  })).digest("hex");
  return { conflicts, fingerprint };
}

export async function assertPlannedCareConflictAcknowledged(input: {
  candidate: Omit<CareConflictEntry, "id">;
  confirmPlannedConflict: boolean;
  conflictFingerprint?: string;
  database: DatabaseExecutor;
  excludeId?: string;
}): Promise<void> {
  const preview = await previewPlannedCareConflicts(input.candidate, input.database, input.excludeId);
  if (
    preview.conflicts.length &&
    (!input.confirmPlannedConflict || input.conflictFingerprint !== preview.fingerprint)
  ) {
    throw new PlannedCareConflictPreviewRequiredError(preview.fingerprint);
  }
}

export async function careConflictEntryIds(database: DatabaseExecutor): Promise<Set<string> | undefined> {
  try {
    return new Set((await listCareConflicts(database)).flatMap((conflict) => conflict.entryIds));
  } catch (error) {
    if (isCareConflictWorkLimitError(error)) return undefined;
    throw error;
  }
}

export async function assertNoActualCareConflict(
  candidate: CareConflictEntry,
  database: DatabaseExecutor
): Promise<void> {
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
    const entries = await listCareConflictEntries(database, {
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

export function isPlannedCareConflictPreviewRequiredError(
  error: unknown
): error is PlannedCareConflictPreviewRequiredError {
  return error instanceof PlannedCareConflictPreviewRequiredError ||
    (error instanceof Error && (error as { code?: string }).code === "planned_care_conflict_confirmation_required");
}

export function isCareConflictWorkLimitError(error: unknown): boolean {
  return error instanceof CareConflictWorkLimitError ||
    error instanceof CareConflictDetectionLimitError;
}
