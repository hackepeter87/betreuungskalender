import { useMemo, useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { FieldHelpButton, FieldHelpLabel } from "../components/FieldHelp";
import { Modal } from "../components/Modal";
import {
  calculateContactStats,
  entriesForRange,
  unavailableForEntry
} from "../lib/analytics";
import { formatDate, formatTime, rangeForYear, toDateKey } from "../lib/date";
import { statusLabels } from "../lib/labels";
import { useAppStore } from "../store/AppStore";
import type { CareEntry } from "../types";

function nextFriday(): string {
  const date = new Date();
  const distance = (5 - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + distance);
  return toDateKey(date);
}

export function ContactPage({
  onEditEntry,
  onNewEntry
}: {
  onEditEntry: (entry: CareEntry) => void;
  onNewEntry: () => void;
}) {
  const {
    data,
    saveContactPattern,
    generateContactEntries,
    updateEntryStatus,
    canWrite,
    isSaving
  } = useAppStore();
  const existingPattern = data.contactPatterns[0];
  const currentYear = new Date().getFullYear();
  const defaultRange = rangeForYear(currentYear);
  const [patternId, setPatternId] = useState(existingPattern?.id);
  const [name, setName] = useState(existingPattern?.name ?? "14-Tage-Regel");
  const [startDate, setStartDate] = useState(existingPattern?.startDate ?? nextFriday());
  const [fridayStartTime, setFridayStartTime] = useState(
    existingPattern?.fridayStartTime ?? "16:00"
  );
  const [sundayEndTime, setSundayEndTime] = useState(
    existingPattern?.sundayEndTime ?? "18:00"
  );
  const [childIds, setChildIds] = useState<string[]>(
    existingPattern?.childIds ?? data.children.map((child) => child.id)
  );
  const [active, setActive] = useState(existingPattern?.active ?? true);
  const [generationStart, setGenerationStart] = useState(defaultRange.startDate);
  const [generationEnd, setGenerationEnd] = useState(defaultRange.endDate);
  const [message, setMessage] = useState("");
  const [cancelEntry, setCancelEntry] = useState<CareEntry | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const stats = useMemo(
    () =>
      calculateContactStats(
        data.entries,
        data.unavailablePeriods,
        generationStart,
        generationEnd
      ),
    [data.entries, data.unavailablePeriods, generationEnd, generationStart]
  );
  const relevantEntries = useMemo(
    () =>
      entriesForRange(data.entries, generationStart, generationEnd)
        .filter((entry) => entry.generatedByPatternId || entry.additionalCare)
        .slice()
        .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime)),
    [data.entries, generationEnd, generationStart]
  );

  const saveRule = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!childIds.length) {
      setMessage("Bitte mindestens ein Kind für die Umgangsregel auswählen.");
      return;
    }
    const startDay = new Date(`${startDate}T12:00:00`).getDay();
    if (startDay !== 5) {
      setMessage("Das Startdatum der Regel muss ein Freitag sein.");
      return;
    }
    const id = await saveContactPattern({
      id: patternId,
      name: name.trim() || "14-Tage-Regel",
      startDate,
      frequency: "biweekly",
      fridayStartTime,
      sundayEndTime,
      childIds,
      active
    });
    if (id) {
      setPatternId(id);
      setMessage("Umgangsregel gespeichert.");
    }
  };

  const generate = async () => {
    if (!patternId) {
      setMessage("Bitte die Umgangsregel zuerst speichern.");
      return;
    }
    if (generationEnd < generationStart) {
      setMessage("Der Generierungszeitraum ist ungültig.");
      return;
    }
    const count = await generateContactEntries(
      patternId,
      generationStart,
      generationEnd
    );
    setMessage(
      count === -1
        ? "Die Erzeugung wurde abgebrochen."
        : count
        ? `${count} geplante Umgangstermine wurden erzeugt.`
        : "Keine neuen Termine erzeugt. Bestehende Soll-Termine werden nicht dupliziert."
    );
  };

  const confirmCancellation = async (event: FormEvent) => {
    event.preventDefault();
    if (!cancelEntry || !cancelReason.trim()) return;
    if (await updateEntryStatus(cancelEntry.id, "cancelled", cancelReason)) {
      setCancelEntry(null);
      setCancelReason("");
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="page-header__context">Soll-Ist-Vergleich</p>
          <h1>Umgangsregel</h1>
        </div>
        <button className="button button--secondary no-print" type="button" onClick={onNewEntry} disabled={!canWrite || isSaving}>
          <Icon name="plus" size={17} />
          Zusatzbetreuung erfassen
        </button>
      </div>

      {data.children.length === 0 ? (
        <section className="notice notice--warning">
          <Icon name="alert" />
          <p>Für eine Umgangsregel muss zuerst mindestens ein Kind angelegt werden.</p>
        </section>
      ) : null}

      <div className="two-column-layout">
        <form className="panel rule-form" onSubmit={saveRule}>
          <div className="panel__header">
            <div>
              <h2>14-Tage-Regel Freitag bis Sonntag</h2>
              <p>Das Startdatum legt den Rhythmus der geplanten Wochenenden fest.</p>
            </div>
          </div>
          <div className="panel-form">
            <label className="field">
              <FieldHelpLabel fieldId="contactPattern.name">Bezeichnung</FieldHelpLabel>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <div className="form-grid">
              <label className="field">
                <FieldHelpLabel fieldId="contactPattern.startDate">
                  Startdatum (Freitag)
                </FieldHelpLabel>
                <input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </label>
              <label className="field">
                <FieldHelpLabel fieldId="contactPattern.fridayStartTime" />
                <input type="time" required value={fridayStartTime} onChange={(event) => setFridayStartTime(event.target.value)} />
              </label>
              <label className="field">
                <FieldHelpLabel fieldId="contactPattern.sundayEndTime" />
                <input type="time" required value={sundayEndTime} onChange={(event) => setSundayEndTime(event.target.value)} />
              </label>
            </div>
            <fieldset className="inline-fieldset">
              <legend className="field-label-row">
                <span>Kinder</span>
                <FieldHelpButton fieldId="contactPattern.children" />
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
            <label className="toggle">
              <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
              <span />
              <FieldHelpLabel fieldId="contactPattern.active" />
            </label>
            <button className="button button--primary" type="submit" disabled={!data.children.length || !canWrite || isSaving}>
              <Icon name="check" size={17} />
              Regel speichern
            </button>
          </div>
        </form>

        <section className="panel generator-panel">
          <div className="panel__header">
            <div>
              <h2>Soll-Termine generieren</h2>
              <p>Vorhandene Termine derselben Regel werden nicht dupliziert.</p>
            </div>
          </div>
          <div className="panel-form">
            <div className="form-grid form-grid--two">
              <label className="field">
                <FieldHelpLabel fieldId="contactPattern.generationRange">Von</FieldHelpLabel>
                <input type="date" value={generationStart} onChange={(event) => setGenerationStart(event.target.value)} />
              </label>
              <label className="field">
                <FieldHelpLabel fieldId="contactPattern.generationRange">Bis</FieldHelpLabel>
                <input type="date" value={generationEnd} onChange={(event) => setGenerationEnd(event.target.value)} />
              </label>
            </div>
            <button className="button button--primary" type="button" onClick={() => void generate()} disabled={!patternId || !canWrite || isSaving}>
              <Icon name="repeat" size={17} />
              Termine erzeugen
            </button>
            <FieldHelpButton fieldId="contactPattern.duplicatePrevention" showRequirement={false} />
            {message ? <p className="inline-message" role="status">{message}</p> : null}
          </div>
        </section>
      </div>

      <section className="summary-strip summary-strip--six">
        <div><small>Soll-Termine</small><strong>{stats.scheduled}</strong></div>
        <div><small>Noch geplant</small><strong>{stats.pending}</strong></div>
        <div><small>Durchgeführt</small><strong>{stats.completed}</strong></div>
        <div><small>Dienstlich ausgefallen</small><strong>{stats.cancelledDutyRelated}</strong></div>
        <div><small>Sonstig ausgefallen</small><strong>{stats.cancelledOther}</strong></div>
        <div><small>Zusätzlich</small><strong>{stats.additional}</strong></div>
      </section>

      {stats.unavailableOverlaps ? (
        <section className="notice notice--recommendation">
          <Icon name="briefcase" />
          <div>
            <strong>{stats.unavailableOverlaps} Überschneidung(en) dokumentiert</strong>
            <p>Nichtverfügbarkeiten werden gesondert ausgewiesen und nicht automatisch als nicht wahrgenommene Betreuung bewertet.</p>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>Soll-Ist-Termine</h2>
            <p>{formatDate(generationStart)} bis {formatDate(generationEnd)}</p>
          </div>
        </div>
        <div className="rule-entry-list">
          {relevantEntries.map((entry) => {
            const overlaps = entry.generatedByPatternId
              ? unavailableForEntry(entry, data.unavailablePeriods, {
                  affectsContactOnly: true
                })
              : [];
            return (
            <article className="rule-entry" key={entry.id}>
              <button className="rule-entry__main" type="button" onClick={() => onEditEntry(entry)}>
                <span>
                  <strong>{formatDate(entry.startDateTime)}</strong>
                  <small>{formatTime(entry.startDateTime)} bis {formatDate(entry.endDateTime)}, {formatTime(entry.endDateTime)}</small>
                </span>
                <span>
                  <strong>{entry.childIds.map((id) => data.children.find((child) => child.id === id)?.name).filter(Boolean).join(" und ")}</strong>
                  <small>{entry.additionalCare ? "Zusatzbetreuung" : "14-Tage-Regel"}</small>
                </span>
                <span className={`status-label status-label--${entry.status}`}>
                  {entry.additionalCare ? "Zusätzlich" : statusLabels[entry.status]}
                </span>
                {overlaps.length ? (
                  <span className="rule-entry__overlap">
                    <Icon name="alert" size={15} />
                    Dieser geplante Umgang überschneidet sich mit einer dokumentierten Nichtverfügbarkeit.
                  </span>
                ) : null}
              </button>
              {entry.generatedByPatternId ? (
                <div className="rule-entry__actions">
                  <button className="button button--quiet" type="button" onClick={() => void updateEntryStatus(entry.id, "completed")} disabled={!canWrite || isSaving}>
                    <Icon name="check" size={15} />
                    Durchgeführt
                  </button>
                  <button className="button button--danger-quiet" type="button" onClick={() => { setCancelEntry(entry); setCancelReason(entry.cancellationReason ?? ""); }} disabled={!canWrite || isSaving}>
                    <Icon name="close" size={15} />
                    Ausgefallen
                  </button>
                  <FieldHelpButton fieldId="contactPattern.confirmCompleted" showRequirement={false} />
                  <FieldHelpButton fieldId="contactPattern.markCancelled" showRequirement={false} />
                </div>
              ) : null}
            </article>
            );
          })}
          {relevantEntries.length === 0 ? <p className="empty-copy empty-copy--padded">In diesem Zeitraum sind noch keine Soll- oder Zusatztermine dokumentiert.</p> : null}
        </div>
      </section>

      {cancelEntry ? (
        <Modal title="Umgang als ausgefallen markieren" onClose={() => setCancelEntry(null)}>
          <form className="child-form" onSubmit={confirmCancellation}>
            <label className="field">
              <FieldHelpLabel fieldId="careEntry.cancellationReason" />
              <textarea autoFocus required rows={4} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
            </label>
            <footer className="form-actions">
              <span />
              <div className="form-actions__right">
                <button className="button button--secondary" type="button" onClick={() => setCancelEntry(null)}>Abbrechen</button>
                <button className="button button--primary" type="submit" disabled={!canWrite || isSaving}>Ausfall speichern</button>
              </div>
            </footer>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
