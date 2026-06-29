import { useMemo } from "react";
import { unavailableForEntry } from "../lib/analytics";
import { entryDateKeys, formatTime, getCalendarDays } from "../lib/date";
import { unavailableCategoryLabels } from "../lib/labels";
import type { CareEntry, Child, ExternalCalendarEvent, UnavailablePeriod } from "../types";
import { Icon } from "./Icon";
import { useI18n } from "../i18n/I18nProvider";
import { copy, copyList } from "../i18n/catalog";

export function CalendarGrid({
  monthKey,
  entries,
  children,
  unavailablePeriods = [],
  externalEvents = [],
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
          const visibleCount = dayEntries.length + dayUnavailable.length + dayExternal.length;
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
                {dayExternal.slice(0, 1).map((event) => (
                  <span className="calendar-event calendar-event--external" key={`external-${event.id}`} title={`${event.sourceName}: ${event.title}`} style={{ borderColor: event.sourceColor }} data-testid={`external-calendar-event-${event.id}`}>
                    <Icon name="calendar" size={13} /><span className="calendar-event__label">{event.title}</span>
                  </span>
                ))}
                {dayUnavailable.slice(0, 1).map((period) => (
                  <button
                    className={`calendar-event calendar-event--unavailable ${period.dutyRelated ? "is-duty" : ""}`}
                    type="button"
                    key={`unavailable-${period.id}`}
                    data-testid={`calendar-unavailable-${period.id}`}
                    onClick={() => onSelectUnavailable?.(period)}
                    title={`${unavailableCategoryLabels[period.category]} · ${formatTime(period.startDateTime, intlLocale)}`}
                  >
                    <span className="calendar-event__unavailable-icon"><Icon name="briefcase" size={13} /></span>
                    <span className="calendar-event__label">
                      {period.dutyRelated ? copy(locale, "calendar", "dutyAbsence") : copy(locale, "calendar", "unavailability")}
                    </span>
                  </button>
                ))}
                {dayEntries.slice(0, dayUnavailable.length ? 2 : 3).map((entry) => {
                  const hasOverlap =
                    entry.status === "planned" &&
                    entry.generatedByPatternId &&
                    unavailableForEntry(entry, unavailablePeriods, {
                      affectsContactOnly: true
                    }).length > 0;
                  return (
                  <button
                    className={`calendar-event calendar-event--${entry.status} ${hasOverlap ? "calendar-event--overlap" : ""}`}
                    type="button"
                    key={entry.id}
                    onClick={() => onSelectEntry(entry)}
                    title={hasOverlap
                      ? copy(locale, "agenda", "overlap")
                      : `${entry.status === "completed" ? copy(locale, "calendar", "completed") : entry.status === "planned" ? copy(locale, "calendar", "planned") : copy(locale, "calendar", "cancelled")} · ${formatTime(entry.startDateTime, intlLocale)}`}
                  >
                    <span className="calendar-event__colors">
                      {entry.childIds.map((id) => (
                        <span key={id} style={{ backgroundColor: childMap.get(id)?.color ?? "#94a3b8" }} />
                      ))}
                    </span>
                    <span className="calendar-event__label">
                      {entry.status === "cancelled"
                        ? copy(locale, "calendar", "cancelled")
                        : entry.additionalCare
                          ? copy(locale, "agenda", "additionalCare")
                        : entry.childIds.length > 1
                          ? copy(locale, "calendar", "bothChildren")
                          : childMap.get(entry.childIds[0])?.name ?? copy(locale, "calendar", "entry")}
                    </span>
                    {entry.overnight ? <Icon name="moon" size={13} /> : null}
                    {hasOverlap ? <Icon name="alert" size={13} /> : null}
                  </button>
                  );
                })}
                {visibleCount > 3 ? <span className="calendar-day__more">{copy(locale, "calendar", "more", { count: visibleCount - 3 })}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
