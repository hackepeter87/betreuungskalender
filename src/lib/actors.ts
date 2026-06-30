import type { AppData } from "../types";

export function actorDisplayName(
  data: Pick<AppData, "auditLog">,
  actorId?: string
): string {
  if (!actorId) return "local-dev";

  for (let index = data.auditLog.length - 1; index >= 0; index -= 1) {
    const entry = data.auditLog[index];
    if (entry.userId === actorId && entry.userDisplayName) {
      return entry.userDisplayName;
    }
  }

  return actorId;
}
