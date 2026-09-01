import type { AppData } from "../types";

export type ActorLabels = Readonly<Record<string, string>>;

const MAX_ACTOR_LABELS = 200;

export function actorIdsForData(data: AppData): string[] {
  const ids = new Set<string>();
  const add = (actorId?: string) => {
    if (actorId && ids.size < MAX_ACTOR_LABELS) ids.add(actorId);
  };

  for (const child of data.children) {
    add(child.createdBy);
    add(child.updatedBy);
  }
  for (const party of data.careParties) {
    add(party.createdBy);
    add(party.updatedBy);
  }
  for (const entry of data.entries) {
    add(entry.createdBy);
    add(entry.updatedBy);
    for (const trip of entry.trips) {
      add(trip.createdBy);
      add(trip.updatedBy);
    }
    for (const cost of entry.costs) {
      add(cost.createdBy);
      add(cost.updatedBy);
    }
  }
  for (const period of data.holidayPeriods) {
    add(period.createdBy);
    add(period.updatedBy);
  }
  for (const period of data.unavailablePeriods) {
    add(period.createdBy);
    add(period.updatedBy);
  }
  for (const pattern of data.contactPatterns) {
    add(pattern.createdBy);
    add(pattern.updatedBy);
  }
  for (const rule of data.contactRules) {
    add(rule.createdBy);
    add(rule.updatedBy);
  }
  for (const closure of data.monthClosures) {
    add(closure.closedBy);
    add(closure.updatedBy);
  }

  return [...ids];
}

export function actorDisplayName(
  labels: ActorLabels,
  actorId?: string
): string {
  if (!actorId) return "local-dev";
  return labels[actorId] ?? actorId;
}
