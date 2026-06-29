import { useMemo, useState, type FormEvent } from "react";
import { dateTimeRangesOverlap } from "../lib/analytics";
import { unavailableCategoryLabel } from "../lib/labels";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";
import { rangesOverlap, toDateKey } from "../lib/date";
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
  const { locale } = useI18n();
  const { data, saveUnavailablePeriod, canWrite, isSaving } = useAppStore();
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

  const derivedImpact = useMemo(() => {
    if (!startDate || !startTime || !endDate || !endTime) {
      return { plannedContactCount: 0, holidayCount: 0 };
    }
    const startDateTime = fromInputValue(startDate, startTime);
    const endDateTime = fromInputValue(endDate, endTime);
    if (new Date(endDateTime) <= new Date(startDateTime)) {
      return { plannedContactCount: 0, holidayCount: 0 };
    }
    return {
      plannedContactCount: data.entries.filter(
        (entry) =>
          !entry.deletedAt &&
          Boolean(entry.generatedByPatternId) &&
          dateTimeRangesOverlap(
            entry.startDateTime,
            entry.endDateTime,
            startDateTime,
            endDateTime
          )
      ).length,
      holidayCount: data.holidayPeriods.filter(
        (holiday) =>
          !holiday.deletedAt &&
          rangesOverlap(startDate, endDate, holiday.startDate, holiday.endDate)
      ).length
    };
  }, [
    data.entries,
    data.holidayPeriods,
    endDate,
    endTime,
    startDate,
    startTime
  ]);

  const recommendations = useMemo(() => {
    const messages: string[] = [];
    if (category === "other" && !notes.trim()) {
      messages.push(copy(locale, "unavailable", "otherNoteRecommendation"));
    }
    if (dutyRelated && !evidenceReference.trim()) {
      messages.push(
        copy(locale, "unavailable", "dutyEvidenceRecommendation")
      );
    }
    if (derivedImpact.plannedContactCount > 0 && !affectsContact) {
      messages.push(
        copy(locale, "unavailable", "contactImpactRecommendation", {
          count: derivedImpact.plannedContactCount
        })
      );
    }
    if (derivedImpact.holidayCount > 0 && !affectsHolidays) {
      messages.push(
        copy(locale, "unavailable", "holidayImpactRecommendation", {
          count: derivedImpact.holidayCount
        })
      );
    }
    return messages;
  }, [
    affectsContact,
    affectsHolidays,
    category,
    derivedImpact.holidayCount,
    derivedImpact.plannedContactCount,
    dutyRelated,
    evidenceReference,
    locale,
    notes
  ]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!startDate || !startTime || !endDate || !endTime) {
      setError(copy(locale, "unavailable", "completePeriod"));
      return;
    }
    const startDateTime = fromInputValue(startDate, startTime);
    const endDateTime = fromInputValue(endDate, endTime);
    if (new Date(endDateTime) <= new Date(startDateTime)) {
      setError(copy(locale, "unavailable", "endAfterStart"));
      return;
    }
    const saved = await saveUnavailablePeriod({
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
    <form className="child-form unavailable-form" data-testid="unavailable-form" onSubmit={submit}>
      <section className="form-section">
        <h3>{copy(locale, "unavailable", "periodCategory")}</h3>
        <div className="datetime-grid">
          <label className="field">
            <FieldHelpLabel fieldId="unavailable.startDateTime">{copy(locale, "entryForm", "startDate")}</FieldHelpLabel>
            <input
              autoFocus
              required
              data-testid="unavailable-start-date"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="unavailable.startDateTime">{copy(locale, "entryForm", "startTime")}</FieldHelpLabel>
            <input
              required
              data-testid="unavailable-start-time"
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="unavailable.endDateTime">{copy(locale, "entryForm", "endDate")}</FieldHelpLabel>
            <input
              required
              data-testid="unavailable-end-date"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="unavailable.endDateTime">{copy(locale, "entryForm", "endTime")}</FieldHelpLabel>
            <input
              required
              data-testid="unavailable-end-time"
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
            data-testid="unavailable-category"
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as UnavailableCategory)
            }
          >
            {(["duty", "training_course", "exercise", "guard_duty", "standby", "deployment", "business_trip", "illness", "private_unavailability", "vacation_without_children", "other"] as UnavailableCategory[]).map((value) => (
              <option key={value} value={value}>{unavailableCategoryLabel(value, locale)}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="form-section">
        <h3>{copy(locale, "unavailable", "effects")}</h3>
        <p className="section-copy">{copy(locale, "unavailable", "effectsDescription")}</p>
        <div className="derived-impact" data-testid="unavailable-derived-impact">
          <strong>{copy(locale, "unavailable", "derivedImpactTitle")}</strong>
          {derivedImpact.plannedContactCount > 0 ? (
            <p>
              {affectsContact
                ? copy(locale, "unavailable", "contactImpactConfirmed", {
                    count: derivedImpact.plannedContactCount
                  })
                : copy(locale, "unavailable", "contactImpactFound", {
                    count: derivedImpact.plannedContactCount
                  })}
            </p>
          ) : null}
          {derivedImpact.holidayCount > 0 ? (
            <p>
              {affectsHolidays
                ? copy(locale, "unavailable", "holidayImpactConfirmed", {
                    count: derivedImpact.holidayCount
                  })
                : copy(locale, "unavailable", "holidayImpactFound", {
                    count: derivedImpact.holidayCount
                  })}
            </p>
          ) : null}
          {derivedImpact.plannedContactCount === 0 && derivedImpact.holidayCount === 0 ? (
            <p>{copy(locale, "unavailable", "noDerivedImpact")}</p>
          ) : null}
        </div>
        <div className="unavailable-toggle-list">
          <label className="toggle">
            <input
              type="checkbox"
              data-testid="unavailable-duty-related"
              checked={dutyRelated}
              onChange={(event) => setDutyRelated(event.target.checked)}
            />
            <span />
            <FieldHelpLabel fieldId="unavailable.dutyRelated" />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              data-testid="unavailable-affects-contact"
              checked={affectsContact}
              onChange={(event) => setAffectsContact(event.target.checked)}
            />
            <span />
            <FieldHelpLabel fieldId="unavailable.affectsContact" />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              data-testid="unavailable-affects-holidays"
              checked={affectsHolidays}
              onChange={(event) => setAffectsHolidays(event.target.checked)}
            />
            <span />
            <FieldHelpLabel fieldId="unavailable.affectsHolidays" />
          </label>
        </div>
      </section>

      <section className="form-section">
        <h3>{copy(locale, "unavailable", "locationNotesEvidence")}</h3>
        <label className="field">
          <FieldHelpLabel fieldId="unavailable.location" />
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder={copy(locale, "unavailable", "locationPlaceholder")}
          />
        </label>
        <label className="field">
          <FieldHelpLabel fieldId="unavailable.notes" />
          <textarea
            rows={4}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={copy(locale, "unavailable", "notesPlaceholder")}
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
            placeholder={copy(locale, "unavailable", "evidencePlaceholder")}
          />
        </label>
      </section>

      {recommendations.length ? (
        <div className="notice notice--recommendation">
          <Icon name="info" size={18} />
          <div>
            <strong>{copy(locale, "unavailable", "recommendation")}</strong>
            {recommendations.map((message) => <p key={message}>{message}</p>)}
          </div>
        </div>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <footer className="form-actions">
        <span />
        <div className="form-actions__right">
          <button className="button button--secondary" type="button" onClick={onDone}>
            {copy(locale, "common", "cancel")}
          </button>
          <button className="button button--primary" type="submit" data-testid="unavailable-submit" disabled={!canWrite || isSaving}>
            {copy(locale, "unavailable", "save")}
          </button>
        </div>
      </footer>
    </form>
  );
}
