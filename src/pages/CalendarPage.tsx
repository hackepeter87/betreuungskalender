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
import type { CareEntry, UnavailablePeriod } from "../types";

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
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [view, setView] = useState<"agenda" | "month">(() =>
    window.matchMedia("(max-width: 767px)").matches ? "agenda" : "month"
  );
  const [editingUnavailable, setEditingUnavailable] = useState<
    UnavailablePeriod | "new" | null
  >(null);
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
    setView(isMobile ? "agenda" : "month");
  }, [isMobile]);

  return (
    <div className="page page--calendar" data-testid="page-calendar">
      <div className="page-header">
        <div>
          <p className="page-header__context">Kalender</p>
          <h1>{formatMonth(monthKey)}</h1>
        </div>
        <div className="page-header__actions">
          <MonthToolbar monthKey={monthKey} onChange={onMonthChange} />
          <button className="button button--primary desktop-only" type="button" onClick={() => onNewEntry()} disabled={!canWrite}>
            <Icon name="plus" />
            Eintrag erfassen
          </button>
          <button className="button button--secondary desktop-only" type="button" onClick={() => setEditingUnavailable("new")} disabled={!canWrite}>
            <Icon name="briefcase" />
            Nichtverfügbarkeit
          </button>
        </div>
      </div>

      <div className="calendar-quick-actions">
        <button className="button button--primary" type="button" onClick={() => onNewEntry()} disabled={!canWrite}>
          <Icon name="plus" size={17} />
          Betreuung
        </button>
        <button className="button button--secondary" type="button" onClick={() => setEditingUnavailable("new")} disabled={!canWrite}>
          <Icon name="briefcase" size={17} />
          Nichtverfügbarkeit
        </button>
      </div>

      <div className="calendar-view-toggle" role="group" aria-label="Kalenderansicht">
        <button
          type="button"
          data-testid="calendar-view-agenda"
          className={view === "agenda" ? "is-active" : ""}
          onClick={() => setView("agenda")}
        >
          <Icon name="list" size={17} />
          Agenda
        </button>
        <button
          type="button"
          data-testid="calendar-view-month"
          className={view === "month" ? "is-active" : ""}
          onClick={() => setView("month")}
        >
          <Icon name="calendar" size={17} />
          Monat
        </button>
      </div>

      {view === "agenda" ? (
        <CalendarAgenda
          entries={entries}
          unavailablePeriods={unavailablePeriods}
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
              <span><Icon name="moon" size={14} />Übernachtung</span>
              <span><span className="legend-line legend-line--planned" />geplant</span>
              <span><span className="legend-line legend-line--cancelled" />ausgefallen</span>
            </div>
          </section>
          <p className="page-tip"><Icon name="info" size={16} /> Tippe auf einen Tag für einen neuen Eintrag oder auf einen bestehenden Balken zum Bearbeiten.</p>
        </>
      )}

      <button className="mobile-fab" data-testid="calendar-add-entry" type="button" onClick={() => onNewEntry()} disabled={!canWrite} aria-label="Betreuungseintrag hinzufügen">
        <Icon name="plus" size={21} />
        Eintrag hinzufügen
      </button>
      {editingUnavailable ? (
        <Modal
          title={
            editingUnavailable === "new"
              ? "Nichtverfügbarkeit erfassen"
              : "Nichtverfügbarkeit bearbeiten"
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
