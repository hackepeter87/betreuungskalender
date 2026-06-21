import { useEffect, useMemo, useState } from "react";
import { CalendarAgenda } from "../components/CalendarAgenda";
import { CalendarGrid } from "../components/CalendarGrid";
import { Icon } from "../components/Icon";
import { MonthToolbar } from "../components/MonthToolbar";
import { UnavailablePeriodForm } from "../components/UnavailablePeriodForm";
import { Modal } from "../components/Modal";
import { entriesForMonth, unavailablePeriodsForRange } from "../lib/analytics";
import { formatMonth } from "../lib/date";
import { rangeForMonth } from "../lib/date";
import { useAppStore } from "../store/AppStore";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";
import { api } from "../lib/api";
import type { CareEntry, ExternalCalendarEvent, UnavailablePeriod } from "../types";

export function CalendarPage({
  monthKey,
  onMonthChange,
  onNewEntry,
  onEditEntry
}: {
  monthKey: string;
  onMonthChange: (month: string) => void;
  onNewEntry: (date?: string) => void;
  onEditEntry: (entry: CareEntry) => void;
}) {
  const { data, canWrite } = useAppStore();
  const { locale, intlLocale } = useI18n();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [view, setView] = useState<"agenda" | "month">(() =>
    window.matchMedia("(max-width: 767px)").matches ? "agenda" : "month"
  );
  const [editingUnavailable, setEditingUnavailable] = useState<
    UnavailablePeriod | "new" | null
  >(null);
  const [externalEvents, setExternalEvents] = useState<ExternalCalendarEvent[]>([]);
  const entries = useMemo(() => entriesForMonth(data.entries, monthKey), [data.entries, monthKey]);
  const unavailablePeriods = useMemo(() => {
    const range = rangeForMonth(monthKey);
    return unavailablePeriodsForRange(
      data.unavailablePeriods,
      range.startDate,
      range.endDate
    );
  }, [data.unavailablePeriods, monthKey]);

  useEffect(() => {
    const range = rangeForMonth(monthKey);
    void api.listExternalCalendarEvents(`${range.startDate}T00:00:00.000Z`, `${range.endDate}T23:59:59.999Z`).then(setExternalEvents).catch(() => setExternalEvents([]));
  }, [monthKey]);

  useEffect(() => {
    setView(isMobile ? "agenda" : "month");
  }, [isMobile]);

  return (
    <div className="page page--calendar" data-testid="page-calendar">
      <div className="page-header">
        <div>
          <p className="page-header__context">{copy(locale, "calendarPage", "context")}</p>
          <h1>{formatMonth(monthKey, intlLocale)}</h1>
        </div>
        <div className="page-header__actions">
          <MonthToolbar monthKey={monthKey} onChange={onMonthChange} />
          <button className="button button--primary desktop-only" type="button" onClick={() => onNewEntry()} disabled={!canWrite}>
            <Icon name="plus" />
            {copy(locale, "calendarPage", "createEntry")}
          </button>
          <button className="button button--secondary desktop-only" type="button" onClick={() => setEditingUnavailable("new")} disabled={!canWrite}>
            <Icon name="briefcase" />
            {copy(locale, "calendarPage", "unavailability")}
          </button>
        </div>
      </div>

      <div className="calendar-quick-actions">
        <button className="button button--primary" type="button" onClick={() => onNewEntry()} disabled={!canWrite}>
          <Icon name="plus" size={17} />
          {copy(locale, "calendarPage", "care")}
        </button>
        <button className="button button--secondary" type="button" onClick={() => setEditingUnavailable("new")} disabled={!canWrite}>
          <Icon name="briefcase" size={17} />
          {copy(locale, "calendarPage", "unavailability")}
        </button>
      </div>

      <div className="calendar-view-toggle" role="group" aria-label={copy(locale, "calendarPage", "viewLabel")}>
        <button
          type="button"
          data-testid="calendar-view-agenda"
          className={view === "agenda" ? "is-active" : ""}
          onClick={() => setView("agenda")}
        >
          <Icon name="list" size={17} />
          {copy(locale, "calendarPage", "agenda")}
        </button>
        <button
          type="button"
          data-testid="calendar-view-month"
          className={view === "month" ? "is-active" : ""}
          onClick={() => setView("month")}
        >
          <Icon name="calendar" size={17} />
          {copy(locale, "calendarPage", "month")}
        </button>
      </div>

      {view === "agenda" ? (
        <CalendarAgenda
          entries={entries}
          unavailablePeriods={unavailablePeriods}
          externalEvents={externalEvents}
          children={data.children}
          onSelectDate={(date) => onNewEntry(date || undefined)}
          onSelectEntry={onEditEntry}
          onSelectUnavailable={setEditingUnavailable}
          allowCreate={canWrite}
        />
      ) : (
        <>
          <section className="panel calendar-panel calendar-panel--large" data-testid="calendar-month-view">
            <CalendarGrid
              monthKey={monthKey}
              entries={entries}
              unavailablePeriods={unavailablePeriods}
              externalEvents={externalEvents}
              children={data.children}
              onSelectDate={onNewEntry}
              onSelectEntry={onEditEntry}
              onSelectUnavailable={setEditingUnavailable}
              allowCreate={canWrite}
            />
            <div className="calendar-legend">
              {data.children.map((child) => (
                <span key={child.id}><span className="child-dot" style={{ backgroundColor: child.color }} />{child.name}</span>
              ))}
              <span><Icon name="moon" size={14} />{copy(locale, "calendarPage", "overnight")}</span>
              <span><span className="legend-line legend-line--planned" />{copy(locale, "calendarPage", "planned")}</span>
              <span><span className="legend-line legend-line--cancelled" />{copy(locale, "calendarPage", "cancelled")}</span>
            </div>
          </section>
          <p className="page-tip"><Icon name="info" size={16} /> {copy(locale, "calendarPage", "tip")}</p>
        </>
      )}

      <button className="mobile-fab" data-testid="calendar-add-entry" type="button" onClick={() => onNewEntry()} disabled={!canWrite} aria-label={copy(locale, "calendarPage", "addEntryAria")}>
        <Icon name="plus" size={21} />
        {copy(locale, "calendarPage", "addEntry")}
      </button>
      {editingUnavailable ? (
        <Modal
          title={
            editingUnavailable === "new"
              ? copy(locale, "unavailable", "createTitle")
              : copy(locale, "unavailable", "editTitle")
          }
          onClose={() => setEditingUnavailable(null)}
        >
          <UnavailablePeriodForm
            period={editingUnavailable === "new" ? undefined : editingUnavailable}
            onDone={() => setEditingUnavailable(null)}
          />
        </Modal>
      ) : null}
    </div>
  );
}
