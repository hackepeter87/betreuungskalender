import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { FieldHelpButton, FieldHelpLabel } from "../components/FieldHelp";
import { Modal } from "../components/Modal";
import {
  PeriodSelector,
  periodSelection,
  type PeriodSelection
} from "../components/PeriodSelector";
import { calculateHolidayStats } from "../lib/analytics";
import { actorDisplayName } from "../lib/actors";
import { api } from "../lib/api";
import { formatDate, formatDateTime, toMonthKey } from "../lib/date";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";
import { useAppStore } from "../store/AppStore";
import type { HolidayPeriod } from "../types";

function ExternalHolidayDerivationPanel() {
  const { locale } = useI18n();
  const { data, reload, canWrite, isSaving } = useAppStore();
  const holidaySources = data.externalCalendarSources.filter((source) => source.sourceType === "holiday");
  const [sourceId, setSourceId] = useState(holidaySources[0]?.id ?? "");
  const [childIds, setChildIds] = useState<string[]>(data.children.map((child) => child.id));
  const [message, setMessage] = useState<string | null>(null);

  const selectedSource = holidaySources.find((source) => source.id === sourceId);

  useEffect(() => {
    if (sourceId && holidaySources.some((source) => source.id === sourceId)) return;
    setSourceId(holidaySources[0]?.id ?? "");
  }, [holidaySources, sourceId]);

  useEffect(() => {
    setChildIds((current) => {
      const activeChildIds = new Set(data.children.map((child) => child.id));
      const retained = current.filter((id) => activeChildIds.has(id));
      return retained.length ? retained : data.children.map((child) => child.id);
    });
  }, [data.children]);

  const derive = async () => {
    if (!sourceId || !childIds.length) return;
    const result = await api.deriveHolidaysFromExternalCalendar(sourceId, {
      childIds,
      assignedTo: "shared"
    });
    await reload();
    setMessage(copy(locale, "holiday", "derivedFromExternal", {
      created: result.created,
      skipped: result.skippedExisting + result.skippedUnsupported
    }));
  };

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h2>{copy(locale, "holiday", "externalSources")}</h2>
          <p>{copy(locale, "holiday", "externalSourcesDescription")}</p>
        </div>
      </div>
      <div className="holiday-derive-form">
        {holidaySources.length ? (
          <>
            <label className="field">
              <FieldHelpLabel fieldId="holiday.externalSource">
                {copy(locale, "holiday", "externalSource")}
              </FieldHelpLabel>
              <select data-testid="holiday-external-source" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
                {holidaySources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
              </select>
            </label>
            <fieldset className="inline-fieldset holiday-derive-form__children">
              <legend className="field-label-row">
                <span>{copy(locale, "holiday", "children")}</span>
                <FieldHelpButton fieldId="holiday.externalChildren" />
              </legend>
              <div className="child-choice-grid">
                {data.children.map((child) => {
                  const checked = childIds.includes(child.id);
                  return (
                    <label className={`choice-card ${checked ? "choice-card--selected" : ""}`} key={child.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setChildIds((current) => checked ? current.filter((id) => id !== child.id) : [...current, child.id])}
                      />
                      <span className="child-dot" style={{ backgroundColor: child.color }} />
                      {child.name}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <button className="button button--primary" data-testid="holiday-derive-external" type="button" disabled={!canWrite || isSaving || !selectedSource || !childIds.length} onClick={() => void derive()}>
              <Icon name="sun" size={17} />
              {copy(locale, "holiday", "deriveExternal")}
            </button>
          </>
        ) : (
          <p className="empty-copy empty-copy--padded">{copy(locale, "holiday", "noExternalSources")}</p>
        )}
      </div>
      {message ? <p className="inline-message" role="status" data-testid="holiday-external-message">{message}</p> : null}
    </section>
  );
}

function HolidayForm({
  period,
  onDone
}: {
  period?: HolidayPeriod;
  onDone: () => void;
}) {
  const { locale } = useI18n();
  const { data, saveHolidayPeriod, canWrite, isSaving } = useAppStore();
  const [name, setName] = useState(period?.name ?? copy(locale, "holiday", "defaultName"));
  const [startDate, setStartDate] = useState(period?.startDate ?? "");
  const [endDate, setEndDate] = useState(period?.endDate ?? "");
  const [childIds, setChildIds] = useState<string[]>(
    period?.childIds ?? data.children.map((child) => child.id)
  );
  const [notes, setNotes] = useState(period?.notes ?? "");
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!startDate || !endDate || endDate < startDate) {
      setError(copy(locale, "holiday", "validPeriod"));
      return;
    }
    if (data.children.length && !childIds.length) {
      setError(copy(locale, "holiday", "childRequired"));
      return;
    }
    const saved = await saveHolidayPeriod({
      id: period?.id,
      name: name.trim() || copy(locale, "holiday", "defaultName"),
      startDate,
      endDate,
      childIds,
      assignedTo: period?.assignedTo ?? "shared",
      notes: notes.trim() || undefined
    });
    if (saved) onDone();
  };

  return (
    <form className="child-form" data-testid="holiday-form" onSubmit={submit}>
      <label className="field">
        <FieldHelpLabel fieldId="holiday.name" />
        <input data-testid="holiday-name" autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder={copy(locale, "holiday", "namePlaceholder")} />
      </label>
      <div className="form-grid form-grid--two">
        <label className="field">
          <FieldHelpLabel fieldId="holiday.startDate">{copy(locale, "common", "from")}</FieldHelpLabel>
          <input data-testid="holiday-start-date" type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label className="field">
          <FieldHelpLabel fieldId="holiday.endDate">{copy(locale, "common", "to")}</FieldHelpLabel>
          <input data-testid="holiday-end-date" type="date" required value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
      </div>
      <fieldset className="inline-fieldset">
        <legend className="field-label-row">
          <span>{copy(locale, "holiday", "children")}</span>
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
          <button className="button button--secondary" type="button" onClick={onDone}>{copy(locale, "common", "cancel")}</button>
          <button className="button button--primary" data-testid="holiday-submit" type="submit" disabled={!canWrite || isSaving}>{copy(locale, "holiday", "save")}</button>
        </div>
      </footer>
    </form>
  );
}

export function HolidaysPage() {
  const { locale, intlLocale } = useI18n();
  const { data, removeHolidayPeriod, canWrite } = useAppStore();
  const [selection, setSelection] = useState<PeriodSelection>(() =>
    periodSelection("year", toMonthKey(new Date()))
  );
  const [editing, setEditing] = useState<HolidayPeriod | "new" | null>(null);
  const stats = useMemo(
    () =>
      calculateHolidayStats({
        periods: data.holidayPeriods,
        startDate: selection.startDate,
        endDate: selection.endDate,
        allChildIds: data.children.map((child) => child.id),
        unavailablePeriods: data.unavailablePeriods,
        entries: data.entries,
        careParties: data.careParties,
        defaultResponsiblePartyId: data.settings.defaultResponsiblePartyId,
        primaryCarePartyId: data.settings.primaryCarePartyId
      }),
    [data.careParties, data.children, data.entries, data.holidayPeriods, data.settings.defaultResponsiblePartyId, data.settings.primaryCarePartyId, data.unavailablePeriods, selection.endDate, selection.startDate]
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
    if (window.confirm(copy(locale, "holiday", "deleteConfirm", { name: period.name }))) {
      await removeHolidayPeriod(period.id);
    }
  };

  return (
    <div className="page" data-testid="page-holidays">
      <div className="page-header">
        <div>
          <p className="page-header__context">{copy(locale, "holiday", "context")}</p>
          <h1>{copy(locale, "holiday", "title")}</h1>
        </div>
        <button className="button button--primary no-print" data-testid="holiday-add" type="button" onClick={() => setEditing("new")} disabled={!canWrite}>
          <Icon name="plus" size={17} />
          {copy(locale, "holiday", "add")}
        </button>
      </div>

      <PeriodSelector value={selection} onChange={setSelection} />

      <section className="summary-strip summary-strip--five">
        <div><small>{copy(locale, "holiday", "totalDays")}</small><strong>{stats.totalDays}</strong></div>
        <div><small>{copy(locale, "holiday", "fatherDays")}</small><strong>{stats.fatherDays}</strong></div>
        <div><small>{copy(locale, "holiday", "motherDays")}</small><strong>{stats.motherDays}</strong></div>
        <div><small>{copy(locale, "holiday", "fatherQuote")}</small><strong>{stats.fatherQuote} %</strong></div>
        <div><small>{copy(locale, "holiday", "halfDifference")}</small><strong>{stats.halfTarget} / {stats.differenceFromHalf > 0 ? "+" : ""}{stats.differenceFromHalf}</strong></div>
      </section>

      {stats.byCareParty.length ? (
        <section className="panel panel--subtle">
          <div className="panel__header panel__header--compact">
            <div>
              <h2>{copy(locale, "holiday", "carePartyShares")}</h2>
              <p>{copy(locale, "holiday", "carePartySharesDescription")}</p>
            </div>
          </div>
          <div className="stats-grid">
            {stats.byCareParty.map((share) => (
              <div key={share.carePartyId}>
                <small>{share.name}</small>
                <strong>{share.days} / {share.quote} %</strong>
              </div>
            ))}
            {stats.unassignedDays > 0 ? (
              <div>
                <small>{copy(locale, "holiday", "unassignedDays")}</small>
                <strong>{stats.unassignedDays}</strong>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {stats.unavailablePeriods > 0 ? (
        <section className="notice notice--recommendation">
          <Icon name="briefcase" />
          <div>
            <strong>{copy(locale, "holiday", "dutyUnavailability")}</strong>
            <p>{copy(locale, "holiday", "dutyUnavailabilityDescription")}</p>
          </div>
        </section>
      ) : null}

      <ExternalHolidayDerivationPanel />

      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>{copy(locale, "holiday", "recorded")}</h2>
            <p>{copy(locale, "holiday", "recordedDescription")}</p>
          </div>
        </div>
        <div className="holiday-list">
          {periods.map((period) => (
            <article className="holiday-row" key={period.id}>
              <span className="holiday-row__assignment holiday-row__assignment--shared">
                {copy(locale, "agenda", "holidayPeriod")}
              </span>
              <span>
                <strong>{period.name}</strong>
                <small>{formatDate(period.startDate, intlLocale)} {copy(locale, "common", "to")} {formatDate(period.endDate, intlLocale)}</small>
                <small>
                  {copy(locale, "common", "updatedBy", {
                    actor: actorDisplayName(data, period.updatedBy),
                    date: formatDateTime(period.updatedAt, intlLocale)
                  })}
                </small>
              </span>
              <span>
                <strong>{period.childIds.map((id) => data.children.find((child) => child.id === id)?.name).filter(Boolean).join(", ") || copy(locale, "holiday", "allChildren")}</strong>
                <small>{period.notes || copy(locale, "common", "noNote")}</small>
              </span>
              <span className="holiday-row__actions">
                <button className="icon-button icon-button--bordered" type="button" onClick={() => setEditing(period)} aria-label={copy(locale, "holiday", "edit", { name: period.name })}>
                  <Icon name="edit" size={16} />
                </button>
                <button className="icon-button icon-button--bordered icon-button--danger" type="button" onClick={() => void remove(period)} disabled={!canWrite} aria-label={copy(locale, "holiday", "delete", { name: period.name })}>
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </article>
          ))}
          {periods.length === 0 ? <p className="empty-copy empty-copy--padded">{copy(locale, "holiday", "empty")}</p> : null}
        </div>
      </section>

      {editing ? (
        <Modal title={editing === "new" ? copy(locale, "holiday", "createTitle") : copy(locale, "holiday", "editTitle")} onClose={() => setEditing(null)}>
          <HolidayForm period={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />
        </Modal>
      ) : null}
    </div>
  );
}
