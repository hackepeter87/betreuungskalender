export class WorkspaceQueryLimitError extends Error {
  readonly code = "workspace_query_limit";

  constructor() {
    super("Workspace query limit exceeded.");
  }
}

export function withinResultLimit<T>(rows: readonly T[], maximum: number): T[] {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || rows.length > maximum) {
    throw new WorkspaceQueryLimitError();
  }
  return rows.slice();
}
