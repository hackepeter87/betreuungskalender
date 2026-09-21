import assert from "node:assert/strict";
import test from "node:test";
import { expandContactRule } from "../shared/contactRuleExpansion";
import {
  buildEventSegment,
  buildPresetRecurrence,
  effectiveContactRuleEndDate,
  inferRepeatPreset
} from "../src/lib/contactRuleEditor";

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
