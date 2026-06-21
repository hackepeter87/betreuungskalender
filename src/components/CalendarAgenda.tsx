import { useMemo } from "react";
import { formatShortDate, formatTime } from "../lib/date";
import { unavailableForEntry } from "../lib/analytics";
import {
  locationLabels,
  statusLabels,
  unavailableCategoryLabels
} from "../lib/labels";
import type { CareEntry, Child, ExternalCalendarEvent, UnavailablePeriod } from "../types";
import { Icon } from "./Icon";
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

export function CalendarAgenda({
  entries,
  unavailablePeriods,
  externalEvents = [],
  children,
  onSelectDate,
  onSelectEntry,
  onSelectUnavailable,
  allowCreate = true
}: {
  entries: CareEntry[];
  unavailablePeriods: UnavailablePeriod[];
  externalEvents?: ExternalCalendarEvent[];
  children: Child[];
  onSelectDate: (date: string) => void;
  onSelectEntry: (entry: CareEntry) => void;
  onSelectUnavailable: (period: UnavailablePeriod) => void;
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
      { entries: CareEntry[]; unavailable: UnavailablePeriod[]; external: ExternalCalendarEvent[] }
    >();
    for (const entry of entries.slice().sort((a, b) => a.startDateTime.localeCompare(b.startDateTime))) {
      const date = entry.startDateTime.slice(0, 10);
      const group = groups.get(date) ?? { entries: [], unavailable: [], external: [] };
      group.entries.push(entry);
      groups.set(date, group);
    }
    for (const period of unavailablePeriods
      .filter((item) => !item.deletedAt)
      .slice()
      .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime))) {
      const date = period.startDateTime.slice(0, 10);
      const group = groups.get(date) ?? { entries: [], unavailable: [], external: [] };
      group.unavailable.push(period);
      groups.set(date, group);
    }
    for (const event of externalEvents) {
      const date = event.startDateTime.slice(0, 10);
      const group = groups.get(date) ?? { entries: [], unavailable: [], external: [] };
      group.external.push(event);
      groups.set(date, group);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [entries, unavailablePeriods, externalEvents]);

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
        <section className="agenda-day" key={date}>
          <header className="agenda-day__header">
            <div>
              <strong>{formatShortDate(date, intlLocale)}</strong>
              <small>{copy(locale, "agenda", "documentationCount", { count: group.entries.length + group.unavailable.length })}</small>
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
            {group.external.map((event) => (
              <article className="agenda-card agenda-card--external" key={`external-${event.id}`} style={{ borderColor: event.sourceColor }} data-testid={`external-calendar-event-${event.id}`}>
                <span className="agenda-card__main"><span className="agenda-card__topline"><strong>{event.title}</strong><span className="status-label status-label--external">{copy(locale, "externalCalendar", "readOnly")}</span></span><span className="agenda-card__details"><span><Icon name="calendar" size={15} />{event.sourceName}</span>{!event.allDay ? <span><Icon name="clock" size={15} />{formatTime(event.startDateTime, intlLocale)}–{formatTime(event.endDateTime, intlLocale)}</span> : null}</span></span>
              </article>
            ))}
            {group.unavailable.map((period) => (
              <button
                className={`agenda-card agenda-card--unavailable ${period.dutyRelated ? "is-duty" : ""}`}
                type="button"
                key={`unavailable-${period.id}`}
                onClick={() => onSelectUnavailable(period)}
              >
                <span className="agenda-card__unavailable-icon"><Icon name="briefcase" size={19} /></span>
                <span className="agenda-card__main">
                  <span className="agenda-card__topline">
                    <strong>{unavailableCategoryLabels[period.category]}</strong>
                    <span className="status-label status-label--unavailable">
                      {period.dutyRelated ? copy(locale, "agenda", "dutyRelated") : copy(locale, "agenda", "unavailable")}
                    </span>
                  </span>
                  <span className="agenda-card__details">
                    <span><Icon name="clock" size={15} />{formatTime(period.startDateTime, intlLocale)}–{formatTime(period.endDateTime, intlLocale)}</span>
                    {period.location ? <span><Icon name="home" size={15} />{period.location}</span> : null}
                  </span>
                  <span className="agenda-card__flags">
                    {period.affectsContact ? <span><Icon name="repeat" size={14} />{copy(locale, "agenda", "affectsContact")}</span> : null}
                    {period.affectsHolidays ? <span><Icon name="sun" size={14} />{copy(locale, "agenda", "affectsHolidays")}</span> : null}
                  </span>
                </span>
                <Icon name="chevronRight" size={18} />
              </button>
            ))}
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
              return (
                <button
                  className={`agenda-card agenda-card--${entry.status}`}
                  type="button"
                  key={entry.id}
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
                      <span><Icon name="calendar" size={15} />{formatTime(entry.startDateTime, intlLocale)}–{formatTime(entry.endDateTime, intlLocale)}</span>
                      <span><Icon name="history" size={15} />{durationLabel(entry, locale)}</span>
                      <span><Icon name="home" size={15} />{entry.customLocation || locationLabels[entry.location]}</span>
                    </span>
                    <span className="agenda-card__flags">
                      {entry.overnight ? <span><Icon name="moon" size={14} />{copy(locale, "agenda", "overnight")}</span> : null}
                      {entry.additionalCare ? <span><Icon name="plus" size={14} />{copy(locale, "agenda", "additionalCare")}</span> : null}
                      {entry.holiday ? <span><Icon name="sun" size={14} />{copy(locale, "agenda", "holiday")}</span> : null}
                    </span>
                    {hasOverlap ? (
                      <span className="agenda-card__warning">
                        <Icon name="alert" size={15} />
                        {copy(locale, "agenda", "overlap")}
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
