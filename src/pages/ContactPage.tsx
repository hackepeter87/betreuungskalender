import { useMemo, useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { FieldHelpButton, FieldHelpLabel } from "../components/FieldHelp";
import { Modal } from "../components/Modal";
import {
  calculateContactStats,
  entriesForRange,
  unavailableForEntry
} from "../lib/analytics";
import { actorDisplayName } from "../lib/actors";
import { expandContactRule } from "../lib/contactRules";
import {
  addDays,
  enumerateDateKeys,
  formatDate,
  formatDateTime,
  formatShortDate,
  formatTime,
  localDate,
  rangeForYear,
  toDateKey
} from "../lib/date";
import { statusLabels } from "../lib/labels";
import { useI18n } from "../i18n/I18nProvider";
import { copy, copyList } from "../i18n/catalog";
import { useAppStore } from "../store/AppStore";
import type { CareEntry } from "../types";
import type {
  ApiContactRuleSegment,
  ContactRuleMonthlyOrdinal,
  ContactRuleRecurrence,
  ContactRuleWeekday
} from "../../shared/api";

function nextFriday(): string {
  const date = new Date();
  const distance = (5 - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + distance);
  return toDateKey(date);
}

type RecurrenceFrequency = "daily" | "weekly" | "monthly";
type MonthlyMode = "month-day" | "nth-weekday";

const weekdays: ContactRuleWeekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const monthlyOrdinals: ContactRuleMonthlyOrdinal[] = [1, 2, 3, 4, 5, -1];

function parseRRuleParts(line: string): Record<string, string> {
  const normalized = line.trim().toUpperCase().startsWith("RRULE:")
    ? line.trim().slice("RRULE:".length)
    : line.trim();
  return Object.fromEntries(
    normalized
      .split(";")
      .map((part) => part.split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [String(key).toUpperCase(), String(value)])
  );
}

function weekdaysFromRRule(value = ""): ContactRuleWeekday[] {
  return value
    .split(",")
    .map((item) => item.replace(/^-?\d+/, "") as ContactRuleWeekday)
    .filter((item): item is ContactRuleWeekday => weekdays.includes(item));
}

function recurrenceBuilderFromRule(rule?: { recurrence: ContactRuleRecurrence }): {
  frequency: RecurrenceFrequency;
  interval: number;
  selectedWeekdays: ContactRuleWeekday[];
  monthlyMode: MonthlyMode;
  selectedOrdinals: ContactRuleMonthlyOrdinal[];
  monthDay: number;
} {
  if (!rule) {
    return {
      frequency: "weekly" as RecurrenceFrequency,
      interval: 2,
      selectedWeekdays: ["FR"] as ContactRuleWeekday[],
      monthlyMode: "nth-weekday" as MonthlyMode,
      selectedOrdinals: [1, 3] as ContactRuleMonthlyOrdinal[],
      monthDay: 15
    };
  }
  if (rule.recurrence.kind === "weekly") {
    return {
      frequency: "weekly" as RecurrenceFrequency,
      interval: rule.recurrence.intervalWeeks,
      selectedWeekdays: rule.recurrence.weekdays,
      monthlyMode: "nth-weekday" as MonthlyMode,
      selectedOrdinals: [1, 3] as ContactRuleMonthlyOrdinal[],
      monthDay: 15
    };
  }
  if (rule.recurrence.kind === "monthlyByWeekday") {
    return {
      frequency: "monthly" as RecurrenceFrequency,
      interval: rule.recurrence.intervalMonths,
      selectedWeekdays: rule.recurrence.weekdays,
      monthlyMode: "nth-weekday" as MonthlyMode,
      selectedOrdinals: rule.recurrence.ordinals,
      monthDay: 15
    };
  }
  const parts = parseRRuleParts(rule.recurrence.rrules[0] ?? "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR");
  const frequency = parts.FREQ === "DAILY"
    ? "daily"
    : parts.FREQ === "MONTHLY"
      ? "monthly"
      : "weekly";
  const byMonthDay = Number((parts.BYMONTHDAY ?? "").split(",")[0]);
  return {
    frequency: frequency as RecurrenceFrequency,
    interval: Math.max(1, Number(parts.INTERVAL ?? 1) || 1),
    selectedWeekdays: weekdaysFromRRule(parts.BYDAY).length ? weekdaysFromRRule(parts.BYDAY) : ["FR"],
    monthlyMode: parts.BYMONTHDAY ? "month-day" as MonthlyMode : "nth-weekday" as MonthlyMode,
    selectedOrdinals: (parts.BYSETPOS ?? "1")
      .split(",")
      .map(Number)
      .filter((value): value is ContactRuleMonthlyOrdinal => monthlyOrdinals.includes(value as ContactRuleMonthlyOrdinal)),
    monthDay: byMonthDay >= 1 && byMonthDay <= 31 ? byMonthDay : 15
  };
}

function ordinalLabel(locale: Parameters<typeof copy>[0], value: ContactRuleMonthlyOrdinal): string {
  if (value === -1) return copy(locale, "contact", "ordinal_last");
  return copy(locale, "contact", `ordinal_${value}`);
}

function buildRRuleLine(input: {
  frequency: RecurrenceFrequency;
  interval: number;
  selectedWeekdays: ContactRuleWeekday[];
  monthlyMode: MonthlyMode;
  selectedOrdinals: ContactRuleMonthlyOrdinal[];
  monthDay: number;
}): string {
  const interval = Math.max(1, Math.min(366, Number(input.interval) || 1));
  if (input.frequency === "daily") return `FREQ=DAILY;INTERVAL=${interval}`;
  if (input.frequency === "weekly") {
    return `FREQ=WEEKLY;INTERVAL=${interval};BYDAY=${input.selectedWeekdays.join(",")}`;
  }
  if (input.monthlyMode === "month-day") {
    return `FREQ=MONTHLY;INTERVAL=${interval};BYMONTHDAY=${Math.max(1, Math.min(31, Number(input.monthDay) || 1))}`;
  }
  return `FREQ=MONTHLY;INTERVAL=${interval};BYDAY=${input.selectedWeekdays.join(",")};BYSETPOS=${input.selectedOrdinals.join(",")}`;
}

function weekDatesFor(dateKey: string): string[] {
  const start = localDate(dateKey);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  const monday = toDateKey(start);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

type ContactPreviewItem = {
  id: string;
  kind: "new" | "existing";
  startDate: string;
  endDate: string;
  dateKeys: string[];
  weekDateKeys: string[];
};

function previewItemFromEntry(
  entry: CareEntry,
  kind: ContactPreviewItem["kind"]
): ContactPreviewItem {
  const startDate = entry.startDateTime.slice(0, 10);
  const endDate = entry.endDateTime.slice(0, 10);
  return {
    id: `${kind}-${entry.ruleOccurrenceDate ?? entry.id}`,
    kind,
    startDate,
    endDate,
    dateKeys: enumerateDateKeys(startDate, endDate),
    weekDateKeys: weekDatesFor(startDate)
  };
}

function previewItemFromRuleEntry(
  entry: {
    occurrenceDate: string;
    occurrenceKey: string;
    startDateTime: string;
    endDateTime: string;
  },
  kind: ContactPreviewItem["kind"]
): ContactPreviewItem {
  const startDate = entry.startDateTime.slice(0, 10);
  const endDate = entry.endDateTime.slice(0, 10);
  return {
    id: `${kind}-${entry.occurrenceKey}`,
    kind,
    startDate,
    endDate,
    dateKeys: enumerateDateKeys(startDate, endDate),
    weekDateKeys: weekDatesFor(startDate)
  };
}

export function ContactPage({
  focusedRuleId,
  onEditEntry,
  onNewEntry
}: {
  focusedRuleId?: string;
  onEditEntry: (entry: CareEntry) => void;
  onNewEntry: () => void;
}) {
  const {
    data,
    saveContactRule,
    updateEntryStatus,
    canWrite,
    isSaving
  } = useAppStore();
  const { locale, intlLocale } = useI18n();
  const existingRule =
    data.contactRules.find((rule) => rule.id === focusedRuleId) ?? data.contactRules[0];
  const currentYear = new Date().getFullYear();
  const defaultRange = rangeForYear(currentYear);
  const existingBuilder = recurrenceBuilderFromRule(existingRule);
  const existingSegment = existingRule?.segments[0];
  const [ruleId, setRuleId] = useState(existingRule?.id);
  const [name, setName] = useState(existingRule?.name ?? copy(locale, "contact", "defaultName"));
  const [startDate, setStartDate] = useState(existingRule?.startDate ?? nextFriday());
  const [endDate, setEndDate] = useState(existingRule?.endDate ?? "");
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(existingBuilder.frequency);
  const [interval, setInterval] = useState(existingBuilder.interval);
  const [monthlyMode, setMonthlyMode] = useState<MonthlyMode>(existingBuilder.monthlyMode);
  const [selectedOrdinals, setSelectedOrdinals] = useState<ContactRuleMonthlyOrdinal[]>(
    existingBuilder.selectedOrdinals.length ? existingBuilder.selectedOrdinals : [1]
  );
  const [monthDay, setMonthDay] = useState(existingBuilder.monthDay);
  const [selectedWeekdays, setSelectedWeekdays] = useState<ContactRuleWeekday[]>(
    existingBuilder.selectedWeekdays.length ? existingBuilder.selectedWeekdays : (["FR"] as ContactRuleWeekday[])
  );
  const [segments, setSegments] = useState<ApiContactRuleSegment[]>(
    existingRule?.segments.length
      ? existingRule.segments
      : [
          {
            id: existingSegment?.id ?? "span-1",
            startDayOffset: existingSegment?.startDayOffset ?? 0,
            startTime: existingSegment?.startTime ?? "16:00",
            endDayOffset: existingSegment?.endDayOffset ?? 2,
            endTime: existingSegment?.endTime ?? "18:00"
          }
        ]
  );
  const [childIds, setChildIds] = useState<string[]>(
    existingRule?.childIds ?? data.children.map((child) => child.id)
  );
  const [responsiblePartyId, setResponsiblePartyId] = useState(
    existingRule?.responsiblePartyId ??
      data.settings.defaultResponsiblePartyId ??
      data.careParties[0]?.id ??
      ""
  );
  const [active, setActive] = useState(existingRule?.active ?? true);
  const [generationStart, setGenerationStart] = useState(defaultRange.startDate);
  const [generationEnd, setGenerationEnd] = useState(defaultRange.endDate);
  const [message, setMessage] = useState("");
  const [cancelEntry, setCancelEntry] = useState<CareEntry | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const recurrence = useMemo<ContactRuleRecurrence>(() => {
    return {
      kind: "rrule",
      rrules: [
        buildRRuleLine({
          frequency,
          interval,
          selectedWeekdays,
          monthlyMode,
          selectedOrdinals,
          monthDay
        })
      ]
    };
  }, [frequency, interval, monthDay, monthlyMode, selectedOrdinals, selectedWeekdays]);
  const previewEntries = useMemo(
    () =>
      expandContactRule({
        startDate,
        endDate: endDate || undefined,
        recurrence,
        segments,
        active,
        childIds,
        rangeStart: generationStart,
        rangeEnd: generationEnd
      }).filter((entry) =>
        ruleId
          ? !data.entries.some((existing) =>
              existing.contactRuleId === ruleId &&
              existing.contactRuleOccurrenceKey === entry.occurrenceKey &&
              !existing.deletedAt
            )
          : true
      ),
    [active, childIds, data.entries, endDate, generationEnd, generationStart, recurrence, ruleId, segments, startDate]
  );
  const existingPreviewEntries = useMemo(
    () =>
      ruleId
        ? entriesForRange(data.entries, generationStart, generationEnd)
            .filter((entry) => entry.contactRuleId === ruleId || entry.generatedByPatternId === ruleId)
            .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime))
        : [],
    [data.entries, generationEnd, generationStart, ruleId]
  );
  const previewCalendarItems = useMemo(
    () =>
      [
        ...previewEntries.map((entry) => previewItemFromRuleEntry(entry, "new")),
        ...existingPreviewEntries.map((entry) =>
          previewItemFromEntry(entry, "existing")
        )
      ].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [existingPreviewEntries, previewEntries]
  );
  const visiblePreviewItems = previewCalendarItems.slice(0, 6);
  const hiddenPreviewItems = previewCalendarItems.length - visiblePreviewItems.length;
  const weekdayLabels = copyList(locale, "calendar", "weekdays");
  const updateSegment = (id: string, next: Partial<ApiContactRuleSegment>) => {
    setSegments((current) =>
      current.map((segment) =>
        segment.id === id
          ? { ...segment, ...next }
          : segment
      )
    );
  };
  const addSegment = () => {
    setSegments((current) => [
      ...current,
      {
        id: `span-${current.length + 1}`,
        startDayOffset: 0,
        startTime: "15:00",
        endDayOffset: 0,
        endTime: "18:00"
      }
    ]);
  };
  const removeSegment = (id: string) => {
    setSegments((current) => current.length > 1 ? current.filter((segment) => segment.id !== id) : current);
  };

  const stats = useMemo(
    () =>
      calculateContactStats(
        data.entries,
        data.unavailablePeriods,
        generationStart,
        generationEnd
      ),
    [data.entries, data.unavailablePeriods, generationEnd, generationStart]
  );
  const relevantEntries = useMemo(
    () =>
      entriesForRange(data.entries, generationStart, generationEnd)
        .filter((entry) => entry.contactRuleId || entry.generatedByPatternId || entry.additionalCare)
        .slice()
        .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime)),
    [data.entries, generationEnd, generationStart]
  );

  const saveRule = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!childIds.length) {
      setMessage(copy(locale, "contact", "childRequired"));
      return;
    }
    if ((frequency === "weekly" || (frequency === "monthly" && monthlyMode === "nth-weekday")) && !selectedWeekdays.length) {
      setMessage(copy(locale, "contact", "weekdayRequired"));
      return;
    }
    if (frequency === "monthly" && monthlyMode === "nth-weekday" && !selectedOrdinals.length) {
      setMessage(copy(locale, "contact", "ordinalRequired"));
      return;
    }
    const saved = await saveContactRule({
      id: ruleId,
      name: name.trim() || copy(locale, "contact", "defaultName"),
      startDate,
      endDate: endDate || undefined,
      timezone: "Europe/Berlin",
      recurrence,
      segments,
      syncHorizonMonths: 12,
      responsiblePartyId: responsiblePartyId || undefined,
      childIds,
      active
    });
    if (saved) {
      setRuleId(saved.id);
      const created = saved.syncSummary?.created ?? 0;
      const updated = saved.syncSummary?.updated ?? 0;
      setMessage(
        created || updated
          ? copy(locale, "contact", "savedWithSync", {
              count: created + updated,
              to: formatDate(saved.syncSummary?.endDate ?? startDate, intlLocale)
            })
          : copy(locale, "contact", "saved")
      );
    }
  };

  const confirmCancellation = async (event: FormEvent) => {
    event.preventDefault();
    if (!cancelEntry || !cancelReason.trim()) return;
    if (await updateEntryStatus(cancelEntry.id, "cancelled", cancelReason)) {
      setCancelEntry(null);
      setCancelReason("");
    }
  };

  return (
    <div className="page" data-testid="page-contact">
      <div className="page-header">
        <div>
          <p className="page-header__context">{copy(locale, "contact", "context")}</p>
          <h1>{copy(locale, "contact", "title")}</h1>
        </div>
        <button className="button button--secondary no-print" type="button" onClick={onNewEntry} disabled={!canWrite || isSaving}>
          <Icon name="plus" size={17} />
          {copy(locale, "contact", "addAdditional")}
        </button>
      </div>

      {data.children.length === 0 ? (
        <section className="notice notice--warning">
          <Icon name="alert" />
          <p>{copy(locale, "contact", "childrenNeeded")}</p>
        </section>
      ) : null}

      <div className="two-column-layout">
        <form className="panel rule-form" onSubmit={saveRule}>
          <div className="panel__header">
            <div>
              <h2>{copy(locale, "contact", "ruleTitle")}</h2>
              <p>{copy(locale, "contact", "ruleDescription")}</p>
            </div>
          </div>
          <div className="panel-form">
            <label className="field">
              <FieldHelpLabel fieldId="contactPattern.name">{copy(locale, "contact", "name")}</FieldHelpLabel>
              <input data-testid="contact-pattern-name" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <fieldset className="inline-fieldset recurrence-builder">
              <legend className="field-label-row">
                <span>{copy(locale, "contact", "recurrence")}</span>
              </legend>
              <label className="field">
                <FieldHelpLabel fieldId="contactPattern.startDate">
                  {copy(locale, "contact", "startDate")}
                </FieldHelpLabel>
                <input data-testid="contact-pattern-start-date" type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </label>
              <label className="field">
                <FieldHelpLabel fieldId="contactPattern.generationRange">{copy(locale, "contact", "endDate")}</FieldHelpLabel>
                <input data-testid="contact-pattern-end-date" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </label>
              <label className="field">
                <FieldHelpLabel fieldId="contactPattern.frequency">{copy(locale, "contact", "frequency")}</FieldHelpLabel>
                <select data-testid="contact-recurrence-frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as RecurrenceFrequency)}>
                  <option value="daily">{copy(locale, "contact", "frequency_daily")}</option>
                  <option value="weekly">{copy(locale, "contact", "frequency_weekly")}</option>
                  <option value="monthly">{copy(locale, "contact", "frequency_monthly")}</option>
                </select>
              </label>
              <label className="field">
                <FieldHelpLabel fieldId="contactPattern.interval">
                  {copy(locale, "contact", "interval")}
                </FieldHelpLabel>
                <input data-testid="contact-recurrence-interval" type="number" min="1" max="366" required value={interval} onChange={(event) => setInterval(Number(event.target.value))} />
              </label>
            </fieldset>
            {frequency === "weekly" || (frequency === "monthly" && monthlyMode === "nth-weekday") ? (
              <fieldset className="inline-fieldset">
                <legend className="field-label-row">
                  <span>{copy(locale, "contact", "weekdays")}</span>
                  <FieldHelpButton fieldId="contactPattern.weekdays" />
                </legend>
                <div className="weekday-choice-row">
                  {weekdays.map((weekday) => {
                    const checked = selectedWeekdays.includes(weekday);
                    return (
                      <label className={`weekday-choice ${checked ? "weekday-choice--selected" : ""}`} data-testid={`contact-weekday-${weekday}`} key={weekday}>
                        <input
                          checked={checked}
                          onChange={() =>
                            setSelectedWeekdays((current) =>
                              checked
                                ? current.filter((item) => item !== weekday)
                                : [...current, weekday]
                            )
                          }
                          type="checkbox"
                        />
                        {copy(locale, "contact", `weekday_${weekday}`)}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}
            {frequency === "monthly" ? (
              <fieldset className="inline-fieldset recurrence-builder">
                <legend className="field-label-row">
                  <span>{copy(locale, "contact", "monthlyPattern")}</span>
                  <FieldHelpButton fieldId="contactPattern.monthlyPattern" />
                </legend>
                <label className="field">
                  <FieldHelpLabel fieldId="contactPattern.monthlyPattern">
                    {copy(locale, "contact", "monthlyMode")}
                  </FieldHelpLabel>
                  <select data-testid="contact-monthly-mode" value={monthlyMode} onChange={(event) => setMonthlyMode(event.target.value as MonthlyMode)}>
                    <option value="nth-weekday">{copy(locale, "contact", "monthlyMode_nth_weekday")}</option>
                    <option value="month-day">{copy(locale, "contact", "monthlyMode_month_day")}</option>
                  </select>
                </label>
                {monthlyMode === "month-day" ? (
                  <label className="field">
                    <FieldHelpLabel fieldId="contactPattern.monthlyPattern">
                      {copy(locale, "contact", "monthDay")}
                    </FieldHelpLabel>
                    <input data-testid="contact-month-day" type="number" min="1" max="31" value={monthDay} onChange={(event) => setMonthDay(Number(event.target.value))} />
                  </label>
                ) : (
                  <div className="field recurrence-builder__wide">
                    <span className="field-label-row">
                      <span>{copy(locale, "contact", "monthOrdinal")}</span>
                      <FieldHelpButton fieldId="contactPattern.monthlyPattern" />
                    </span>
                    <div className="weekday-choice-row weekday-choice-row--ordinals">
                      {monthlyOrdinals.map((ordinal) => {
                        const checked = selectedOrdinals.includes(ordinal);
                        return (
                          <label className={`weekday-choice ${checked ? "weekday-choice--selected" : ""}`} data-testid={`contact-monthly-ordinal-${ordinal}`} key={ordinal}>
                            <input
                              checked={checked}
                              onChange={() =>
                                setSelectedOrdinals((current) =>
                                  checked
                                    ? current.filter((item) => item !== ordinal)
                                    : [...current, ordinal]
                                )
                              }
                              type="checkbox"
                            />
                            {ordinalLabel(locale, ordinal)}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </fieldset>
            ) : null}
            <fieldset className="inline-fieldset">
              <legend className="field-label-row">
                <span>{copy(locale, "contact", "timeSpans")}</span>
              </legend>
              <div className="rule-segment-list">
                {segments.map((segment, index) => (
                  <div className="rule-segment-row" key={segment.id}>
                    <strong>{copy(locale, "contact", "timeSpan", { index: index + 1 })}</strong>
                    <label className="field">
                      <FieldHelpLabel fieldId="contactPattern.dayOffset">
                        {copy(locale, "contact", "startDayOffset")}
                      </FieldHelpLabel>
                      <input type="number" min="0" max="30" value={segment.startDayOffset} onChange={(event) => updateSegment(segment.id, { startDayOffset: Number(event.target.value) })} />
                    </label>
                    <label className="field">
                      <FieldHelpLabel fieldId="contactPattern.fridayStartTime">{copy(locale, "contact", "startTime")}</FieldHelpLabel>
                      <input data-testid={index === 0 ? "contact-pattern-friday-start-time" : undefined} type="time" required value={segment.startTime} onChange={(event) => updateSegment(segment.id, { startTime: event.target.value })} />
                    </label>
                    <label className="field">
                      <FieldHelpLabel fieldId="contactPattern.dayOffset">
                        {copy(locale, "contact", "endDayOffset")}
                      </FieldHelpLabel>
                      <input type="number" min="0" max="30" value={segment.endDayOffset} onChange={(event) => updateSegment(segment.id, { endDayOffset: Number(event.target.value) })} />
                    </label>
                    <label className="field">
                      <FieldHelpLabel fieldId="contactPattern.sundayEndTime">{copy(locale, "contact", "endTime")}</FieldHelpLabel>
                      <input data-testid={index === 0 ? "contact-pattern-sunday-end-time" : undefined} type="time" required value={segment.endTime} onChange={(event) => updateSegment(segment.id, { endTime: event.target.value })} />
                    </label>
                    <button className="icon-button icon-button--bordered icon-button--danger" type="button" onClick={() => removeSegment(segment.id)} disabled={segments.length === 1} aria-label={copy(locale, "contact", "removeTimeSpan")}>
                      <Icon name="trash" size={17} />
                    </button>
                  </div>
                ))}
              </div>
              <button className="button button--secondary" type="button" onClick={addSegment} disabled={segments.length >= 8}>
                <Icon name="plus" size={17} />
                {copy(locale, "contact", "addTimeSpan")}
              </button>
            </fieldset>
            <fieldset className="inline-fieldset">
              <legend className="field-label-row">
                <span>{copy(locale, "contact", "children")}</span>
                <FieldHelpButton fieldId="contactPattern.children" />
              </legend>
              <div className="child-choice-grid">
                {data.children.map((child) => {
                  const checked = childIds.includes(child.id);
                  return (
                    <label className={`choice-card ${checked ? "choice-card--selected" : ""}`} key={child.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setChildIds((current) =>
                            checked
                              ? current.filter((id) => id !== child.id)
                              : [...current, child.id]
                          )
                        }
                      />
                      <span className="child-dot" style={{ backgroundColor: child.color }} />
                      {child.name}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {data.careParties.length ? (
              <label className="field">
                <FieldHelpLabel fieldId="contactPattern.responsibleParty">
                  {copy(locale, "contact", "responsibleParty")}
                </FieldHelpLabel>
                <select
                  data-testid="contact-responsible-party"
                  value={responsiblePartyId}
                  onChange={(event) => setResponsiblePartyId(event.target.value)}
                >
                  <option value="">{copy(locale, "contact", "responsiblePartyNone")}</option>
                  {data.careParties.map((party) => (
                    <option key={party.id} value={party.id}>
                      {party.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="toggle">
              <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
              <span />
              <FieldHelpLabel fieldId="contactPattern.active" />
            </label>
            <button className="button button--primary" type="submit" data-testid="contact-pattern-save" disabled={!data.children.length || !canWrite || isSaving}>
              <Icon name="check" size={17} />
              {copy(locale, "contact", "save")}
            </button>
          </div>
        </form>

        <section className="panel generator-panel">
          <div className="panel__header">
            <div>
              <h2>{copy(locale, "contact", "generateTitle")}</h2>
              <p>{copy(locale, "contact", "generateDescription")}</p>
            </div>
          </div>
          <div className="panel-form">
            <div className="notice notice--info contact-flow-note">
              <Icon name="repeat" />
              <div>
                <strong>{copy(locale, "contact", "flowTitle")}</strong>
                <p>{copy(locale, "contact", "flowDescription")}</p>
              </div>
            </div>
            <div className="form-grid form-grid--two">
              <label className="field">
                <FieldHelpLabel fieldId="contactPattern.generationRange">{copy(locale, "common", "from")}</FieldHelpLabel>
                <input data-testid="contact-generation-start" type="date" value={generationStart} onChange={(event) => setGenerationStart(event.target.value)} />
              </label>
              <label className="field">
                <FieldHelpLabel fieldId="contactPattern.generationRange">{copy(locale, "common", "to")}</FieldHelpLabel>
                <input data-testid="contact-generation-end" type="date" value={generationEnd} onChange={(event) => setGenerationEnd(event.target.value)} />
              </label>
            </div>
            <div className="contact-generation-preview" data-testid="contact-generation-preview">
              <div className="contact-generation-preview__summary">
                <strong>{copy(locale, "contact", "previewTitle")}</strong>
                <span>
                  {previewEntries.length
                    ? copy(locale, "contact", "previewCount", { count: previewEntries.length })
                    : copy(locale, "contact", "previewEmpty")}
                </span>
              </div>
              <div className="contact-preview-calendar" data-testid="contact-preview-calendar">
                {visiblePreviewItems.map((item) => (
                  <article
                    className={`contact-preview-occurrence contact-preview-occurrence--${item.kind}`}
                    data-testid={`contact-preview-${item.kind}-occurrence`}
                    key={item.id}
                  >
                    <div className="contact-preview-occurrence__meta">
                      <strong>
                        {formatShortDate(item.startDate, intlLocale)} {copy(locale, "contact", "through")} {formatShortDate(item.endDate, intlLocale)}
                      </strong>
                      <span>
                        {item.kind === "new"
                          ? copy(locale, "contact", "previewNew")
                          : copy(locale, "contact", "previewExisting")}
                      </span>
                    </div>
                    <div className="contact-preview-week" aria-label={`${item.startDate} ${copy(locale, "contact", "through")} ${item.endDate}`}>
                      {item.weekDateKeys.map((dateKey, index) => {
                        const activeDay = item.dateKeys.includes(dateKey);
                        return (
                          <span
                            className={[
                              "contact-preview-day",
                              activeDay ? "contact-preview-day--active" : ""
                            ].filter(Boolean).join(" ")}
                            data-testid={`contact-preview-day-${dateKey}`}
                            key={dateKey}
                          >
                            <small>{weekdayLabels[index]}</small>
                            <strong>{Number(dateKey.slice(8, 10))}</strong>
                          </span>
                        );
                      })}
                    </div>
                  </article>
                ))}
                {previewCalendarItems.length === 0 ? (
                  <p className="empty-copy">{copy(locale, "contact", "previewEmpty")}</p>
                ) : null}
                {hiddenPreviewItems > 0 ? (
                  <p className="contact-preview-more">
                    {copy(locale, "contact", "previewMore", { count: hiddenPreviewItems })}
                  </p>
                ) : null}
              </div>
            </div>
            <FieldHelpButton fieldId="contactPattern.duplicatePrevention" showRequirement={false} />
            {message ? <p className="inline-message" role="status" data-testid="contact-message">{message}</p> : null}
          </div>
        </section>
      </div>

      <section className="summary-strip summary-strip--seven">
        <div><small>{copy(locale, "contact", "scheduled")}</small><strong>{stats.scheduled}</strong></div>
        <div><small>{copy(locale, "contact", "pending")}</small><strong>{stats.pending}</strong></div>
        <div><small>{copy(locale, "contact", "completed")}</small><strong>{stats.completed}</strong></div>
        <div><small>{copy(locale, "contact", "cancelledDuty")}</small><strong>{stats.cancelledDutyRelated}</strong></div>
        <div><small>{copy(locale, "contact", "cancelledOther")}</small><strong>{stats.cancelledOther}</strong></div>
        <div><small>{copy(locale, "contact", "externallyBlocked")}</small><strong>{stats.externallyBlocked}</strong></div>
        <div><small>{copy(locale, "contact", "additional")}</small><strong>{stats.additional}</strong></div>
      </section>

      {stats.unavailableOverlaps ? (
        <section className="notice notice--recommendation">
          <Icon name="briefcase" />
          <div>
            <strong>{copy(locale, "contact", "overlaps", { count: stats.unavailableOverlaps })}</strong>
            <p>{copy(locale, "contact", "unavailabilityNotice")}</p>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>{copy(locale, "contact", "datesTitle")}</h2>
            <p>{formatDate(generationStart, intlLocale)} {copy(locale, "contact", "through")} {formatDate(generationEnd, intlLocale)}</p>
          </div>
        </div>
        <div className="rule-entry-list" data-testid="contact-generated-list">
          {relevantEntries.map((entry) => {
            const isRuleEntry = Boolean(entry.contactRuleId || entry.generatedByPatternId);
            const isException = entry.contactRuleSyncState === "manual_override";
            const exceptionLabel = entry.status === "cancelled"
              ? copy(locale, "contact", "ruleExceptionCancelled")
              : isException
                ? copy(locale, "contact", "ruleExceptionChanged")
                : copy(locale, "contact", "ruleExceptionRegular");
            const overlaps = isRuleEntry
              ? unavailableForEntry(entry, data.unavailablePeriods, {
                  affectsContactOnly: true
                })
              : [];
            return (
            <article className="rule-entry" key={entry.id} data-testid={isRuleEntry ? "contact-generated-entry" : "contact-additional-entry"}>
              <button className="rule-entry__main" type="button" onClick={() => onEditEntry(entry)}>
                <span>
                  <strong>{formatDate(entry.startDateTime, intlLocale)}</strong>
                  <small>{formatTime(entry.startDateTime, intlLocale)} {copy(locale, "contact", "through")} {formatDate(entry.endDateTime, intlLocale)}, {formatTime(entry.endDateTime, intlLocale)}</small>
                </span>
                <span>
                  <strong>{entry.childIds.map((id) => data.children.find((child) => child.id === id)?.name).filter(Boolean).join(copy(locale, "contact", "and"))}</strong>
                  <small>{entry.additionalCare ? copy(locale, "contact", "additionalCare") : copy(locale, "contact", "defaultName")}</small>
                  {isRuleEntry ? <small>{exceptionLabel}</small> : null}
                  <small>
                    {copy(locale, "common", "updatedBy", {
                      actor: actorDisplayName(data, entry.updatedBy),
                      date: formatDateTime(entry.updatedAt, intlLocale)
                    })}
                  </small>
                </span>
                <span className={`status-label status-label--${entry.status}`}>
                  {entry.additionalCare ? copy(locale, "contact", "additional") : statusLabels[entry.status]}
                </span>
                {overlaps.length ? (
                  <span className="rule-entry__overlap">
                    <Icon name="alert" size={15} />
                    {copy(locale, "contact", "overlap")}
                  </span>
                ) : null}
              </button>
              {isRuleEntry ? (
                <div className="rule-entry__actions">
                  <button className="button button--quiet" type="button" onClick={() => void updateEntryStatus(entry.id, "completed")} disabled={!canWrite || isSaving}>
                    <Icon name="check" size={15} />
                    {copy(locale, "contact", "completed")}
                  </button>
                  <button className="button button--danger-quiet" type="button" onClick={() => { setCancelEntry(entry); setCancelReason(entry.cancellationReason ?? ""); }} disabled={!canWrite || isSaving}>
                    <Icon name="close" size={15} />
                    {copy(locale, "contact", "cancelled")}
                  </button>
                  <FieldHelpButton fieldId="contactPattern.confirmCompleted" showRequirement={false} />
                  <FieldHelpButton fieldId="contactPattern.markCancelled" showRequirement={false} />
                </div>
              ) : null}
            </article>
            );
          })}
          {relevantEntries.length === 0 ? <p className="empty-copy empty-copy--padded">{copy(locale, "contact", "empty")}</p> : null}
        </div>
      </section>

      {cancelEntry ? (
        <Modal title={copy(locale, "contact", "cancelTitle")} onClose={() => setCancelEntry(null)}>
          <form className="child-form" onSubmit={confirmCancellation}>
            <label className="field">
              <FieldHelpLabel fieldId="careEntry.cancellationReason" />
              <textarea autoFocus required rows={4} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
            </label>
            <footer className="form-actions">
              <span />
              <div className="form-actions__right">
                <button className="button button--secondary" type="button" onClick={() => setCancelEntry(null)}>{copy(locale, "common", "cancel")}</button>
                <button className="button button--primary" type="submit" disabled={!canWrite || isSaving}>{copy(locale, "contact", "saveCancellation")}</button>
              </div>
            </footer>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
