import type {
  ApiContactRuleSegment,
  ContactRuleRecurrence,
  ContactRuleWeekday
} from "../../shared/api";

export type ContactRuleRepeatPreset = "never" | "weekly" | "biweekly" | "monthly" | "custom";

const weekdays: ContactRuleWeekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function dateAtNoon(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

export function contactRuleWeekday(date: string): ContactRuleWeekday {
  return weekdays[dateAtNoon(date).getUTCDay()] ?? "SU";
}

export function contactRuleDayOffset(startDate: string, endDate: string): number {
  return Math.round((dateAtNoon(endDate).getTime() - dateAtNoon(startDate).getTime()) / 86_400_000);
}

export function buildPresetRecurrence(
  preset: Exclude<ContactRuleRepeatPreset, "custom">,
  startDate: string
): ContactRuleRecurrence {
  const weekday = contactRuleWeekday(startDate);
  switch (preset) {
    case "weekly":
      return { kind: "rrule", rrules: [`FREQ=WEEKLY;INTERVAL=1;BYDAY=${weekday}`] };
    case "biweekly":
      return { kind: "rrule", rrules: [`FREQ=WEEKLY;INTERVAL=2;BYDAY=${weekday}`] };
    case "monthly":
      return {
        kind: "rrule",
        rrules: [`FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=${Number(startDate.slice(8, 10))}`]
      };
    case "never":
      return { kind: "rrule", rrules: ["FREQ=DAILY;INTERVAL=1"] };
  }
}

export function buildEventSegment(input: {
  id?: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}): ApiContactRuleSegment {
  const endDayOffset = contactRuleDayOffset(input.startDate, input.endDate);
  if (
    endDayOffset < 0 ||
    (endDayOffset === 0 && input.endTime <= input.startTime)
  ) {
    throw new RangeError("contact_rule_event_end_must_follow_start");
  }
  return {
    id: input.id ?? "span-1",
    startDayOffset: 0,
    startTime: input.startTime,
    endDayOffset,
    endTime: input.endTime
  };
}

export function inferRepeatPreset(input: {
  startDate: string;
  endDate?: string;
  recurrence: ContactRuleRecurrence;
  segments: ApiContactRuleSegment[];
}): ContactRuleRepeatPreset {
  if (input.segments.length !== 1 || input.segments[0]?.startDayOffset !== 0) return "custom";
  if (input.endDate === input.startDate) return "never";
  if (input.recurrence.kind !== "rrule" || input.recurrence.rrules.length !== 1) return "custom";

  const line = input.recurrence.rrules[0]?.toUpperCase() ?? "";
  const weekday = contactRuleWeekday(input.startDate);
  if (line === `FREQ=WEEKLY;INTERVAL=1;BYDAY=${weekday}`) return "weekly";
  if (line === `FREQ=WEEKLY;INTERVAL=2;BYDAY=${weekday}`) return "biweekly";
  if (line === `FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=${Number(input.startDate.slice(8, 10))}`) return "monthly";
  return "custom";
}

export function effectiveContactRuleEndDate(
  preset: ContactRuleRepeatPreset,
  startDate: string,
  endCondition: "never" | "on-date",
  selectedEndDate: string
): string | undefined {
  if (preset === "never") return startDate;
  return endCondition === "on-date" ? selectedEndDate || undefined : undefined;
}
