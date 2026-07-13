import type { CareConflict } from "../types";

export function conflictsForEntry(
  conflicts: CareConflict[],
  entryId: string
): CareConflict[] {
  return conflicts.filter((conflict) => conflict.entryIds.includes(entryId));
}

export function conflictSeverityForEntry(
  conflicts: CareConflict[],
  entryId: string
): CareConflict["severity"] | undefined {
  const entryConflicts = conflictsForEntry(conflicts, entryId);
  if (entryConflicts.some((conflict) => conflict.severity === "unresolved_actual")) {
    return "unresolved_actual";
  }
  return entryConflicts.some((conflict) => conflict.severity === "planned_warning")
    ? "planned_warning"
    : undefined;
}
