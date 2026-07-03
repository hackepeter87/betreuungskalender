import { useEffect, useMemo, useState } from "react";
import {
  calculateDataQuality,
  calculateMonthlyStats,
  entriesForMonth,
  unavailablePeriodsForRange
} from "../lib/analytics";
import { formatDate, formatDateTime, formatMonth, rangeForMonth } from "../lib/date";
import { buildMonthlyClosureSummary } from "../lib/monthClosure";
import type { CareEntry, ExternalCalendarEvent } from "../types";
import { useAppStore } from "../store/AppStore";
import { CalendarGrid } from "../components/CalendarGrid";
import { FieldHelpButton, FieldHelpLabel } from "../components/FieldHelp";
import { Icon, type IconName } from "../components/Icon";
import { Modal } from "../components/Modal";
import { MonthToolbar } from "../components/MonthToolbar";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";
import { api } from "../lib/api";

interface PartialConfirmationDraft {
  actualChildIds: string[];
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  actualResponsiblePartyId: string;
}

function dateTimeParts(value: string) {
  const [date, time = "00:00"] = value.slice(0, 16).split("T");
  return { date, time };
}

function defaultPartialDraft(entry: CareEntry): PartialConfirmationDraft {
  const start = dateTimeParts(entry.actualStartDateTime ?? entry.startDateTime);
  const end = dateTimeParts(entry.actualEndDateTime ?? entry.endDateTime);
  return {
    actualChildIds: entry.actualChildIds?.length ? entry.actualChildIds : entry.childIds,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    actualResponsiblePartyId: entry.actualResponsiblePartyId ?? entry.responsiblePartyId ?? ""
  };
}

export function DashboardPage({
  monthKey,
  onMonthChange,
  onNewEntry,
  onEditEntry,
  onOpenSettings,
  onOpenCalendar
}: {
  monthKey: string;
  onMonthChange: (month: string) => void;
  onNewEntry: (date?: string) => void;
  onEditEntry: (entry: CareEntry) => void;
  onOpenSettings: () => void;
  onOpenCalendar: () => void;
}) {
  const { locale, intlLocale } = useI18n();
  const {
    data,
    closeMonth,
    canWrite,
    isSaving,
    openConfirmations,
    answerCareConfirmation,
    remindCareConfirmationLater
  } = useAppStore();
  const [showClosure, setShowClosure] = useState(false);
  const [closureConfirmed, setClosureConfirmed] = useState(false);
  const [externalEvents, setExternalEvents] = useState<ExternalCalendarEvent[]>([]);
  const [confirmationNotes, setConfirmationNotes] = useState<Record<string, string>>({});
  const [partialDrafts, setPartialDrafts] = useState<Record<string, PartialConfirmationDraft>>({});
  const stats = useMemo(() => calculateMonthlyStats(data, monthKey), [data, monthKey]);
  const monthEntries = useMemo(
    () => entriesForMonth(data.entries, monthKey),
    [data.entries, monthKey]
  );
  const upcoming = useMemo(
    () =>
      data.entries
        .filter((entry) => !entry.deletedAt && entry.status !== "cancelled" && new Date(entry.endDateTime) >= new Date())
        .slice()
        .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime))
        .slice(0, 4),
    [data.entries]
  );
  const range = useMemo(() => rangeForMonth(monthKey), [monthKey]);
  const unavailablePeriods = useMemo(
    () =>
      unavailablePeriodsForRange(
        data.unavailablePeriods,
        range.startDate,
        range.endDate
      ),
    [data.unavailablePeriods, range.endDate, range.startDate]
  );
  const dataQuality = useMemo(
    () => calculateDataQuality(data.entries, range.startDate, range.endDate),
    [data.entries, range.endDate, range.startDate]
  );
  const closurePreview = useMemo(
    () => buildMonthlyClosureSummary(data, monthKey),
    [data, monthKey]
  );
  const closure = data.monthClosures.find((item) => item.monthKey === monthKey);
  const backupAgeDays = data.lastJsonBackupAt
    ? Math.floor(
        (Date.now() - new Date(data.lastJsonBackupAt).getTime()) / 86_400_000
      )
    : null;
  const backupIsCurrent = backupAgeDays !== null && backupAgeDays <= 7;

  useEffect(() => {
    let ignore = false;
    void api
      .listExternalCalendarEvents(
        `${range.startDate}T00:00:00.000Z`,
        `${range.endDate}T23:59:59.999Z`
      )
      .then((events) => {
        if (!ignore) setExternalEvents(events);
      })
      .catch(() => {
        if (!ignore) setExternalEvents([]);
      });
    return () => {
      ignore = true;
    };
  }, [range.endDate, range.startDate]);

  const metrics: Array<{ label: string; value: string; detail: string; icon: IconName; tone: string }> = [
    { label: copy(locale, "dashboard", "careDays"), value: String(stats.careDays), detail: copy(locale, "dashboard", "actualDays"), icon: "calendar", tone: "teal" },
    { label: copy(locale, "dashboard", "overnights"), value: String(stats.overnights), detail: copy(locale, "dashboard", "selectedMonth"), icon: "moon", tone: "violet" },
    { label: copy(locale, "dashboard", "weekends"), value: String(stats.weekends), detail: copy(locale, "dashboard", "documentedCare"), icon: "users", tone: "amber" },
    { label: copy(locale, "dashboard", "completeness"), value: `${stats.completeness} %`, detail: copy(locale, "dashboard", "checkedEntries", { count: monthEntries.length }), icon: stats.completeness === 100 ? "check" : "alert", tone: stats.completeness === 100 ? "teal" : "coral" },
    { label: copy(locale, "dashboard", "dataQuality"), value: String(dataQuality.totalIssues), detail: dataQuality.totalIssues ? copy(locale, "dashboard", "monthHints") : copy(locale, "dashboard", "noOpenHints"), icon: dataQuality.totalIssues ? "alert" : "check", tone: dataQuality.totalIssues ? "coral" : "teal" }
  ];
  const mobileMetrics: Array<{ label: string; value: string; detail: string; icon: IconName; tone: string }> = [
    { label: copy(locale, "dashboard", "overnights"), value: String(stats.overnights), detail: copy(locale, "dashboard", "selectedMonth"), icon: "moon", tone: "violet" },
    { label: copy(locale, "dashboard", "additionalCare"), value: String(monthEntries.filter((entry) => (entry.status === "completed" || entry.status === "partial") && entry.additionalCare).length), detail: copy(locale, "dashboard", "completedDates"), icon: "plus", tone: "teal" },
    { label: copy(locale, "dashboard", "openDates"), value: String(monthEntries.filter((entry) => entry.status === "planned" && entry.generatedByPatternId).length), detail: copy(locale, "dashboard", "plannedDates"), icon: "calendar", tone: "amber" },
    { label: copy(locale, "dashboard", "dataQuality"), value: String(dataQuality.totalIssues), detail: dataQuality.totalIssues ? copy(locale, "dashboard", "openHints") : copy(locale, "dashboard", "noHints"), icon: dataQuality.totalIssues ? "alert" : "check", tone: dataQuality.totalIssues ? "coral" : "teal" },
    { label: copy(locale, "dashboard", "lastBackup"), value: backupAgeDays === null ? "–" : backupAgeDays === 0 ? copy(locale, "common", "today") : `${backupAgeDays} ${locale === "en" ? "d" : "T."}`, detail: backupIsCurrent ? copy(locale, "dashboard", "backupCurrent") : copy(locale, "dashboard", "backupRequired"), icon: backupIsCurrent ? "backup" : "alert", tone: backupIsCurrent ? "teal" : "coral" }
  ];

  const openClosureDialog = () => {
    setClosureConfirmed(false);
    setShowClosure(true);
  };

  return (
    <div className="page" data-testid="page-dashboard">
      <div className="page-header">
        <div>
          <p className="page-header__context">{copy(locale, "dashboard", "context")}</p>
          <h1>{formatMonth(monthKey, intlLocale)}</h1>
        </div>
        <div className="page-header__actions">
          <MonthToolbar monthKey={monthKey} onChange={onMonthChange} />
          <span className="action-with-help action-with-help--header">
            <button
              className={closure ? "button button--secondary" : "button button--primary"}
              type="button"
              data-testid="dashboard-close-month"
              onClick={openClosureDialog}
              disabled={!closure && (!canWrite || isSaving)}
            >
              <Icon name={closure ? "lock" : "check"} size={17} />
              {closure ? copy(locale, "dashboard", "monthClosed") : copy(locale, "dashboard", "closeMonth")}
            </button>
            <FieldHelpButton fieldId="monthClosure.close" />
          </span>
          <button className="button button--primary desktop-only" data-testid="dashboard-new-entry" type="button" onClick={() => onNewEntry()} disabled={!canWrite || isSaving}>
            <Icon name="plus" />
            {copy(locale, "dashboard", "createEntry")}
          </button>
        </div>
      </div>

      {data.children.length === 0 ? (
        <section className="onboarding-panel">
          <div className="onboarding-panel__icon"><Icon name="child" size={28} /></div>
          <div>
            <h2>{copy(locale, "dashboard", "setupTitle")}</h2>
            <p>{copy(locale, "dashboard", "setupDescription")}</p>
          </div>
          <button className="button button--primary" type="button" data-testid="dashboard-setup-child" onClick={onOpenSettings}>
            {copy(locale, "dashboard", "addChild")}
          </button>
        </section>
      ) : null}

      <section className="metric-grid metric-grid--desktop" aria-label={copy(locale, "dashboard", "metrics")}>
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <span className={`metric-card__icon metric-card__icon--${metric.tone}`}>
              <Icon name={metric.icon} size={22} />
            </span>
            <span>
              <small>{metric.label}</small>
              <strong>{metric.value}</strong>
              <em>{metric.detail}</em>
            </span>
          </article>
        ))}
      </section>
      <section className="metric-grid metric-grid--mobile" aria-label={copy(locale, "dashboard", "mobileMetrics")}>
        {mobileMetrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <span className={`metric-card__icon metric-card__icon--${metric.tone}`}>
              <Icon name={metric.icon} size={22} />
            </span>
            <span>
              <small>{metric.label}</small>
              <strong>{metric.value}</strong>
              <em>{metric.detail}</em>
            </span>
          </article>
        ))}
      </section>

      {closure ? (
        <section className={`closure-banner ${closure.changedAfterCloseAt ? "closure-banner--warning" : ""}`}>
          <Icon name="lock" size={20} />
          <div>
            <strong>{copy(locale, "dashboard", "closureOn", { date: formatDateTime(closure.closedAt, intlLocale) })}</strong>
            <p>
              {copy(locale, "dashboard", "closureSummary", { entries: closure.summary.entryCount, days: closure.summary.careDays, overnights: closure.summary.overnights })}
              {closure.changedAfterCloseAt ? copy(locale, "dashboard", "changedOn", { date: formatDateTime(closure.changedAfterCloseAt, intlLocale) }) : ""}
            </p>
          </div>
        </section>
      ) : null}

      <div className="dashboard-layout">
        <section className="panel calendar-panel">
          <div className="panel__header">
            <div>
              <h2>{copy(locale, "dashboard", "calendar")}</h2>
              <p>{copy(locale, "dashboard", "calendarDescription")}</p>
            </div>
            <button className="button button--quiet" type="button" onClick={onOpenCalendar}>
              {copy(locale, "dashboard", "largeView")}
              <Icon name="chevronRight" size={16} />
            </button>
          </div>
          <CalendarGrid
            monthKey={monthKey}
            entries={monthEntries}
            unavailablePeriods={unavailablePeriods}
            externalEvents={externalEvents}
            children={data.children}
            onSelectDate={onNewEntry}
            onSelectEntry={onEditEntry}
            onSelectUnavailable={() => onOpenCalendar()}
            allowCreate={canWrite}
          />
          <div className="calendar-legend">
            {data.children.map((child) => (
              <span key={child.id}><span className="child-dot" style={{ backgroundColor: child.color }} />{child.name}</span>
            ))}
            <span><Icon name="moon" size={14} />{copy(locale, "agenda", "overnight")}</span>
            <span><span className="legend-line legend-line--planned" />{copy(locale, "dashboard", "planned")}</span>
            <span><span className="legend-line legend-line--cancelled" />{copy(locale, "dashboard", "cancelled")}</span>
            <span><span className="legend-line legend-line--external" />{copy(locale, "dashboard", "externalCalendar")}</span>
            <span><span className="legend-line legend-line--unavailable" />{copy(locale, "dashboard", "unavailability")}</span>
          </div>
        </section>

        <aside className="dashboard-sidebar">
          {openConfirmations.length ? (
            <section className="panel confirmation-panel" data-testid="open-confirmations">
              <div className="panel__header panel__header--compact">
                <div>
                  <h2>{copy(locale, "confirmation", "title")}</h2>
                  <p>{copy(locale, "confirmation", "description")}</p>
                </div>
              </div>
              <div className="confirmation-list">
                {openConfirmations.slice(0, 4).map((request) => {
                  const entry = data.entries.find((item) => item.id === request.careEntryId) ?? request.entry;
                  const note = confirmationNotes[request.id] ?? "";
                  const partialDraft = partialDrafts[request.id] ?? defaultPartialDraft(entry);
                  const updatePartialDraft = (patch: Partial<PartialConfirmationDraft>) =>
                    setPartialDrafts((current) => ({
                      ...current,
                      [request.id]: { ...partialDraft, ...patch }
                    }));
                  return (
                    <article className="confirmation-card" key={request.id} data-testid="confirmation-card">
                      <button className="button button--quiet confirmation-card__link" type="button" onClick={() => onEditEntry(entry)}>
                        <Icon name="calendar" size={16} />
                        {copy(locale, "confirmation", "dueYesterday")}
                      </button>
                      <small>{formatDate(entry.endDateTime.slice(0, 10), intlLocale)}</small>
                      <textarea
                        rows={2}
                        value={note}
                        placeholder={copy(locale, "confirmation", "notePlaceholder")}
                        onChange={(event) => setConfirmationNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                      />
                      <details className="confirmation-card__partial">
                        <summary>{copy(locale, "confirmation", "partialDetails")}</summary>
                        <fieldset className="inline-fieldset">
                          <legend>{copy(locale, "confirmation", "actualChildren")}</legend>
                          <div className="child-choice-grid">
                            {entry.childIds.map((childId) => {
                              const child = data.children.find((item) => item.id === childId);
                              const checked = partialDraft.actualChildIds.includes(childId);
                              return (
                                <label className={`choice-card ${checked ? "choice-card--selected" : ""}`} key={childId}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() =>
                                      updatePartialDraft({
                                        actualChildIds: checked
                                          ? partialDraft.actualChildIds.filter((id) => id !== childId)
                                          : [...partialDraft.actualChildIds, childId]
                                      })
                                    }
                                  />
                                  {child ? <span className="child-dot" style={{ backgroundColor: child.color }} /> : null}
                                  {child?.name ?? childId}
                                </label>
                              );
                            })}
                          </div>
                        </fieldset>
                        <div className="form-grid form-grid--two">
                          <label className="field">
                            <span>{copy(locale, "confirmation", "actualStart")}</span>
                            <input type="date" value={partialDraft.startDate} onChange={(event) => updatePartialDraft({ startDate: event.target.value })} />
                          </label>
                          <label className="field">
                            <span>{copy(locale, "confirmation", "actualStartTime")}</span>
                            <input type="time" value={partialDraft.startTime} onChange={(event) => updatePartialDraft({ startTime: event.target.value })} />
                          </label>
                          <label className="field">
                            <span>{copy(locale, "confirmation", "actualEnd")}</span>
                            <input type="date" value={partialDraft.endDate} onChange={(event) => updatePartialDraft({ endDate: event.target.value })} />
                          </label>
                          <label className="field">
                            <span>{copy(locale, "confirmation", "actualEndTime")}</span>
                            <input type="time" value={partialDraft.endTime} onChange={(event) => updatePartialDraft({ endTime: event.target.value })} />
                          </label>
                        </div>
                        {data.careParties.length ? (
                          <label className="field">
                            <span>{copy(locale, "confirmation", "actualCareParty")}</span>
                            <select value={partialDraft.actualResponsiblePartyId} onChange={(event) => updatePartialDraft({ actualResponsiblePartyId: event.target.value })}>
                              {data.careParties.map((party) => (
                                <option key={party.id} value={party.id}>{party.name}</option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                      </details>
                      <div className="confirmation-actions">
                        <button className="button button--primary" type="button" disabled={!canWrite || isSaving} onClick={() => void answerCareConfirmation(request.id, "completed", note)}>
                          {copy(locale, "confirmation", "completed")}
                        </button>
                        <button
                          className="button button--secondary"
                          type="button"
                          disabled={!canWrite || isSaving || partialDraft.actualChildIds.length === 0}
                          onClick={() => void answerCareConfirmation(request.id, "partial", {
                            note,
                            actualChildIds: partialDraft.actualChildIds,
                            actualStartDateTime: `${partialDraft.startDate}T${partialDraft.startTime}`,
                            actualEndDateTime: `${partialDraft.endDate}T${partialDraft.endTime}`,
                            actualResponsiblePartyId: partialDraft.actualResponsiblePartyId || undefined
                          })}
                        >
                          {copy(locale, "confirmation", "partial")}
                        </button>
                        <button className="button button--danger-quiet" type="button" disabled={!canWrite || isSaving} onClick={() => void answerCareConfirmation(request.id, "cancelled", note || copy(locale, "confirmation", "cancelled"))}>
                          {copy(locale, "confirmation", "cancelled")}
                        </button>
                        <button className="button button--quiet" type="button" disabled={!canWrite || isSaving} onClick={() => void remindCareConfirmationLater(request.id)}>
                          {copy(locale, "confirmation", "remindLater")}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="panel">
            <div className="panel__header panel__header--compact">
              <div>
                <h2>{copy(locale, "dashboard", "perChild")}</h2>
                <p>{copy(locale, "dashboard", "actualCare")}</p>
              </div>
            </div>
            <div className="child-stat-list">
              {data.children.map((child) => {
                const childStats = stats.byChild.find((item) => item.childId === child.id);
                return (
                  <div className="child-stat" key={child.id}>
                    <span className="child-stat__name"><span className="child-dot" style={{ backgroundColor: child.color }} />{child.name}</span>
                    <span><strong>{childStats?.careDays ?? 0}</strong><small>{copy(locale, "dashboard", "days")}</small></span>
                    <span><strong>{childStats?.overnights ?? 0}</strong><small>{copy(locale, "dashboard", "nights")}</small></span>
                  </div>
                );
              })}
              {data.children.length === 0 ? <p className="empty-copy">{copy(locale, "dashboard", "noChildren")}</p> : null}
            </div>
          </section>

          <section className="panel">
            <div className="panel__header panel__header--compact">
              <div>
                <h2>{copy(locale, "dashboard", "dataQuality")}</h2>
                <p>{copy(locale, "dashboard", "qualityFor", { month: formatMonth(monthKey, intlLocale) })}</p>
              </div>
              <FieldHelpButton fieldId="monthClosure.dataQuality" />
            </div>
            <dl className="quality-list">
              <div><dt>{copy(locale, "dashboard", "incompleteEntries")}</dt><dd>{dataQuality.incompleteEntries}</dd></div>
              <div><dt>{copy(locale, "dashboard", "cancellationsWithoutReason")}</dt><dd>{dataQuality.cancellationsWithoutReason}</dd></div>
              <div><dt>{copy(locale, "dashboard", "tripsWithoutPurpose")}</dt><dd>{dataQuality.tripsWithoutPurpose}</dd></div>
              <div><dt>{copy(locale, "dashboard", "costsWithoutCategory")}</dt><dd>{dataQuality.costsWithoutCategory}</dd></div>
              <div><dt>{copy(locale, "dashboard", "overduePlanned")}</dt><dd>{dataQuality.overduePlannedEntries}</dd></div>
            </dl>
          </section>

          <section className="panel">
            <div className="panel__header panel__header--compact">
              <div>
                <h2>{copy(locale, "dashboard", "upcoming")}</h2>
                <p>{copy(locale, "dashboard", "upcomingDescription")}</p>
              </div>
            </div>
            <div className="upcoming-list">
              {upcoming.map((entry) => (
                <button type="button" key={entry.id} onClick={() => onEditEntry(entry)}>
                  <span className="upcoming-list__date">{formatDate(entry.startDateTime, intlLocale)}</span>
                  <strong>
                    {entry.childIds.map((id) => data.children.find((child) => child.id === id)?.name).filter(Boolean).join(locale === "en" ? " and " : " und ")}
                  </strong>
                  <small>{entry.status === "planned" ? copy(locale, "dashboard", "plannedTitle") : copy(locale, "dashboard", "completed")}{entry.overnight ? ` · ${copy(locale, "agenda", "overnight")}` : ""}</small>
                </button>
              ))}
              {upcoming.length === 0 ? <p className="empty-copy">{copy(locale, "dashboard", "noUpcoming")}</p> : null}
            </div>
          </section>

          <section className={`privacy-card ${backupIsCurrent ? "" : "privacy-card--warning"}`}>
            <Icon name={backupIsCurrent ? "check" : "alert"} size={19} />
            <div>
              <strong>{backupIsCurrent ? copy(locale, "dashboard", "backupUpToDate") : copy(locale, "dashboard", "backupNeeded")}</strong>
              <p>
                {backupIsCurrent && data.lastJsonBackupAt
                  ? copy(locale, "dashboard", "latestBackup", { date: formatDate(data.lastJsonBackupAt, intlLocale) })
                  : data.lastJsonBackupAt
                    ? copy(locale, "dashboard", "backupDaysAgo", { days: backupAgeDays ?? 0 })
                    : copy(locale, "dashboard", "noBackup")}
              </p>
            </div>
          </section>
        </aside>
      </div>

      {showClosure ? (
        <Modal
          title={closure ? copy(locale, "dashboard", "closureTitle", { month: formatMonth(monthKey, intlLocale) }) : copy(locale, "dashboard", "closeTitle", { month: formatMonth(monthKey, intlLocale) })}
          onClose={() => setShowClosure(false)}
        >
          <div className="closure-dialog">
            {closure ? (
              <>
                <div className="notice">
                  <Icon name="lock" />
                  <p>{copy(locale, "dashboard", "closedInfo", { date: formatDateTime(closure.closedAt, intlLocale) })}</p>
                </div>
                <ClosureSummary summary={closure.summary} locale={locale} />
              </>
            ) : (
              <>
                {closurePreview.warnings.length ? (
                  <div className="notice notice--warning">
                    <Icon name="alert" />
                    <div>
                      <strong>{copy(locale, "dashboard", "warningsBeforeClose")}</strong>
                      <ul>
                        {closurePreview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="notice notice--success">
                    <Icon name="check" />
                    <p>{copy(locale, "dashboard", "noValidationHints")}</p>
                  </div>
                )}
                <ClosureSummary summary={closurePreview} locale={locale} />
                <p className="muted-copy">{copy(locale, "dashboard", "closureDescription")}</p>
                <label className="closure-confirmation">
                  <input
                    type="checkbox"
                    checked={closureConfirmed}
                    onChange={(event) => setClosureConfirmed(event.target.checked)}
                  />
                  <FieldHelpLabel fieldId="monthClosure.warnings">
                    {copy(locale, "dashboard", "confirmed")}
                  </FieldHelpLabel>
                </label>
              </>
            )}
            <footer className="form-actions">
              <span />
              <div className="form-actions__right">
                <button className="button button--secondary" type="button" onClick={() => setShowClosure(false)}>{copy(locale, "common", "cancel")}</button>
                {!closure ? (
                  <button
                    className="button button--primary"
                    type="button"
                    disabled={!closureConfirmed || !canWrite || isSaving}
                    onClick={async () => {
                      if (await closeMonth(monthKey)) setShowClosure(false);
                    }}
                  >
                    <Icon name="lock" size={17} />
                    {copy(locale, "dashboard", "finalClose")}
                  </button>
                ) : null}
              </div>
            </footer>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function ClosureSummary({
  summary,
  locale
}: {
  summary: ReturnType<typeof buildMonthlyClosureSummary>;
  locale: "de" | "en";
}) {
  return (
    <dl className="closure-summary">
      <div><dt>{copy(locale, "dashboard", "entries")}</dt><dd>{summary.entryCount}</dd></div>
      <div><dt>{copy(locale, "dashboard", "completed")}</dt><dd>{summary.completedEntries}</dd></div>
      <div><dt>{copy(locale, "dashboard", "plannedTitle")}</dt><dd>{summary.plannedEntries}</dd></div>
      <div><dt>{copy(locale, "dashboard", "cancelledTitle")}</dt><dd>{summary.cancelledEntries}</dd></div>
      <div><dt>{copy(locale, "dashboard", "careDays")}</dt><dd>{summary.careDays}</dd></div>
      <div><dt>{copy(locale, "dashboard", "overnights")}</dt><dd>{summary.overnights}</dd></div>
      <div><dt>{copy(locale, "dashboard", "weekends")}</dt><dd>{summary.weekends}</dd></div>
      <div><dt>{copy(locale, "app", "completeness")}</dt><dd>{summary.completeness} %</dd></div>
    </dl>
  );
}
