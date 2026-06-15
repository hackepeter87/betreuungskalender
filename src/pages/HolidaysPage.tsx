import { useMemo, useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { FieldHelpButton, FieldHelpLabel } from "../components/FieldHelp";
import { Modal } from "../components/Modal";
import {
  PeriodSelector,
  periodSelection,
  type PeriodSelection
} from "../components/PeriodSelector";
import { calculateHolidayStats } from "../lib/analytics";
import { formatDate, toMonthKey } from "../lib/date";
import { holidayAssignmentLabels } from "../lib/labels";
import { useAppStore } from "../store/AppStore";
import type { HolidayPeriod } from "../types";

function HolidayForm({
  period,
  onDone
}: {
  period?: HolidayPeriod;
  onDone: () => void;
}) {
  const { data, saveHolidayPeriod, canWrite, isSaving } = useAppStore();
  const [name, setName] = useState(period?.name ?? "Ferienblock");
  const [startDate, setStartDate] = useState(period?.startDate ?? "");
  const [endDate, setEndDate] = useState(period?.endDate ?? "");
  const [assignedTo, setAssignedTo] = useState<HolidayPeriod["assignedTo"]>(
    period?.assignedTo ?? "father"
  );
  const [childIds, setChildIds] = useState<string[]>(
    period?.childIds ?? data.children.map((child) => child.id)
  );
  const [notes, setNotes] = useState(period?.notes ?? "");
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!startDate || !endDate || endDate < startDate) {
      setError("Bitte einen gültigen Ferienzeitraum eingeben.");
      return;
    }
    if (data.children.length && !childIds.length) {
      setError("Bitte mindestens ein Kind auswählen.");
      return;
    }
    const saved = await saveHolidayPeriod({
      id: period?.id,
      name: name.trim() || "Ferienblock",
      startDate,
      endDate,
      childIds,
      assignedTo,
      notes: notes.trim() || undefined
    });
    if (saved) onDone();
  };

  return (
    <form className="child-form" data-testid="holiday-form" onSubmit={submit}>
      <label className="field">
        <FieldHelpLabel fieldId="holiday.name" />
        <input data-testid="holiday-name" autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="z. B. Sommerferien Block 1" />
      </label>
      <div className="form-grid form-grid--two">
        <label className="field">
          <FieldHelpLabel fieldId="holiday.startDate">Von</FieldHelpLabel>
          <input data-testid="holiday-start-date" type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label className="field">
          <FieldHelpLabel fieldId="holiday.endDate">Bis</FieldHelpLabel>
          <input data-testid="holiday-end-date" type="date" required value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
      </div>
      <label className="field">
        <FieldHelpLabel fieldId="holiday.assignedTo" />
        <select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value as HolidayPeriod["assignedTo"])}>
          {Object.entries(holidayAssignmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <fieldset className="inline-fieldset">
        <legend className="field-label-row">
          <span>Kinder</span>
          <FieldHelpButton fieldId="holiday.children" />
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
      <label className="field">
        <FieldHelpLabel fieldId="holiday.notes" />
        <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <footer className="form-actions">
        <span />
        <div className="form-actions__right">
          <button className="button button--secondary" type="button" onClick={onDone}>Abbrechen</button>
          <button className="button button--primary" data-testid="holiday-submit" type="submit" disabled={!canWrite || isSaving}>Ferienblock speichern</button>
        </div>
      </footer>
    </form>
  );
}

export function HolidaysPage() {
  const { data, removeHolidayPeriod, canWrite } = useAppStore();
  const [selection, setSelection] = useState<PeriodSelection>(() =>
    periodSelection("year", toMonthKey(new Date()))
  );
  const [editing, setEditing] = useState<HolidayPeriod | "new" | null>(null);
  const stats = useMemo(
    () =>
      calculateHolidayStats(
        data.holidayPeriods,
        selection.startDate,
        selection.endDate,
        undefined,
        data.unavailablePeriods
      ),
    [data.holidayPeriods, data.unavailablePeriods, selection.endDate, selection.startDate]
  );

  const periods = useMemo(
    () =>
      data.holidayPeriods
        .filter((period) => !period.deletedAt)
        .filter(
          (period) =>
            period.startDate <= selection.endDate &&
            period.endDate >= selection.startDate
        )
        .slice()
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [data.holidayPeriods, selection.endDate, selection.startDate]
  );

  const remove = async (period: HolidayPeriod) => {
    if (window.confirm(`Ferienblock „${period.name}“ als gelöscht markieren? Die Änderung bleibt im Protokoll erhalten.`)) {
      await removeHolidayPeriod(period.id);
    }
  };

  return (
    <div className="page" data-testid="page-holidays">
      <div className="page-header">
        <div>
          <p className="page-header__context">Ferienaufteilung</p>
          <h1>Ferienverwaltung</h1>
        </div>
        <button className="button button--primary no-print" data-testid="holiday-add" type="button" onClick={() => setEditing("new")} disabled={!canWrite}>
          <Icon name="plus" size={17} />
          Ferienblock erfassen
        </button>
      </div>

      <PeriodSelector value={selection} onChange={setSelection} />

      <section className="summary-strip summary-strip--five">
        <div><small>Ferientage gesamt</small><strong>{stats.totalDays}</strong></div>
        <div><small>Beim Vater</small><strong>{stats.fatherDays}</strong></div>
        <div><small>Bei der Mutter</small><strong>{stats.motherDays}</strong></div>
        <div><small>Vaterquote</small><strong>{stats.fatherQuote} %</strong></div>
        <div><small>Hälfte / Abweichung</small><strong>{stats.halfTarget} / {stats.differenceFromHalf > 0 ? "+" : ""}{stats.differenceFromHalf}</strong></div>
      </section>

      {stats.unavailablePeriods > 0 ? (
        <section className="notice notice--recommendation">
          <Icon name="briefcase" />
          <div>
            <strong>Dienstliche Nichtverfügbarkeit</strong>
            <p>Im Ferienzeitraum lagen dokumentierte Nichtverfügbarkeiten vor. Die hälftige Ferienquote wird weiterhin aus der dokumentierten tatsächlichen Betreuung berechnet.</p>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>Erfasste Ferienblöcke</h2>
            <p>Geteilte Tage werden bei Vater und Mutter jeweils mit einem halben Tag berücksichtigt.</p>
          </div>
        </div>
        <div className="holiday-list">
          {periods.map((period) => (
            <article className="holiday-row" key={period.id}>
              <span className={`holiday-row__assignment holiday-row__assignment--${period.assignedTo}`}>
                {holidayAssignmentLabels[period.assignedTo]}
              </span>
              <span>
                <strong>{period.name}</strong>
                <small>{formatDate(period.startDate)} bis {formatDate(period.endDate)}</small>
              </span>
              <span>
                <strong>{period.childIds.map((id) => data.children.find((child) => child.id === id)?.name).filter(Boolean).join(", ") || "Alle Kinder"}</strong>
                <small>{period.notes || "Keine Notiz"}</small>
              </span>
              <span className="holiday-row__actions">
                <button className="icon-button icon-button--bordered" type="button" onClick={() => setEditing(period)} aria-label={`${period.name} bearbeiten`}>
                  <Icon name="edit" size={16} />
                </button>
                <button className="icon-button icon-button--bordered icon-button--danger" type="button" onClick={() => void remove(period)} disabled={!canWrite} aria-label={`${period.name} löschen`}>
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </article>
          ))}
          {periods.length === 0 ? <p className="empty-copy empty-copy--padded">Für den gewählten Zeitraum sind keine Ferienblöcke erfasst.</p> : null}
        </div>
      </section>

      {editing ? (
        <Modal title={editing === "new" ? "Ferienblock erfassen" : "Ferienblock bearbeiten"} onClose={() => setEditing(null)}>
          <HolidayForm period={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />
        </Modal>
      ) : null}
    </div>
  );
}
