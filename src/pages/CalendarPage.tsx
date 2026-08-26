import { useEffect, useMemo, useState } from "react";
import { CalendarAgenda } from "../components/CalendarAgenda";
import { CalendarGrid } from "../components/CalendarGrid";
import { Icon } from "../components/Icon";
import { MonthToolbar } from "../components/MonthToolbar";
import { UnavailablePeriodForm } from "../components/UnavailablePeriodForm";
import { Modal } from "../components/Modal";
import { entriesForRange, unavailablePeriodsForRange } from "../lib/analytics";
import { formatMonth } from "../lib/date";
import { rangeForMonth } from "../lib/date";
import { calendarGridRange, filterCalendarOverlayEvents } from "../lib/calendar";
import { useAppStore } from "../store/AppStore";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";
import { api } from "../lib/api";
import type { CareEntry, ExternalCalendarEvent, HolidayPeriod, UnavailablePeriod } from "../types";

function holidayPeriodsForMonth(periods: HolidayPeriod[], monthKey: string): HolidayPeriod[] {
  const range = rangeForMonth(monthKey);
  return periods.filter(
    (period) =>
      !period.deletedAt &&
      period.startDate <= range.endDate &&
      period.endDate >= range.startDate
  );
}

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
  const { data, canWrite, session } = useAppStore();
  const { locale, intlLocale } = useI18n();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [view, setView] = useState<"agenda" | "month">(() =>
    window.matchMedia("(max-width: 767px)").matches ? "agenda" : "month"
  );
  const [editingUnavailable, setEditingUnavailable] = useState<
    UnavailablePeriod | "new" | null
  >(null);
  const [externalEvents, setExternalEvents] = useState<ExternalCalendarEvent[]>([]);
  const canCreateAppointments = session.permissions?.includes("appointments:create") ?? true;
  const canManagePlanning = session.permissions?.includes("planning:manage") ?? true;
  const canViewPlanning = session.permissions?.includes("planning:view") ?? true;
  const monthRange = useMemo(() => rangeForMonth(monthKey), [monthKey]);
  const gridRange = useMemo(() => calendarGridRange(monthKey), [monthKey]);
  const monthEntries = useMemo(
    () => entriesForRange(data.entries, monthRange.startDate, monthRange.endDate),
    [data.entries, monthRange.endDate, monthRange.startDate]
  );
  const gridEntries = useMemo(
    () => entriesForRange(data.entries, gridRange.startDate, gridRange.endDate),
    [data.entries, gridRange.endDate, gridRange.startDate]
  );
  const monthHolidayPeriods = useMemo(
    () => holidayPeriodsForMonth(data.holidayPeriods, monthKey),
    [data.holidayPeriods, monthKey]
  );
  const gridHolidayPeriods = useMemo(
    () => data.holidayPeriods.filter((period) =>
      !period.deletedAt && period.startDate <= gridRange.endDate && period.endDate >= gridRange.startDate
    ),
    [data.holidayPeriods, gridRange.endDate, gridRange.startDate]
  );
  const monthUnavailablePeriods = useMemo(
    () => unavailablePeriodsForRange(
      data.unavailablePeriods,
      monthRange.startDate,
      monthRange.endDate
    ),
    [data.unavailablePeriods, monthRange.endDate, monthRange.startDate]
  );
  const gridUnavailablePeriods = useMemo(
    () => unavailablePeriodsForRange(
      data.unavailablePeriods,
      gridRange.startDate,
      gridRange.endDate
    ),
    [data.unavailablePeriods, gridRange.endDate, gridRange.startDate]
  );
  const overlayEvents = useMemo(
    () => filterCalendarOverlayEvents(externalEvents, data.externalCalendarSources),
    [data.externalCalendarSources, externalEvents]
  );
  const hasCalendarContent =
    monthEntries.length > 0 ||
    monthHolidayPeriods.length > 0 ||
    monthUnavailablePeriods.length > 0 ||
    overlayEvents.length > 0;

  useEffect(() => {
    if (!canViewPlanning) {
      setExternalEvents([]);
      return;
    }
    void api.listExternalCalendarEvents(`${gridRange.startDate}T00:00:00.000Z`, `${gridRange.endDate}T23:59:59.999Z`).then(setExternalEvents).catch(() => setExternalEvents([]));
  }, [canViewPlanning, gridRange.endDate, gridRange.startDate]);

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
          {canCreateAppointments ? <button className="button button--primary desktop-only" type="button" onClick={() => onNewEntry()} disabled={!canWrite}>
            <Icon name="plus" />
            {copy(locale, "calendarPage", "createEntry")}
          </button> : null}
          {canManagePlanning ? <button className="button button--secondary desktop-only" type="button" onClick={() => setEditingUnavailable("new")}>
            <Icon name="briefcase" />
            {copy(locale, "calendarPage", "unavailability")}
          </button> : null}
        </div>
      </div>

      {!data.careConflictsComplete ? (
        <div className="notice notice--warning" role="status" data-testid="care-conflicts-limited">
          <Icon name="alert" />
          <span>{copy(locale, "careConflict", "limited")}</span>
        </div>
      ) : null}

      <div className="calendar-quick-actions">
        {canCreateAppointments ? <button className="button button--primary" data-testid="calendar-add-entry" type="button" onClick={() => onNewEntry()} disabled={!canWrite}>
          <Icon name="plus" size={17} />
          {copy(locale, "calendarPage", "care")}
        </button> : null}
        {canManagePlanning ? <button className="button button--secondary" data-testid="calendar-add-unavailable" type="button" onClick={() => setEditingUnavailable("new")}>
          <Icon name="briefcase" size={17} />
          {copy(locale, "calendarPage", "unavailability")}
        </button> : null}
      </div>

      {!hasCalendarContent ? (
        <section className="panel empty-state" data-testid="calendar-empty-state">
          <span><Icon name="calendar" size={25} /></span>
          <h2>{copy(locale, "calendarPage", "emptyTitle")}</h2>
          <p>{copy(locale, "calendarPage", "emptyDescription")}</p>
        </section>
      ) : null}

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
          entries={monthEntries}
          unavailablePeriods={monthUnavailablePeriods}
          externalEvents={overlayEvents}
          holidayPeriods={monthHolidayPeriods}
          visibleStartDate={monthRange.startDate}
          visibleEndDate={monthRange.endDate}
          children={data.children}
          conflicts={data.careConflicts}
          canWrite={canWrite}
          onSelectDate={(date) => onNewEntry(date || undefined)}
          onSelectEntry={onEditEntry}
          onSelectUnavailable={canManagePlanning ? setEditingUnavailable : undefined}
          allowCreate={canCreateAppointments && canWrite}
        />
      ) : (
        <>
          <section className="panel calendar-panel calendar-panel--large" data-testid="calendar-month-view">
            <CalendarGrid
              monthKey={monthKey}
              entries={gridEntries}
              unavailablePeriods={gridUnavailablePeriods}
              externalEvents={overlayEvents}
              holidayPeriods={gridHolidayPeriods}
              children={data.children}
              conflicts={data.careConflicts}
              onSelectDate={onNewEntry}
              onSelectEntry={onEditEntry}
              onSelectUnavailable={canManagePlanning ? setEditingUnavailable : undefined}
              allowCreate={canCreateAppointments && canWrite}
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

      {editingUnavailable && canManagePlanning ? (
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
