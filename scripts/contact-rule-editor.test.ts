import assert from "node:assert/strict";
import test from "node:test";
import { expandContactRule } from "../shared/contactRuleExpansion";
import {
  buildEventSegment,
  buildPresetRecurrence,
  effectiveContactRuleEndDate,
  inferRepeatPreset
} from "../src/lib/contactRuleEditor";
import {
  buildSeriesChangeRequest,
  canChooseRecurringCareScope
} from "../src/lib/recurringCareChange";
import type { CareEntry, ContactRule } from "../src/types";

const childIds = ["child_demo"];

function expandPreset(
  preset: "never" | "weekly" | "biweekly" | "monthly",
  startDate: string,
  eventEndDate: string,
  ruleEndDate?: string
) {
  return expandContactRule({
    startDate,
    endDate: ruleEndDate,
    recurrence: buildPresetRecurrence(preset, startDate),
    segments: [buildEventSegment({
      startDate,
      startTime: "16:00",
      endDate: eventEndDate,
      endTime: "18:00"
    })],
    active: true,
    childIds,
    rangeStart: "2026-10-01",
    rangeEnd: "2026-12-31"
  });
}

test("builds weekly and biweekly presets from the first event weekday", () => {
  assert.deepEqual(
    expandPreset("weekly", "2026-10-02", "2026-10-04", "2026-10-31")
      .map((entry) => entry.occurrenceDate),
    ["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"]
  );
  assert.deepEqual(
    expandPreset("biweekly", "2026-10-02", "2026-10-04", "2026-10-31")
      .map((entry) => entry.occurrenceDate),
    ["2026-10-02", "2026-10-16", "2026-10-30"]
  );
});

test("builds monthly and non-repeating presets without changing expansion semantics", () => {
  assert.deepEqual(
    expandPreset("monthly", "2026-10-31", "2026-10-31")
      .map((entry) => entry.occurrenceDate),
    ["2026-10-31", "2026-12-31"]
  );
  assert.deepEqual(
    expandPreset("never", "2026-10-02", "2026-10-04", "2026-10-02")
      .map((entry) => entry.occurrenceDate),
    ["2026-10-02"]
  );
});

test("converts same-day and overnight event ranges to existing segment offsets", () => {
  assert.deepEqual(buildEventSegment({
    id: "segment_demo",
    startDate: "2026-10-02",
    startTime: "16:00",
    endDate: "2026-10-02",
    endTime: "18:00"
  }), {
    id: "segment_demo",
    startDayOffset: 0,
    startTime: "16:00",
    endDayOffset: 0,
    endTime: "18:00"
  });
  assert.equal(buildEventSegment({
    startDate: "2026-10-02",
    startTime: "16:00",
    endDate: "2026-10-04",
    endTime: "18:00"
  }).endDayOffset, 2);
});

test("rejects event ranges whose end does not follow their start", () => {
  assert.throws(() => buildEventSegment({
    startDate: "2026-10-02",
    startTime: "16:00",
    endDate: "2026-10-02",
    endTime: "15:00"
  }), /contact_rule_event_end_must_follow_start/);
  assert.throws(() => buildEventSegment({
    startDate: "2026-10-02",
    startTime: "16:00",
    endDate: "2026-10-01",
    endTime: "18:00"
  }), /contact_rule_event_end_must_follow_start/);
});

test("infers only lossless presets and keeps advanced rules custom", () => {
  const segment = buildEventSegment({
    startDate: "2026-10-02",
    startTime: "16:00",
    endDate: "2026-10-04",
    endTime: "18:00"
  });
  assert.equal(inferRepeatPreset({
    startDate: "2026-10-02",
    recurrence: buildPresetRecurrence("biweekly", "2026-10-02"),
    segments: [segment]
  }), "biweekly");
  assert.equal(inferRepeatPreset({
    startDate: "2026-10-02",
    recurrence: { kind: "rrule", rrules: ["FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR"] },
    segments: [segment]
  }), "custom");
});

test("applies explicit and implicit series end conditions", () => {
  assert.equal(effectiveContactRuleEndDate("never", "2026-10-02", "never", ""), "2026-10-02");
  assert.equal(effectiveContactRuleEndDate("weekly", "2026-10-02", "never", ""), undefined);
  assert.equal(effectiveContactRuleEndDate("weekly", "2026-10-02", "on-date", "2026-12-31"), "2026-12-31");
});

const recurringRule: ContactRule = {
  id: "rule-1",
  name: "Fiktive Wochenserie",
  startDate: "2026-01-02",
  timezone: "Europe/Berlin",
  recurrence: { kind: "rrule", rrules: ["FREQ=WEEKLY;INTERVAL=1;BYDAY=FR"] },
  segments: [{
    id: "segment-1",
    startDayOffset: 0,
    startTime: "16:00",
    endDayOffset: 2,
    endTime: "18:00"
  }],
  syncHorizonMonths: 12,
  responsiblePartyId: "party-1",
  childIds: ["child-1"],
  active: true,
  createdBy: "test",
  updatedBy: "test",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

const recurringEntry: CareEntry = {
  id: "entry-1",
  date: "2026-07-03",
  startDateTime: "2026-07-03T16:00",
  endDateTime: "2026-07-05T18:00",
  childIds: ["child-1"],
  status: "planned",
  additionalCare: false,
  generatedByPatternId: "rule-1",
  ruleOccurrenceDate: "2026-07-03",
  contactRuleId: "rule-1",
  contactRuleSegmentId: "segment-1",
  contactRuleOccurrenceKey: "2026-07-03:segment-1",
  responsiblePartyId: "party-1",
  contactRuleSyncState: "generated",
  overnight: true,
  schoolHandover: false,
  holiday: false,
  weekend: true,
  location: "other",
  handoverFrom: "father",
  handoverTo: "mother",
  hasEvidence: false,
  trips: [],
  costs: [],
  createdBy: "test",
  updatedBy: "test",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

test("offers a scope choice only for unresolved generated occurrences", () => {
  assert.equal(canChooseRecurringCareScope(recurringEntry, recurringRule), true);
  assert.equal(canChooseRecurringCareScope({ ...recurringEntry, status: "completed" }, recurringRule), false);
  assert.equal(canChooseRecurringCareScope({ ...recurringEntry, contactRuleSyncState: "manual_override" }, recurringRule), false);
  assert.equal(canChooseRecurringCareScope(recurringEntry, undefined), false);
});

test("maps the edited occurrence range to the matching series segment", () => {
  const request = buildSeriesChangeRequest(recurringEntry, recurringRule, {
    startDateTime: "2026-07-04T15:30",
    endDateTime: "2026-07-06T08:00",
    childIds: ["child-1", "child-2"],
    responsiblePartyId: "party-2"
  });

  assert.equal(request.scope, "series");
  if (request.scope !== "series") assert.fail("expected a series request");
  assert.deepEqual(request.proposedRule.segments, [{
    id: "segment-1",
    startDayOffset: 1,
    startTime: "15:30",
    endDayOffset: 3,
    endTime: "08:00"
  }]);
  assert.deepEqual(request.proposedRule.childIds, ["child-1", "child-2"]);
  assert.equal(request.proposedRule.responsiblePartyId, "party-2");
  assert.deepEqual(request.proposedRule.recurrence, recurringRule.recurrence);
});

test("uses the selected recurring-care rule scope without changing the proposal", () => {
  const following = buildSeriesChangeRequest(recurringEntry, recurringRule, {
    startDateTime: recurringEntry.startDateTime,
    endDateTime: recurringEntry.endDateTime,
    childIds: recurringEntry.childIds
  }, "following");
  const series = buildSeriesChangeRequest(recurringEntry, recurringRule, {
    startDateTime: recurringEntry.startDateTime,
    endDateTime: recurringEntry.endDateTime,
    childIds: recurringEntry.childIds
  });

  assert.equal(following.scope, "following");
  assert.equal(series.scope, "series");
  if (following.scope !== "following" || series.scope !== "series") {
    assert.fail("expected rule-level change requests");
  }
  assert.deepEqual(following.proposedRule, series.proposedRule);
});

test("rejects series edits when the originating segment is unavailable", () => {
  assert.throws(
    () => buildSeriesChangeRequest({ ...recurringEntry, contactRuleSegmentId: "missing" }, recurringRule, {
      startDateTime: recurringEntry.startDateTime,
      endDateTime: recurringEntry.endDateTime,
      childIds: recurringEntry.childIds
    }),
    /contact_rule_segment_missing/
  );
});
