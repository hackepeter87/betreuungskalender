import { Fragment, useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { unavailableForEntry } from "../lib/analytics";
import { entryDateKeys, enumerateDateKeys, formatTime, getCalendarDays } from "../lib/date";
import { statusLabel, unavailableCategoryLabels } from "../lib/labels";
import { conflictSeverityForEntry } from "../lib/careConflictPresentation";
import type { CareConflict, CareEntry, Child, ExternalCalendarEvent, HolidayPeriod, UnavailablePeriod } from "../types";
import { Icon } from "./Icon";
import { useI18n } from "../i18n/I18nProvider";
import { copy, copyList } from "../i18n/catalog";
import { formatDate } from "../lib/date";
import { isoWeekNumber } from "../lib/calendar";
import { useDialogFocus } from "../hooks/useDialogFocus";

interface OpenDay {
  dateKey: string;
  anchor: DOMRect;
}

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
  const [openDay, setOpenDay] = useState<OpenDay | null>(null);
  const dayTriggerRef = useRef<HTMLButtonElement | null>(null);
  const closeDay = useCallback(() => setOpenDay(null), []);
  const dayDialogRef = useDialogFocus<HTMLElement>(closeDay, Boolean(openDay), dayTriggerRef);
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

  const openDayEntries = openDay ? entriesByDate.get(openDay.dateKey) ?? [] : [];
  const openDayUnavailable = openDay ? unavailableByDate.get(openDay.dateKey) ?? [] : [];
  const openDayExternal = openDay ? externalByDate.get(openDay.dateKey) ?? [] : [];
  const openDayHolidays = openDay ? holidaysByDate.get(openDay.dateKey) ?? [] : [];
  const popoverStyle = openDay ? {
    "--day-popover-left": `${Math.max(12, Math.min(openDay.anchor.left, window.innerWidth - 372))}px`,
    "--day-popover-top": `${Math.max(12, Math.min(openDay.anchor.bottom + 8, window.innerHeight - 460))}px`
  } as CSSProperties : undefined;

  return (
    <div className="calendar-wrap">
      <div className="calendar-weekdays">
        <div className="calendar-weekdays__week">{copy(locale, "calendar", "weekNumber")}</div>
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
            <Fragment key={day.dateKey}>
            {calendarDays.indexOf(day) % 7 === 0 ? (
              <div className="calendar-week-number" aria-label={`${copy(locale, "calendar", "weekNumber")} ${isoWeekNumber(day.dateKey)}`}>
                {isoWeekNumber(day.dateKey)}
              </div>
            ) : null}
            <div
              className={[
                "calendar-day",
                day.inMonth ? "" : "calendar-day--muted",
                day.isToday ? "calendar-day--today" : "",
                day.isWeekend ? "calendar-day--weekend" : ""
              ].filter(Boolean).join(" ")}
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
                {visibleCount > renderedCount ? (
                  <button
                    className="calendar-day__more"
                    type="button"
                    aria-haspopup="dialog"
                    onClick={(event) => {
                      dayTriggerRef.current = event.currentTarget;
                      setOpenDay({ dateKey: day.dateKey, anchor: event.currentTarget.getBoundingClientRect() });
                    }}
                  >
                    {copy(locale, "calendar", "more", { count: visibleCount - renderedCount })}
                  </button>
                ) : null}
              </div>
            </div>
            </Fragment>
          );
        })}
      </div>
      {openDay ? createPortal(
        <div className="calendar-day-popover-layer" role="presentation" onMouseDown={closeDay}>
          <section
            ref={dayDialogRef}
            className="calendar-day-popover"
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-day-popover-title"
            style={popoverStyle}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="calendar-day-popover__header">
              <div>
                <span>{copy(locale, "calendar", "weekNumber")} {isoWeekNumber(openDay.dateKey)}</span>
                <h2 id="calendar-day-popover-title">{copy(locale, "calendar", "dayOverview", { date: formatDate(openDay.dateKey, intlLocale) })}</h2>
              </div>
              <button className="icon-button" type="button" onClick={closeDay} aria-label={copy(locale, "calendar", "closeDayOverview")}>
                <Icon name="close" size={18} />
              </button>
            </header>
            <div className="calendar-day-popover__body">
              {openDayEntries.length ? <section>
                <h3>{copy(locale, "calendar", "careItems")}</h3>
                {openDayEntries.map((entry) => (
                  <button className="calendar-day-popover__item" type="button" key={entry.id} onClick={() => { setOpenDay(null); onSelectEntry(entry); }}>
                    <span className="calendar-event__colors">{entry.childIds.map((id) => <span key={id} style={{ backgroundColor: childMap.get(id)?.color ?? "#94a3b8" }} />)}</span>
                    <span><strong>{entry.childIds.map((id) => childMap.get(id)?.name).filter(Boolean).join(locale === "en" ? " and " : " und ")}</strong><small>{formatTime(entry.startDateTime, intlLocale)}–{formatTime(entry.endDateTime, intlLocale)} · {statusLabel(entry.status, locale)}</small></span>
                    <Icon name="chevronRight" size={16} />
                  </button>
                ))}
              </section> : null}
              {openDayHolidays.length ? <section><h3>{copy(locale, "calendar", "holidayItems")}</h3>{openDayHolidays.map((period) => <div className="calendar-day-popover__item is-static" key={period.id}><Icon name="sun" size={16} /><span><strong>{period.name}</strong></span></div>)}</section> : null}
              {openDayUnavailable.length ? <section><h3>{copy(locale, "calendar", "unavailableItems")}</h3>{openDayUnavailable.map((period) => onSelectUnavailable ? <button className="calendar-day-popover__item" type="button" key={period.id} onClick={() => { setOpenDay(null); onSelectUnavailable(period); }}><Icon name="briefcase" size={16} /><span><strong>{unavailableCategoryLabels[period.category]}</strong><small>{formatTime(period.startDateTime, intlLocale)}–{formatTime(period.endDateTime, intlLocale)}</small></span><Icon name="chevronRight" size={16} /></button> : <div className="calendar-day-popover__item is-static" key={period.id}><Icon name="briefcase" size={16} /><span><strong>{unavailableCategoryLabels[period.category]}</strong></span></div>)}</section> : null}
              {openDayExternal.length ? <section><h3>{copy(locale, "calendar", "externalItems")}</h3>{openDayExternal.map((event) => <div className="calendar-day-popover__item is-static" key={event.id}><Icon name="calendar" size={16} /><span><strong>{event.title}</strong><small>{event.sourceName}</small></span></div>)}</section> : null}
            </div>
            {allowCreate ? <footer className="calendar-day-popover__footer"><button className="button button--primary" type="button" onClick={() => { setOpenDay(null); onSelectDate(openDay.dateKey); }}><Icon name="plus" size={17} />{copy(locale, "calendar", "createOnDay")}</button></footer> : null}
          </section>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
