import type {
  ApiContactRuleChangeRequest,
  ApiContactRuleWritable
} from "../../shared/api";
import type { CareEntry, ContactRule } from "../types";
import { contactRuleDayOffset } from "./contactRuleEditor";

export interface RecurringCareScheduleChange {
  startDateTime: string;
  endDateTime: string;
  childIds: string[];
  responsiblePartyId?: string;
}

function datePart(value: string): string {
  return value.slice(0, 10);
}

function timePart(value: string): string {
  return value.slice(11, 16);
}

export function canChooseRecurringCareScope(
  entry: CareEntry,
  rule: ContactRule | undefined
): rule is ContactRule {
  return Boolean(
    rule &&
    entry.status === "planned" &&
    entry.contactRuleId === rule.id &&
    entry.contactRuleSegmentId &&
    entry.contactRuleSyncState !== "manual_override" &&
    !entry.deletedAt
  );
}

export function buildSeriesChangeRequest(
  entry: CareEntry,
  rule: ContactRule,
  change: RecurringCareScheduleChange,
  scope: "following" | "series" = "series"
): ApiContactRuleChangeRequest {
  const occurrenceDate = entry.ruleOccurrenceDate ?? datePart(entry.startDateTime);
  const segmentId = entry.contactRuleSegmentId;
  if (!segmentId || !rule.segments.some((segment) => segment.id === segmentId)) {
    throw new Error("contact_rule_segment_missing");
  }

  const proposedRule: ApiContactRuleWritable = {
    name: rule.name,
    startDate: rule.startDate,
    ...(rule.endDate ? { endDate: rule.endDate } : {}),
    timezone: "Europe/Berlin",
    recurrence: rule.recurrence,
    segments: rule.segments.map((segment) => segment.id === segmentId
      ? {
          ...segment,
          startDayOffset: contactRuleDayOffset(occurrenceDate, datePart(change.startDateTime)),
          startTime: timePart(change.startDateTime),
          endDayOffset: contactRuleDayOffset(occurrenceDate, datePart(change.endDateTime)),
          endTime: timePart(change.endDateTime)
        }
      : segment),
    syncHorizonMonths: rule.syncHorizonMonths,
    ...(change.responsiblePartyId
      ? { responsiblePartyId: change.responsiblePartyId }
      : {}),
    childIds: [...change.childIds],
    active: rule.active
  };

  return {
    selectedEntryId: entry.id,
    scope,
    proposedRule
  };
}
