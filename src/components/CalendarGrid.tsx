import { useMemo } from "react";
import { unavailableForEntry } from "../lib/analytics";
import { entryDateKeys, enumerateDateKeys, formatTime, getCalendarDays } from "../lib/date";
import { statusLabel, unavailableCategoryLabels } from "../lib/labels";
import { conflictSeverityForEntry } from "../lib/careConflictPresentation";
import type { CareConflict, CareEntry, Child, ExternalCalendarEvent, HolidayPeriod, UnavailablePeriod } from "../types";
import { Icon } from "./Icon";
import { useI18n } from "../i18n/I18nProvider";
import { copy, copyList } from "../i18n/catalog";

export function CalendarGrid({
  monthKey,
  entries,
  children,
  unavailablePeriods = [],
  externalEvents = [],
  holidayPeriods = [],
  conflicts = [],
  onSelectDate,
  onSelectEntry,
  onSelectUnavailable,
  allowCreate = true
}: {
  monthKey: string;
  entries: CareEntry[];
  children: Child[];
  unavailablePeriods?: UnavailablePeriod[];
  externalEvents?: ExternalCalendarEvent[];
  holidayPeriods?: HolidayPeriod[];
  conflicts?: CareConflict[];
  onSelectDate: (dateKey: string) => void;
  onSelectEntry: (entry: CareEntry) => void;
  onSelectUnavailable?: (period: UnavailablePeriod) => void;
  allowCreate?: boolean;
}) {
  const { locale, intlLocale } = useI18n();
  const calendarDays = useMemo(() => getCalendarDays(monthKey), [monthKey]);
  const childMap = useMemo(
    () => new Map(children.map((child) => [child.id, child])),
    [children]
  );
  const entriesByDate = useMemo(() => {
    const map = new Map<string, CareEntry[]>();
    for (const entry of entries) {
      for (const dateKey of entryDateKeys(entry.startDateTime, entry.endDateTime)) {
        const current = map.get(dateKey) ?? [];
        current.push(entry);
        map.set(dateKey, current);
      }
    }
    return map;
  }, [entries]);
  const unavailableByDate = useMemo(() => {
    const map = new Map<string, UnavailablePeriod[]>();
    for (const period of unavailablePeriods) {
      if (period.deletedAt) continue;
      for (const dateKey of entryDateKeys(period.startDateTime, period.endDateTime)) {
        map.set(dateKey, [...(map.get(dateKey) ?? []), period]);
      }
    }
    return map;
  }, [unavailablePeriods]);
  const externalByDate = useMemo(() => {
    const map = new Map<string, ExternalCalendarEvent[]>();
    for (const event of externalEvents) for (const dateKey of entryDateKeys(event.startDateTime, event.endDateTime)) map.set(dateKey, [...(map.get(dateKey) ?? []), event]);
    return map;
  }, [externalEvents]);
  const holidaysByDate = useMemo(() => {
    const map = new Map<string, HolidayPeriod[]>();
    for (const period of holidayPeriods) {
      if (period.deletedAt) continue;
      for (const dateKey of enumerateDateKeys(period.startDate, period.endDate)) {
        map.set(dateKey, [...(map.get(dateKey) ?? []), period]);
      }
    }
    return map;
  }, [holidayPeriods]);

  return (
    <div className="calendar-wrap">
      <div className="calendar-weekdays">
        {copyList(locale, "calendar", "weekdays").map((label) => <div key={label}>{label}</div>)}
      </div>
      <div className="calendar-grid">
        {calendarDays.map((day) => {
          const dayEntries = entriesByDate.get(day.dateKey) ?? [];
          const dayUnavailable = unavailableByDate.get(day.dateKey) ?? [];
          const dayExternal = externalByDate.get(day.dateKey) ?? [];
          const dayHolidays = holidaysByDate.get(day.dateKey) ?? [];
          const visibleCount = dayEntries.length + dayUnavailable.length + dayExternal.length + dayHolidays.length;
          const maxRenderedEvents = 3;
          const renderedExternal = dayExternal.slice(0, 1);
          const renderedHolidays = dayHolidays.slice(0, 1);
          const renderedUnavailable = dayUnavailable.slice(0, 1);
          const remainingEntrySlots = Math.max(
            0,
            maxRenderedEvents - renderedExternal.length - renderedHolidays.length - renderedUnavailable.length
          );
          const renderedEntries = dayEntries.slice(0, remainingEntrySlots);
          const renderedCount =
            renderedExternal.length +
            renderedHolidays.length +
            renderedUnavailable.length +
            renderedEntries.length;
          return (
            <div
              className={[
                "calendar-day",
                day.inMonth ? "" : "calendar-day--muted",
                day.isToday ? "calendar-day--today" : "",
                day.isWeekend ? "calendar-day--weekend" : ""
              ].filter(Boolean).join(" ")}
              key={day.dateKey}
            >
              <button
                className="calendar-day__number"
                type="button"
                data-testid={`calendar-day-${day.dateKey}`}
                onClick={() => onSelectDate(day.dateKey)}
                disabled={!allowCreate}
                aria-label={copy(locale, "calendar", "addEntryOnDate", { date: day.dateKey })}
              >
                {day.day}
              </button>
              <div className="calendar-day__entries">
                {renderedExternal.map((event) => (
                  <span className="calendar-event calendar-event--external" key={`external-${event.id}`} title={`${event.sourceName}: ${event.title}`} style={{ borderColor: event.sourceColor }} data-testid={`external-calendar-event-${event.id}`}>
                    <Icon name="calendar" size={13} /><span className="calendar-event__label" data-short-label={event.title}>{event.title}</span>
                  </span>
                ))}
                {renderedHolidays.map((period) => (
                  <span className="calendar-event calendar-event--holiday" key={`holiday-${period.id}`} title={period.name} data-testid={`calendar-holiday-${period.id}`}>
                    <Icon name="sun" size={13} /><span className="calendar-event__label" data-short-label={locale === "en" ? "Holiday" : "Ferien"}>{period.name}</span>
                  </span>
                ))}
                {renderedUnavailable.map((period) => (
                  <button
                    className={`calendar-event calendar-event--unavailable ${period.dutyRelated ? "is-duty" : ""} ${period.scope === "external_contact_block" ? "is-external-block" : ""}`}
                    type="button"
                    key={`unavailable-${period.id}`}
                    data-testid={`calendar-unavailable-${period.id}`}
                    onClick={() => onSelectUnavailable?.(period)}
                    title={`${unavailableCategoryLabels[period.category]} · ${formatTime(period.startDateTime, intlLocale)}`}
                  >
                    <span className="calendar-event__unavailable-icon"><Icon name="briefcase" size={13} /></span>
                    <span
                      className="calendar-event__label"
                      data-short-label={
                        period.scope === "external_contact_block"
                          ? locale === "en" ? "Blocked" : "Blockiert"
                          : period.dutyRelated
                            ? locale === "en" ? "Duty" : "Dienst"
                            : locale === "en" ? "Away" : "Abwesend"
                      }
                    >
                      {period.scope === "external_contact_block"
                        ? copy(locale, "calendar", "externalBlock")
                        : period.dutyRelated
                          ? copy(locale, "calendar", "dutyAbsence")
                          : copy(locale, "calendar", "unavailability")}
                    </span>
                  </button>
                ))}
                {renderedEntries.map((entry) => {
                  const isRuleEntry = Boolean(entry.contactRuleId || entry.generatedByPatternId);
                  const isRuleException = entry.contactRuleSyncState === "manual_override";
                  const entryLabel = entry.status === "cancelled"
                    ? copy(locale, "calendar", "cancelled")
                    : entry.additionalCare
                      ? copy(locale, "agenda", "additionalCare")
                    : entry.childIds.length > 1
                      ? copy(locale, "calendar", "bothChildren")
                      : childMap.get(entry.childIds[0])?.name ?? copy(locale, "calendar", "entry");
                  const shortEntryLabel = entry.status === "cancelled"
                    ? locale === "en" ? "Cancelled" : "Ausfall"
                    : entry.additionalCare
                      ? locale === "en" ? "Extra" : "Zusatz"
                    : entry.childIds.length > 1
                      ? locale === "en" ? "All" : "Beide"
                      : entryLabel;
                  const ruleStateLabel = entry.status === "cancelled"
                    ? copy(locale, "calendar", "ruleCancelled")
                    : isRuleException
                      ? copy(locale, "calendar", "ruleChanged")
                      : isRuleEntry
                        ? copy(locale, "calendar", "ruleRegular")
                        : "";
                  const hasOverlap =
                    entry.status === "planned" &&
                    isRuleEntry &&
                    unavailableForEntry(entry, unavailablePeriods, {
                      affectsContactOnly: true
                    }).length > 0;
                  const hasHolidayOverlap = isRuleEntry && dayHolidays.length > 0;
                  const conflictSeverity = conflictSeverityForEntry(conflicts, entry.id);
                  return (
                  <button
                    className={[
                      "calendar-event",
                      `calendar-event--${entry.status}`,
                      isRuleEntry ? "calendar-event--rule" : "",
                      isRuleException ? "calendar-event--exception" : "",
                      hasOverlap ? "calendar-event--overlap" : "",
                      hasHolidayOverlap ? "calendar-event--holiday-overlap" : "",
                      conflictSeverity ? `calendar-event--conflict-${conflictSeverity}` : ""
                    ].filter(Boolean).join(" ")}
                    type="button"
                    key={entry.id}
                    data-testid={`calendar-entry-${entry.id}`}
                    onClick={() => onSelectEntry(entry)}
                    title={conflictSeverity
                      ? copy(locale, "careConflict", conflictSeverity === "unresolved_actual" ? "unresolvedActual" : "plannedWarning")
                      : hasOverlap
                      ? copy(locale, "agenda", "overlap")
                      : hasHolidayOverlap
                        ? copy(locale, "calendar", "holidayOverlap")
                      : `${statusLabel(entry.status, locale)} · ${ruleStateLabel ? `${ruleStateLabel} · ` : ""}${formatTime(entry.startDateTime, intlLocale)}`}
                  >
                    <span className="calendar-event__colors">
                      {entry.childIds.map((id) => (
                        <span key={id} data-testid={`calendar-entry-child-color-${id}`} style={{ backgroundColor: childMap.get(id)?.color ?? "#94a3b8" }} />
                      ))}
                    </span>
                    <span className="calendar-event__label" data-short-label={shortEntryLabel}>
                      {entryLabel}
                    </span>
                    {entry.overnight ? <Icon name="moon" size={13} /> : null}
                    {conflictSeverity || hasOverlap ? <Icon name="alert" size={13} /> : hasHolidayOverlap ? <Icon name="sun" size={13} /> : isRuleException ? <Icon name="edit" size={13} /> : isRuleEntry ? <Icon name="repeat" size={13} /> : null}
                  </button>
                  );
                })}
                {visibleCount > renderedCount ? <span className="calendar-day__more">{copy(locale, "calendar", "more", { count: visibleCount - renderedCount })}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
