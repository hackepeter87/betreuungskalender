import { useMemo } from "react";
import { formatShortDate, formatTime } from "../lib/date";
import { unavailableForEntry } from "../lib/analytics";
import {
  locationLabels,
  statusLabels,
  unavailableCategoryLabels
} from "../lib/labels";
import type { CareEntry, Child, UnavailablePeriod } from "../types";
import { Icon } from "./Icon";

function durationLabel(entry: CareEntry): string {
  const milliseconds =
    new Date(entry.endDateTime).getTime() - new Date(entry.startDateTime).getTime();
  const hours = Math.max(0, milliseconds / 3_600_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = Math.round(hours % 24);
    return remainingHours ? `${days} T. ${remainingHours} Std.` : `${days} Tage`;
  }
  return `${hours.toLocaleString("de-DE", { maximumFractionDigits: 1 })} Std.`;
}

export function CalendarAgenda({
  entries,
  unavailablePeriods,
  children,
  onSelectDate,
  onSelectEntry,
  onSelectUnavailable,
  allowCreate = true
}: {
  entries: CareEntry[];
  unavailablePeriods: UnavailablePeriod[];
  children: Child[];
  onSelectDate: (date: string) => void;
  onSelectEntry: (entry: CareEntry) => void;
  onSelectUnavailable: (period: UnavailablePeriod) => void;
  allowCreate?: boolean;
}) {
  const childById = useMemo(
    () => new Map(children.map((child) => [child.id, child])),
    [children]
  );
  const grouped = useMemo(() => {
    const groups = new Map<
      string,
      { entries: CareEntry[]; unavailable: UnavailablePeriod[] }
    >();
    for (const entry of entries.slice().sort((a, b) => a.startDateTime.localeCompare(b.startDateTime))) {
      const date = entry.startDateTime.slice(0, 10);
      const group = groups.get(date) ?? { entries: [], unavailable: [] };
      group.entries.push(entry);
      groups.set(date, group);
    }
    for (const period of unavailablePeriods
      .filter((item) => !item.deletedAt)
      .slice()
      .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime))) {
      const date = period.startDateTime.slice(0, 10);
      const group = groups.get(date) ?? { entries: [], unavailable: [] };
      group.unavailable.push(period);
      groups.set(date, group);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [entries, unavailablePeriods]);

  if (!grouped.length) {
    return (
      <div className="agenda-empty">
        <Icon name="calendar" size={24} />
        <strong>Noch keine Einträge in diesem Monat</strong>
        <p>Erfasse den ersten Betreuungseintrag direkt aus der Agenda.</p>
        <button className="button button--primary" type="button" onClick={() => onSelectDate("")} disabled={!allowCreate}>
          <Icon name="plus" size={18} />
          Eintrag hinzufügen
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
              <strong>{formatShortDate(date)}</strong>
              <small>{group.entries.length + group.unavailable.length} Dokumentationen</small>
            </div>
            <button
              className="icon-button icon-button--bordered"
              type="button"
              onClick={() => onSelectDate(date)}
              disabled={!allowCreate}
              aria-label={`Eintrag für ${formatShortDate(date)} hinzufügen`}
            >
              <Icon name="plus" size={18} />
            </button>
          </header>
          <div className="agenda-day__entries">
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
                      {period.dutyRelated ? "Dienstlich" : "Nichtverfügbar"}
                    </span>
                  </span>
                  <span className="agenda-card__details">
                    <span><Icon name="clock" size={15} />{formatTime(period.startDateTime)}–{formatTime(period.endDateTime)}</span>
                    {period.location ? <span><Icon name="home" size={15} />{period.location}</span> : null}
                  </span>
                  <span className="agenda-card__flags">
                    {period.affectsContact ? <span><Icon name="repeat" size={14} />Betrifft Umgang</span> : null}
                    {period.affectsHolidays ? <span><Icon name="sun" size={14} />Betrifft Ferien</span> : null}
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
                      <strong>{entryChildren.map((child) => child.name).join(" und ") || "Ohne Kind"}</strong>
                      <span className={`status-label status-label--${entry.status}`}>
                        {statusLabels[entry.status]}
                      </span>
                    </span>
                    <span className="agenda-card__details">
                      <span><Icon name="calendar" size={15} />{formatTime(entry.startDateTime)}–{formatTime(entry.endDateTime)}</span>
                      <span><Icon name="history" size={15} />{durationLabel(entry)}</span>
                      <span><Icon name="home" size={15} />{entry.customLocation || locationLabels[entry.location]}</span>
                    </span>
                    <span className="agenda-card__flags">
                      {entry.overnight ? <span><Icon name="moon" size={14} />Übernachtung</span> : null}
                      {entry.additionalCare ? <span><Icon name="plus" size={14} />Zusatzbetreuung</span> : null}
                      {entry.holiday ? <span><Icon name="sun" size={14} />Ferientag</span> : null}
                    </span>
                    {hasOverlap ? (
                      <span className="agenda-card__warning">
                        <Icon name="alert" size={15} />
                        Dieser geplante Umgang überschneidet sich mit einer dokumentierten Nichtverfügbarkeit.
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
