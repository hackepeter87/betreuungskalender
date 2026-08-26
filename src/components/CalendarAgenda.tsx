import { useMemo } from "react";
import {
  entryDateKeys,
  enumerateDateKeys,
  formatDate,
  formatShortDate,
  formatTime,
  timedRangeDaySegment
} from "../lib/date";
import { unavailableForEntry } from "../lib/analytics";
import {
  deviationLabel,
  locationLabels,
  statusLabels,
  unavailableCategoryLabels
} from "../lib/labels";
import type { CareConflict, CareEntry, Child, ExternalCalendarEvent, HolidayPeriod, UnavailablePeriod } from "../types";
import { Icon } from "./Icon";
import { CareConflictIndicator } from "./CareConflictIndicator";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";

function durationLabel(entry: CareEntry, locale: "de" | "en"): string {
  const milliseconds =
    new Date(entry.endDateTime).getTime() - new Date(entry.startDateTime).getTime();
  const hours = Math.max(0, milliseconds / 3_600_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = Math.round(hours % 24);
    return remainingHours
      ? copy(locale, "agenda", "durationDaysHours", { days, hours: remainingHours })
      : copy(locale, "agenda", "durationDays", { days });
  }
  return copy(locale, "agenda", "durationHours", {
    hours: hours.toLocaleString(locale === "en" ? "en-GB" : "de-DE", {
      maximumFractionDigits: 1
    })
  });
}

function timedRangeLabelForDate(
  startDateTime: string,
  endDateTime: string,
  dateKey: string,
  locale: "de" | "en",
  intlLocale: string
): string {
  const segment = timedRangeDaySegment(startDateTime, endDateTime, dateKey);
  if (segment === "starts") {
    return copy(locale, "agenda", "startsAt", { time: formatTime(startDateTime, intlLocale) });
  }
  if (segment === "ends") {
    return copy(locale, "agenda", "endsAt", { time: formatTime(endDateTime, intlLocale) });
  }
  if (segment === "full-day") return copy(locale, "agenda", "allDay");
  return `${formatTime(startDateTime, intlLocale)}–${formatTime(endDateTime, intlLocale)}`;
}

function fullTimedRangeLabel(
  startDateTime: string,
  endDateTime: string,
  intlLocale: string
): string | null {
  const startDate = startDateTime.slice(0, 10);
  const endDate = endDateTime.slice(0, 10);
  if (startDate === endDate) return null;
  return `${formatShortDate(startDate, intlLocale)}, ${formatTime(startDateTime, intlLocale)} – ${formatShortDate(endDate, intlLocale)}, ${formatTime(endDateTime, intlLocale)}`;
}

export function CalendarAgenda({
  entries,
  unavailablePeriods,
  externalEvents = [],
  holidayPeriods = [],
  visibleStartDate,
  visibleEndDate,
  children,
  conflicts = [],
  canWrite = true,
  onSelectDate,
  onSelectEntry,
  onSelectUnavailable,
  allowCreate = true
}: {
  entries: CareEntry[];
  unavailablePeriods: UnavailablePeriod[];
  externalEvents?: ExternalCalendarEvent[];
  holidayPeriods?: HolidayPeriod[];
  visibleStartDate: string;
  visibleEndDate: string;
  children: Child[];
  conflicts?: CareConflict[];
  canWrite?: boolean;
  onSelectDate: (date: string) => void;
  onSelectEntry: (entry: CareEntry) => void;
  onSelectUnavailable?: (period: UnavailablePeriod) => void;
  allowCreate?: boolean;
}) {
  const { locale, intlLocale } = useI18n();
  const childById = useMemo(
    () => new Map(children.map((child) => [child.id, child])),
    [children]
  );
  const grouped = useMemo(() => {
    const groups = new Map<
      string,
      { entries: CareEntry[]; unavailable: UnavailablePeriod[]; external: ExternalCalendarEvent[]; holidays: HolidayPeriod[] }
    >();
    const visibleDateKeys = (startDateTime: string, endDateTime: string) =>
      entryDateKeys(startDateTime, endDateTime).filter(
        (date) => date >= visibleStartDate && date <= visibleEndDate
      );
    for (const entry of entries.slice().sort((a, b) => a.startDateTime.localeCompare(b.startDateTime))) {
      for (const date of visibleDateKeys(entry.startDateTime, entry.endDateTime)) {
        const group = groups.get(date) ?? { entries: [], unavailable: [], external: [], holidays: [] };
        group.entries.push(entry);
        groups.set(date, group);
      }
    }
    for (const period of unavailablePeriods
      .filter((item) => !item.deletedAt)
      .slice()
      .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime))) {
      for (const date of visibleDateKeys(period.startDateTime, period.endDateTime)) {
        const group = groups.get(date) ?? { entries: [], unavailable: [], external: [], holidays: [] };
        group.unavailable.push(period);
        groups.set(date, group);
      }
    }
    for (const event of externalEvents) {
      for (const date of visibleDateKeys(event.startDateTime, event.endDateTime)) {
        const group = groups.get(date) ?? { entries: [], unavailable: [], external: [], holidays: [] };
        group.external.push(event);
        groups.set(date, group);
      }
    }
    for (const period of holidayPeriods.filter((item) => !item.deletedAt)) {
      const clippedStart = period.startDate < visibleStartDate ? visibleStartDate : period.startDate;
      const clippedEnd = period.endDate > visibleEndDate ? visibleEndDate : period.endDate;
      if (clippedEnd < clippedStart) continue;
      for (const date of enumerateDateKeys(clippedStart, clippedEnd)) {
        const group = groups.get(date) ?? { entries: [], unavailable: [], external: [], holidays: [] };
        group.holidays.push(period);
        groups.set(date, group);
      }
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [entries, unavailablePeriods, externalEvents, holidayPeriods, visibleEndDate, visibleStartDate]);

  if (!grouped.length) {
    return (
      <div className="agenda-empty">
        <Icon name="calendar" size={24} />
        <strong>{copy(locale, "agenda", "emptyTitle")}</strong>
        <p>{copy(locale, "agenda", "emptyDescription")}</p>
        <button className="button button--primary" type="button" onClick={() => onSelectDate("")} disabled={!allowCreate}>
          <Icon name="plus" size={18} />
          {copy(locale, "agenda", "addEntry")}
        </button>
      </div>
    );
  }

  return (
    <div className="agenda-list">
      {grouped.map(([date, group]) => (
        <section className="agenda-day" key={date} data-testid={`agenda-day-${date}`}>
          <header className="agenda-day__header">
            <div>
              <strong>{formatShortDate(date, intlLocale)}</strong>
              <small>{copy(locale, "agenda", "documentationCount", { count: group.entries.length + group.unavailable.length + group.holidays.length })}</small>
            </div>
            <button
              className="icon-button icon-button--bordered"
              type="button"
              onClick={() => onSelectDate(date)}
              disabled={!allowCreate}
              aria-label={copy(locale, "agenda", "addEntryForDate", { date: formatShortDate(date, intlLocale) })}
            >
              <Icon name="plus" size={18} />
            </button>
          </header>
          <div className="agenda-day__entries">
            {group.external.map((event) => {
              const fullRange = event.allDay
                ? null
                : fullTimedRangeLabel(event.startDateTime, event.endDateTime, intlLocale);
              return (
                <article className="agenda-card agenda-card--external" key={`external-${event.id}`} style={{ borderColor: event.sourceColor }} data-testid={`external-calendar-event-${event.id}`}>
                  <span className="agenda-card__main">
                    <span className="agenda-card__topline">
                      <strong>{event.title}</strong>
                      <span className="status-label status-label--external">{copy(locale, "externalCalendar", "readOnly")}</span>
                    </span>
                    <span className="agenda-card__details">
                      <span><Icon name="calendar" size={15} />{event.sourceName}</span>
                      {!event.allDay ? <span><Icon name="clock" size={15} />{timedRangeLabelForDate(event.startDateTime, event.endDateTime, date, locale, intlLocale)}</span> : null}
                      {fullRange ? <span className="agenda-card__range"><Icon name="calendar" size={15} />{fullRange}</span> : null}
                    </span>
                  </span>
                </article>
              );
            })}
            {group.holidays.map((period) => (
              <article className="agenda-card agenda-card--holiday" key={`holiday-${period.id}`} data-testid={`agenda-holiday-${period.id}`}>
                <span className="agenda-card__main">
                  <span className="agenda-card__topline">
                    <strong>{period.name}</strong>
                    <span className="status-label status-label--external">{copy(locale, "agenda", "holidayPeriod")}</span>
                  </span>
                  <span className="agenda-card__details">
                    <span><Icon name="sun" size={15} />{formatShortDate(period.startDate, intlLocale)}–{formatShortDate(period.endDate, intlLocale)}</span>
                  </span>
                </span>
              </article>
            ))}
            {group.unavailable.map((period) => {
              const fullRange = fullTimedRangeLabel(period.startDateTime, period.endDateTime, intlLocale);
              return (
                <button
                  className={`agenda-card agenda-card--unavailable ${period.dutyRelated ? "is-duty" : ""} ${period.scope === "external_contact_block" ? "is-external-block" : ""}`}
                  type="button"
                  key={`unavailable-${period.id}`}
                  onClick={() => onSelectUnavailable?.(period)}
                >
                  <span className="agenda-card__unavailable-icon"><Icon name="briefcase" size={19} /></span>
                  <span className="agenda-card__main">
                    <span className="agenda-card__topline">
                      <strong>{unavailableCategoryLabels[period.category]}</strong>
                      <span className="status-label status-label--unavailable">
                        {period.scope === "external_contact_block"
                          ? copy(locale, "agenda", "externalBlock")
                          : period.dutyRelated
                            ? copy(locale, "agenda", "dutyRelated")
                            : copy(locale, "agenda", "unavailable")}
                      </span>
                    </span>
                    <span className="agenda-card__details">
                      <span data-testid={`agenda-unavailable-day-${period.id}`}><Icon name="clock" size={15} />{timedRangeLabelForDate(period.startDateTime, period.endDateTime, date, locale, intlLocale)}</span>
                      {fullRange ? <span className="agenda-card__range" data-testid={`agenda-unavailable-range-${period.id}`}><Icon name="calendar" size={15} />{fullRange}</span> : null}
                      {period.location ? <span><Icon name="home" size={15} />{period.location}</span> : null}
                    </span>
                    <span className="agenda-card__flags">
                      {period.affectsContact ? <span><Icon name="repeat" size={14} />{copy(locale, "agenda", "affectsContact")}</span> : null}
                      {period.affectsHolidays ? <span><Icon name="sun" size={14} />{copy(locale, "agenda", "affectsHolidays")}</span> : null}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={18} />
                </button>
              );
            })}
            {group.entries.map((entry) => {
              const entryChildren = entry.childIds
                .map((id) => childById.get(id))
                .filter((child): child is Child => Boolean(child));
              const hasOverlap =
                entry.status === "planned" &&
                Boolean(entry.generatedByPatternId) &&
                unavailableForEntry(entry, unavailablePeriods, {
                  affectsContactOnly: true
                }).length > 0;
              const hasHolidayOverlap =
                Boolean(entry.contactRuleId || entry.generatedByPatternId) &&
                group.holidays.length > 0;
              const fullRange = fullTimedRangeLabel(entry.startDateTime, entry.endDateTime, intlLocale);
              return (
                <button
                  className={`agenda-card agenda-card--${entry.status}`}
                  type="button"
                  key={entry.id}
                  data-testid={`agenda-entry-${entry.id}-${date}`}
                  onClick={() => onSelectEntry(entry)}
                >
                  <span className="agenda-card__colors" aria-hidden="true">
                    {entryChildren.map((child) => (
                      <span key={child.id} style={{ backgroundColor: child.color }} />
                    ))}
                  </span>
                  <span className="agenda-card__main">
                    <span className="agenda-card__topline">
                      <strong>{entryChildren.map((child) => child.name).join(locale === "en" ? " and " : " und ") || copy(locale, "common", "noChild")}</strong>
                      <span className={`status-label status-label--${entry.status}`}>
                        {statusLabels[entry.status]}
                      </span>
                    </span>
                    <span className="agenda-card__details">
                      <span><Icon name="clock" size={15} />{timedRangeLabelForDate(entry.startDateTime, entry.endDateTime, date, locale, intlLocale)}</span>
                      {fullRange ? <span className="agenda-card__range"><Icon name="calendar" size={15} />{fullRange}</span> : null}
                      <span><Icon name="history" size={15} />{durationLabel(entry, locale)}</span>
                      <span><Icon name="home" size={15} />{entry.customLocation || locationLabels[entry.location]}</span>
                    </span>
                    <span className="agenda-card__flags">
                      <CareConflictIndicator conflicts={conflicts} entryId={entry.id} canWrite={canWrite} />
                      {entry.overnight ? <span><Icon name="moon" size={14} />{copy(locale, "agenda", "overnight")}</span> : null}
                      {entry.additionalCare ? <span><Icon name="plus" size={14} />{copy(locale, "agenda", "additionalCare")}</span> : null}
                      {entry.holiday ? <span><Icon name="sun" size={14} />{copy(locale, "agenda", "holiday")}</span> : null}
                      {hasHolidayOverlap ? <span><Icon name="sun" size={14} />{copy(locale, "agenda", "holidayOverlap")}</span> : null}
                      {entry.deviationType ? <span><Icon name="history" size={14} />{deviationLabel(entry.deviationType, locale)}</span> : null}
                    </span>
                    {entry.plannedStartDateTime && entry.plannedEndDateTime ? (
                      <span className="agenda-card__warning agenda-card__warning--neutral">
                        <Icon name="calendar" size={15} />
                        {copy(locale, "agenda", "originalPlan", {
                          date: formatDate(entry.plannedStartDateTime, intlLocale),
                          start: formatTime(entry.plannedStartDateTime, intlLocale),
                          end: formatTime(entry.plannedEndDateTime, intlLocale)
                        })}
                      </span>
                    ) : null}
                    {hasOverlap ? (
                      <span className="agenda-card__warning">
                        <Icon name="alert" size={15} />
                        {copy(locale, "agenda", "overlap")}
                      </span>
                    ) : null}
                    {hasHolidayOverlap ? (
                      <span className="agenda-card__warning agenda-card__warning--neutral">
                        <Icon name="sun" size={15} />
                        {copy(locale, "agenda", "holidayOverlapNotice")}
                      </span>
                    ) : null}
                  </span>
                  <Icon name="chevronRight" size={18} />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
