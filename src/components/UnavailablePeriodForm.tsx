import { useMemo, useState, type FormEvent } from "react";
import { unavailableCategoryLabels } from "../lib/labels";
import { toDateKey } from "../lib/date";
import { useAppStore } from "../store/AppStore";
import type { UnavailableCategory, UnavailablePeriod } from "../types";
import { FieldHelpLabel } from "./FieldHelp";
import { Icon } from "./Icon";

function localParts(value?: string): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { date: value.slice(0, 10), time: value.slice(11, 16) };
  }
  const offset = date.getTimezoneOffset() * 60_000;
  const local = new Date(date.getTime() - offset).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function fromInputValue(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

export function UnavailablePeriodForm({
  period,
  initialDate,
  onDone
}: {
  period?: UnavailablePeriod;
  initialDate?: string;
  onDone: () => void;
}) {
  const { saveUnavailablePeriod } = useAppStore();
  const today = toDateKey(new Date());
  const initialStart = localParts(period?.startDateTime);
  const initialEnd = localParts(period?.endDateTime);
  const [startDate, setStartDate] = useState(
    initialStart.date || initialDate || today
  );
  const [startTime, setStartTime] = useState(initialStart.time || "08:00");
  const [endDate, setEndDate] = useState(initialEnd.date || initialDate || today);
  const [endTime, setEndTime] = useState(initialEnd.time || "17:00");
  const [category, setCategory] = useState<UnavailableCategory>(
    period?.category ?? "duty"
  );
  const [dutyRelated, setDutyRelated] = useState(period?.dutyRelated ?? true);
  const [affectsContact, setAffectsContact] = useState(
    period?.affectsContact ?? false
  );
  const [affectsHolidays, setAffectsHolidays] = useState(
    period?.affectsHolidays ?? false
  );
  const [location, setLocation] = useState(period?.location ?? "");
  const [notes, setNotes] = useState(period?.notes ?? "");
  const [hasEvidence, setHasEvidence] = useState(period?.hasEvidence ?? false);
  const [evidenceReference, setEvidenceReference] = useState(
    period?.evidenceReference ?? ""
  );
  const [error, setError] = useState("");

  const recommendations = useMemo(() => {
    const messages: string[] = [];
    if (category === "other" && !notes.trim()) {
      messages.push("Bei „Sonstiges“ wird eine kurze Notiz empfohlen.");
    }
    if (dutyRelated && !evidenceReference.trim()) {
      messages.push(
        "Bei dienstlicher Veranlassung wird eine Belegreferenz empfohlen."
      );
    }
    return messages;
  }, [category, dutyRelated, evidenceReference, notes]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!startDate || !startTime || !endDate || !endTime) {
      setError("Bitte Beginn und Ende vollständig angeben.");
      return;
    }
    const startDateTime = fromInputValue(startDate, startTime);
    const endDateTime = fromInputValue(endDate, endTime);
    if (new Date(endDateTime) <= new Date(startDateTime)) {
      setError("Das Ende muss nach dem Beginn liegen.");
      return;
    }
    const saved = saveUnavailablePeriod({
      id: period?.id,
      startDateTime,
      endDateTime,
      category,
      dutyRelated,
      affectsContact,
      affectsHolidays,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      hasEvidence,
      evidenceReference: evidenceReference.trim() || undefined
    });
    if (saved) onDone();
  };

  return (
    <form className="child-form unavailable-form" onSubmit={submit}>
      <section className="form-section">
        <h3>Zeitraum und Kategorie</h3>
        <div className="datetime-grid">
          <label className="field">
            <FieldHelpLabel fieldId="unavailable.startDateTime">Beginn Datum</FieldHelpLabel>
            <input
              autoFocus
              required
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="unavailable.startDateTime">Beginn Uhrzeit</FieldHelpLabel>
            <input
              required
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="unavailable.endDateTime">Ende Datum</FieldHelpLabel>
            <input
              required
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="unavailable.endDateTime">Ende Uhrzeit</FieldHelpLabel>
            <input
              required
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
            />
          </label>
        </div>
        <label className="field">
          <FieldHelpLabel fieldId="unavailable.category" />
          <select
            required
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as UnavailableCategory)
            }
          >
            {Object.entries(unavailableCategoryLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="form-section">
        <h3>Auswirkungen</h3>
        <div className="unavailable-toggle-list">
          <label className="toggle">
            <input
              type="checkbox"
              checked={dutyRelated}
              onChange={(event) => setDutyRelated(event.target.checked)}
            />
            <span />
            <FieldHelpLabel fieldId="unavailable.dutyRelated" />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={affectsContact}
              onChange={(event) => setAffectsContact(event.target.checked)}
            />
            <span />
            <FieldHelpLabel fieldId="unavailable.affectsContact" />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={affectsHolidays}
              onChange={(event) => setAffectsHolidays(event.target.checked)}
            />
            <span />
            <FieldHelpLabel fieldId="unavailable.affectsHolidays" />
          </label>
        </div>
      </section>

      <section className="form-section">
        <h3>Ort, Notiz und Beleg</h3>
        <label className="field">
          <FieldHelpLabel fieldId="unavailable.location" />
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="z. B. Dienststätte, Lehrgangsort"
          />
        </label>
        <label className="field">
          <FieldHelpLabel fieldId="unavailable.notes" />
          <textarea
            rows={4}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Sachliche ergänzende Angaben"
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={hasEvidence}
            onChange={(event) => setHasEvidence(event.target.checked)}
          />
          <FieldHelpLabel fieldId="unavailable.hasEvidence" />
        </label>
        <label className="field">
          <FieldHelpLabel fieldId="unavailable.evidenceReference" />
          <input
            value={evidenceReference}
            onChange={(event) => setEvidenceReference(event.target.value)}
            placeholder="z. B. Dienstplan 06/2026"
          />
        </label>
      </section>

      {recommendations.length ? (
        <div className="notice notice--recommendation">
          <Icon name="info" size={18} />
          <div>
            <strong>Dokumentationsempfehlung</strong>
            {recommendations.map((message) => <p key={message}>{message}</p>)}
          </div>
        </div>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <footer className="form-actions">
        <span />
        <div className="form-actions__right">
          <button className="button button--secondary" type="button" onClick={onDone}>
            Abbrechen
          </button>
          <button className="button button--primary" type="submit">
            Nichtverfügbarkeit speichern
          </button>
        </div>
      </footer>
    </form>
  );
}
