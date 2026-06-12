import { useMemo, useState } from "react";
import {
  calculateDataQuality,
  calculateMonthlyStats,
  entriesForMonth
} from "../lib/analytics";
import { formatDate, formatDateTime, formatMonth, rangeForMonth } from "../lib/date";
import { buildMonthlyClosureSummary } from "../lib/monthClosure";
import type { CareEntry } from "../types";
import { useAppStore } from "../store/AppStore";
import { CalendarGrid } from "../components/CalendarGrid";
import { FieldHelpButton, FieldHelpLabel } from "../components/FieldHelp";
import { Icon, type IconName } from "../components/Icon";
import { Modal } from "../components/Modal";
import { MonthToolbar } from "../components/MonthToolbar";

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
  const { data, closeMonth, canWrite, isSaving } = useAppStore();
  const [showClosure, setShowClosure] = useState(false);
  const [closureConfirmed, setClosureConfirmed] = useState(false);
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

  const metrics: Array<{ label: string; value: string; detail: string; icon: IconName; tone: string }> = [
    { label: "Betreuungstage", value: String(stats.careDays), detail: "tatsächliche Kalendertage", icon: "calendar", tone: "teal" },
    { label: "Übernachtungen", value: String(stats.overnights), detail: "im gewählten Monat", icon: "moon", tone: "violet" },
    { label: "Wochenenden", value: String(stats.weekends), detail: "mit dokumentierter Betreuung", icon: "users", tone: "amber" },
    { label: "Vollständigkeit", value: `${stats.completeness} %`, detail: `${monthEntries.length} Einträge geprüft`, icon: stats.completeness === 100 ? "check" : "alert", tone: stats.completeness === 100 ? "teal" : "coral" },
    { label: "Datenqualität", value: String(dataQuality.totalIssues), detail: dataQuality.totalIssues ? "Hinweise im gewählten Monat" : "keine offenen Hinweise", icon: dataQuality.totalIssues ? "alert" : "check", tone: dataQuality.totalIssues ? "coral" : "teal" }
  ];
  const mobileMetrics: Array<{ label: string; value: string; detail: string; icon: IconName; tone: string }> = [
    { label: "Übernachtungen", value: String(stats.overnights), detail: "im gewählten Monat", icon: "moon", tone: "violet" },
    { label: "Zusatzbetreuung", value: String(monthEntries.filter((entry) => entry.status === "completed" && entry.additionalCare).length), detail: "durchgeführte Termine", icon: "plus", tone: "teal" },
    { label: "Offene Termine", value: String(monthEntries.filter((entry) => entry.status === "planned" && entry.generatedByPatternId).length), detail: "geplante Soll-Termine", icon: "calendar", tone: "amber" },
    { label: "Datenqualität", value: String(dataQuality.totalIssues), detail: dataQuality.totalIssues ? "offene Hinweise" : "keine Hinweise", icon: dataQuality.totalIssues ? "alert" : "check", tone: dataQuality.totalIssues ? "coral" : "teal" },
    { label: "Letztes Backup", value: backupAgeDays === null ? "–" : backupAgeDays === 0 ? "Heute" : `${backupAgeDays} T.`, detail: backupIsCurrent ? "Sicherung aktuell" : "Sicherung erforderlich", icon: backupIsCurrent ? "backup" : "alert", tone: backupIsCurrent ? "teal" : "coral" }
  ];

  const openClosureDialog = () => {
    setClosureConfirmed(false);
    setShowClosure(true);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="page-header__context">Monatsübersicht</p>
          <h1>{formatMonth(monthKey)}</h1>
        </div>
        <div className="page-header__actions">
          <MonthToolbar monthKey={monthKey} onChange={onMonthChange} />
          <button
            className={closure ? "button button--secondary" : "button button--primary"}
            type="button"
            onClick={openClosureDialog}
          >
            <Icon name={closure ? "lock" : "check"} size={17} />
            {closure ? "Monat abgeschlossen" : "Monat abschließen"}
          </button>
          <FieldHelpButton fieldId="monthClosure.close" />
          <button className="button button--primary desktop-only" type="button" onClick={() => onNewEntry()} disabled={!canWrite || isSaving}>
            <Icon name="plus" />
            Eintrag erfassen
          </button>
        </div>
      </div>

      {data.children.length === 0 ? (
        <section className="onboarding-panel">
          <div className="onboarding-panel__icon"><Icon name="child" size={28} /></div>
          <div>
            <h2>Richte deinen Betreuungskalender ein</h2>
            <p>Lege mindestens ein Kind an. Danach kannst du Betreuungseinträge erfassen und monatlich auswerten.</p>
          </div>
          <button className="button button--primary" type="button" onClick={onOpenSettings}>
            Kind anlegen
          </button>
        </section>
      ) : null}

      <section className="metric-grid metric-grid--desktop" aria-label="Monatskennzahlen">
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
      <section className="metric-grid metric-grid--mobile" aria-label="Wichtigste Monatskennzahlen">
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
            <strong>Monatsabschluss vom {formatDateTime(closure.closedAt)}</strong>
            <p>
              {closure.summary.entryCount} Einträge, {closure.summary.careDays} Betreuungstage und {closure.summary.overnights} Übernachtungen wurden zusammengefasst.
              {closure.changedAfterCloseAt ? ` Nachträgliche Änderung am ${formatDateTime(closure.changedAfterCloseAt)}.` : ""}
            </p>
          </div>
        </section>
      ) : null}

      <div className="dashboard-layout">
        <section className="panel calendar-panel">
          <div className="panel__header">
            <div>
              <h2>Kalender</h2>
              <p>Einträge anklicken, um Details zu bearbeiten.</p>
            </div>
            <button className="button button--quiet" type="button" onClick={onOpenCalendar}>
              Große Ansicht
              <Icon name="chevronRight" size={16} />
            </button>
          </div>
          <CalendarGrid
            monthKey={monthKey}
            entries={monthEntries}
            children={data.children}
            onSelectDate={onNewEntry}
            onSelectEntry={onEditEntry}
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

        <aside className="dashboard-sidebar">
          <section className="panel">
            <div className="panel__header panel__header--compact">
              <div>
                <h2>Je Kind</h2>
                <p>Tatsächliche Betreuung</p>
              </div>
            </div>
            <div className="child-stat-list">
              {data.children.map((child) => {
                const childStats = stats.byChild.find((item) => item.childId === child.id);
                return (
                  <div className="child-stat" key={child.id}>
                    <span className="child-stat__name"><span className="child-dot" style={{ backgroundColor: child.color }} />{child.name}</span>
                    <span><strong>{childStats?.careDays ?? 0}</strong><small>Tage</small></span>
                    <span><strong>{childStats?.overnights ?? 0}</strong><small>Nächte</small></span>
                  </div>
                );
              })}
              {data.children.length === 0 ? <p className="empty-copy">Noch keine Kinder angelegt.</p> : null}
            </div>
          </section>

          <section className="panel">
            <div className="panel__header panel__header--compact">
              <div>
                <h2>Datenqualität</h2>
                <p>Hinweise für {formatMonth(monthKey)}</p>
              </div>
              <FieldHelpButton fieldId="monthClosure.dataQuality" />
            </div>
            <dl className="quality-list">
              <div><dt>Unvollständige Einträge</dt><dd>{dataQuality.incompleteEntries}</dd></div>
              <div><dt>Ausfälle ohne Notiz / Grund</dt><dd>{dataQuality.cancellationsWithoutReason}</dd></div>
              <div><dt>Fahrten ohne Zweck</dt><dd>{dataQuality.tripsWithoutPurpose}</dd></div>
              <div><dt>Kosten ohne Kategorie</dt><dd>{dataQuality.costsWithoutCategory}</dd></div>
              <div><dt>Vergangene Termine noch geplant</dt><dd>{dataQuality.overduePlannedEntries}</dd></div>
            </dl>
          </section>

          <section className="panel">
            <div className="panel__header panel__header--compact">
              <div>
                <h2>Nächste Einträge</h2>
                <p>Geplant und bevorstehend</p>
              </div>
            </div>
            <div className="upcoming-list">
              {upcoming.map((entry) => (
                <button type="button" key={entry.id} onClick={() => onEditEntry(entry)}>
                  <span className="upcoming-list__date">{formatDate(entry.startDateTime)}</span>
                  <strong>
                    {entry.childIds.map((id) => data.children.find((child) => child.id === id)?.name).filter(Boolean).join(" und ")}
                  </strong>
                  <small>{entry.status === "planned" ? "Geplant" : "Durchgeführt"}{entry.overnight ? " · Übernachtung" : ""}</small>
                </button>
              ))}
              {upcoming.length === 0 ? <p className="empty-copy">Keine bevorstehenden Einträge.</p> : null}
            </div>
          </section>

          <section className={`privacy-card ${backupIsCurrent ? "" : "privacy-card--warning"}`}>
            <Icon name={backupIsCurrent ? "check" : "alert"} size={19} />
            <div>
              <strong>{backupIsCurrent ? "Backup aktuell" : "Backup erforderlich"}</strong>
              <p>
                {backupIsCurrent && data.lastJsonBackupAt
                  ? `Letzte JSON-Sicherung: ${formatDate(data.lastJsonBackupAt)}.`
                  : data.lastJsonBackupAt
                    ? `Letzte Sicherung vor ${backupAgeDays} Tagen.`
                    : "Noch keine JSON-Sicherung dokumentiert."}
              </p>
            </div>
          </section>
        </aside>
      </div>

      {showClosure ? (
        <Modal
          title={closure ? `Monatsabschluss ${formatMonth(monthKey)}` : `Monat ${formatMonth(monthKey)} abschließen`}
          onClose={() => setShowClosure(false)}
        >
          <div className="closure-dialog">
            {closure ? (
              <>
                <div className="notice">
                  <Icon name="lock" />
                  <p>Der Monat wurde am {formatDateTime(closure.closedAt)} abgeschlossen. Änderungen bleiben nach einem Warnhinweis möglich und werden protokolliert.</p>
                </div>
                <ClosureSummary summary={closure.summary} />
              </>
            ) : (
              <>
                {closurePreview.warnings.length ? (
                  <div className="notice notice--warning">
                    <Icon name="alert" />
                    <div>
                      <strong>Hinweise vor dem Abschluss</strong>
                      <ul>
                        {closurePreview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="notice notice--success">
                    <Icon name="check" />
                    <p>Die Plausibilitätsprüfung enthält keine offenen Hinweise.</p>
                  </div>
                )}
                <ClosureSummary summary={closurePreview} />
                <p className="muted-copy">Der Abschluss speichert diese Monatszusammenfassung. Spätere Änderungen sind nur nach einem ausdrücklichen Warnhinweis möglich.</p>
                <label className="closure-confirmation">
                  <input
                    type="checkbox"
                    checked={closureConfirmed}
                    onChange={(event) => setClosureConfirmed(event.target.checked)}
                  />
                  <FieldHelpLabel fieldId="monthClosure.warnings">
                    Ich habe die Hinweise und die Monatszusammenfassung geprüft.
                  </FieldHelpLabel>
                </label>
              </>
            )}
            <footer className="form-actions">
              <span />
              <div className="form-actions__right">
                <button className="button button--secondary" type="button" onClick={() => setShowClosure(false)}>Schließen</button>
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
                    Monat verbindlich abschließen
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
  summary
}: {
  summary: ReturnType<typeof buildMonthlyClosureSummary>;
}) {
  return (
    <dl className="closure-summary">
      <div><dt>Einträge</dt><dd>{summary.entryCount}</dd></div>
      <div><dt>Durchgeführt</dt><dd>{summary.completedEntries}</dd></div>
      <div><dt>Geplant</dt><dd>{summary.plannedEntries}</dd></div>
      <div><dt>Ausgefallen</dt><dd>{summary.cancelledEntries}</dd></div>
      <div><dt>Betreuungstage</dt><dd>{summary.careDays}</dd></div>
      <div><dt>Übernachtungen</dt><dd>{summary.overnights}</dd></div>
      <div><dt>Wochenenden</dt><dd>{summary.weekends}</dd></div>
      <div><dt>Vollständigkeit</dt><dd>{summary.completeness} %</dd></div>
    </dl>
  );
}
