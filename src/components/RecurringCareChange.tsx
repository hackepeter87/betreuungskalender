import { useState, type FormEvent } from "react";
import type { ApiContactRuleChangePreview } from "../../shared/api";
import { copy } from "../i18n/catalog";
import { useI18n } from "../i18n/I18nProvider";
import { api, ApiError } from "../lib/api";
import { formatDate } from "../lib/date";
import { buildSeriesChangeRequest } from "../lib/recurringCareChange";
import { useAppStore } from "../store/AppStore";
import type { CareEntry, ContactRule } from "../types";
import { isValidTimedRange } from "../../shared/temporal";
import { Icon } from "./Icon";

function dateTimeParts(value: string): { date: string; time: string } {
  const [date = "", time = "00:00"] = value.split("T");
  return { date, time: time.slice(0, 5) };
}

export function RecurringCareScopeChoice({
  onOccurrence,
  onSeries,
  onCancel
}: {
  onOccurrence: () => void;
  onSeries: () => void;
  onCancel: () => void;
}) {
  const { locale } = useI18n();
  return (
    <div className="entry-form" data-testid="rule-entry-edit-choice">
      <div className="notice">
        <Icon name="repeat" />
        <div>
          <p>{copy(locale, "recurringCareChange", "scopeDescription")}</p>
        </div>
      </div>
      <div className="deviation-choice-grid" role="group" aria-label={copy(locale, "recurringCareChange", "scopeTitle")}>
        <button className="choice-card choice-card--stacked" data-testid="rule-entry-scope-occurrence" type="button" onClick={onOccurrence}>
          <strong>{copy(locale, "recurringCareChange", "occurrenceTitle")}</strong>
          <span>{copy(locale, "recurringCareChange", "occurrenceDescription")}</span>
        </button>
        <button className="choice-card choice-card--stacked" data-testid="rule-entry-scope-series" type="button" onClick={onSeries}>
          <strong>{copy(locale, "recurringCareChange", "seriesTitle")}</strong>
          <span>{copy(locale, "recurringCareChange", "seriesDescription")}</span>
        </button>
      </div>
      <footer className="form-actions">
        <span />
        <button className="button button--secondary" type="button" onClick={onCancel}>
          {copy(locale, "common", "cancel")}
        </button>
      </footer>
    </div>
  );
}

export function RecurringCareSeriesForm({
  entry,
  rule,
  onSaved,
  onBack
}: {
  entry: CareEntry;
  rule: ContactRule;
  onSaved: () => void;
  onBack: () => void;
}) {
  const { locale, intlLocale } = useI18n();
  const { data, canWrite, reload } = useAppStore();
  const initialStart = dateTimeParts(entry.startDateTime);
  const initialEnd = dateTimeParts(entry.endDateTime);
  const [startDate, setStartDate] = useState(initialStart.date);
  const [startTime, setStartTime] = useState(initialStart.time);
  const [endDate, setEndDate] = useState(initialEnd.date);
  const [endTime, setEndTime] = useState(initialEnd.time);
  const [childIds, setChildIds] = useState(entry.childIds);
  const [responsiblePartyId, setResponsiblePartyId] = useState(entry.responsiblePartyId ?? "");
  const [preview, setPreview] = useState<ApiContactRuleChangePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const startDateTime = `${startDate}T${startTime}`;
  const endDateTime = `${endDate}T${endTime}`;
  const rangeInvalid = !isValidTimedRange(startDateTime, endDateTime);

  const clearPreview = () => {
    setPreview(null);
    setError("");
  };

  const request = () => buildSeriesChangeRequest(entry, rule, {
    startDateTime,
    endDateTime,
    childIds,
    ...(responsiblePartyId ? { responsiblePartyId } : {})
  });

  const previewChange = async (event: FormEvent) => {
    event.preventDefault();
    if (!childIds.length || rangeInvalid) return;
    setBusy(true);
    setError("");
    try {
      setPreview(await api.previewContactRuleChange(rule.id, request()));
    } catch {
      setError(copy(locale, "recurringCareChange", "previewFailed"));
    } finally {
      setBusy(false);
    }
  };

  const applyChange = async () => {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      await api.applyContactRuleChange(rule.id, {
        ...request(),
        previewFingerprint: preview.fingerprint
      });
      await reload();
      onSaved();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        setPreview(null);
        setError(copy(locale, "recurringCareChange", "previewChanged"));
      } else {
        setError(copy(locale, "recurringCareChange", "applyFailed"));
      }
    } finally {
      setBusy(false);
    }
  };

  const warningText = (warning: string) => warning === "planned_conflicts"
    ? copy(locale, "recurringCareChange", "warningConflicts")
    : warning === "protected_occurrences_preserved"
      ? copy(locale, "recurringCareChange", "warningPreserved")
      : copy(locale, "recurringCareChange", "warningGeneric");

  return (
    <form className="entry-form" data-testid="recurring-care-series-form" onSubmit={(event) => void previewChange(event)}>
      <div className="notice notice--warning">
        <Icon name="repeat" />
        <div>
          <p>{copy(locale, "recurringCareChange", "seriesFormDescription")}</p>
        </div>
      </div>

      <fieldset className="form-section">
        <legend>{copy(locale, "entryForm", "children")}</legend>
        <div className="child-choice-grid">
          {data.children.map((child) => {
            const checked = childIds.includes(child.id);
            return (
              <label className={`choice-card ${checked ? "choice-card--selected" : ""}`} key={child.id}>
                <input
                  data-testid="series-child-option"
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    setChildIds((current) => checked
                      ? current.filter((id) => id !== child.id)
                      : [...current, child.id]);
                    clearPreview();
                  }}
                />
                <span className="child-dot" style={{ backgroundColor: child.color }} />
                <span>{child.name}</span>
              </label>
            );
          })}
        </div>
        {!childIds.length ? <p className="field-error">{copy(locale, "entryForm", "childRequired")}</p> : null}
      </fieldset>

      <fieldset className="form-section">
        <legend>{copy(locale, "recurringCareChange", "schedule")}</legend>
        <div className="datetime-grid">
          <label className="field">
            <span>{copy(locale, "entryForm", "startDate")}</span>
            <input data-testid="series-start-date" type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); clearPreview(); }} />
          </label>
          <label className="field">
            <span>{copy(locale, "entryForm", "startTime")}</span>
            <input data-testid="series-start-time" type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value); clearPreview(); }} />
          </label>
          <label className="field">
            <span>{copy(locale, "entryForm", "endDate")}</span>
            <input className={rangeInvalid ? "input--warning" : ""} data-testid="series-end-date" type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); clearPreview(); }} />
          </label>
          <label className="field">
            <span>{copy(locale, "entryForm", "endTime")}</span>
            <input className={rangeInvalid ? "input--warning" : ""} data-testid="series-end-time" type="time" value={endTime} onChange={(event) => { setEndTime(event.target.value); clearPreview(); }} />
          </label>
        </div>
        {rangeInvalid ? <p className="field-error">{copy(locale, "entryForm", "endAfterStart")}</p> : null}
        {data.careParties.length ? (
          <label className="field">
            <span>{copy(locale, "entryForm", "responsibleParty")}</span>
            <select data-testid="series-responsible-party" value={responsiblePartyId} onChange={(event) => { setResponsiblePartyId(event.target.value); clearPreview(); }}>
              <option value="">{copy(locale, "entryForm", "responsiblePartyNone")}</option>
              {data.careParties.map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}
            </select>
          </label>
        ) : null}
      </fieldset>

      {preview ? (
        <section className="contact-generation-preview" data-testid="recurring-care-change-preview" aria-labelledby="recurring-care-change-preview-title">
          <div className="contact-generation-preview__summary">
            <strong id="recurring-care-change-preview-title">{copy(locale, "recurringCareChange", "impactTitle")}</strong>
            <span>{formatDate(preview.startDate, intlLocale)} – {formatDate(preview.endDate, intlLocale)}</span>
          </div>
          <dl className="summary-strip summary-strip--five">
            <div><dt>{copy(locale, "recurringCareChange", "affected")}</dt><dd data-testid="recurring-impact-affected">{preview.affected}</dd></div>
            <div><dt>{copy(locale, "recurringCareChange", "created")}</dt><dd data-testid="recurring-impact-created">{preview.created}</dd></div>
            <div><dt>{copy(locale, "recurringCareChange", "retired")}</dt><dd data-testid="recurring-impact-retired">{preview.retired}</dd></div>
            <div><dt>{copy(locale, "recurringCareChange", "preserved")}</dt><dd data-testid="recurring-impact-preserved">{preview.preserved}</dd></div>
            <div><dt>{copy(locale, "recurringCareChange", "conflicts")}</dt><dd data-testid="recurring-impact-conflicts">{preview.conflicts}</dd></div>
          </dl>
          {preview.warnings.length ? (
            <div className="notice notice--warning" role="status">
              <Icon name="alert" />
              <div>
                <strong>{copy(locale, "recurringCareChange", "warningsTitle")}</strong>
                <ul>{preview.warnings.map((warning) => <li key={warning}>{warningText(warning)}</li>)}</ul>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <footer className="form-actions">
        <button className="button button--secondary" type="button" onClick={onBack} disabled={busy}>
          {copy(locale, "recurringCareChange", "back")}
        </button>
        <div className="form-actions__right">
          {preview ? (
            <button className="button button--danger" data-testid="recurring-care-change-apply" type="button" disabled={!canWrite || busy} onClick={() => void applyChange()}>
              <Icon name="repeat" size={17} />
              {copy(locale, "recurringCareChange", "applySeries")}
            </button>
          ) : (
            <button className="button button--primary" data-testid="recurring-care-change-preview-submit" type="submit" disabled={!canWrite || busy || !childIds.length || rangeInvalid}>
              <Icon name="check" size={17} />
              {copy(locale, "recurringCareChange", "reviewImpact")}
            </button>
          )}
        </div>
      </footer>
    </form>
  );
}
