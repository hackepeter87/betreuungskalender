import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { FieldHelpButton, FieldHelpLabel } from "../components/FieldHelp";
import { MobileExportNotice } from "../components/MobileExportNotice";
import {
  PeriodSelector,
  periodSelection,
  type PeriodSelection
} from "../components/PeriodSelector";
import {
  calculatePeriodStats,
  entriesForRange,
  unavailablePeriodsForRange
} from "../lib/analytics";
import { formatDate, formatDateTime, formatTime, toMonthKey } from "../lib/date";
import {
  costCategoryLabel,
  deviationLabel,
  statusLabel,
  unavailableCategoryLabel,
  unavailableScopeLabel
} from "../lib/labels";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";
import { reportMessages } from "../i18n/reportMessages";
import { reportClosureDescription } from "../lib/monthClosure";
import { exportPdfReport } from "../lib/report";
import { useAppStore } from "../store/AppStore";
import { api, mapReportSnapshotData } from "../lib/api";
import type { ApiReportSnapshot } from "../../shared/api";

export function ReportPage() {
  const { locale, intlLocale, t } = useI18n();
  const messages = reportMessages[locale];
  const euro = useMemo(
    () =>
      new Intl.NumberFormat(intlLocale, {
        style: "currency",
        currency: "EUR"
      }),
    [intlLocale]
  );
  const { data, session } = useAppStore();
  const [selection, setSelection] = useState<PeriodSelection>(() =>
    periodSelection("month", toMonthKey(new Date()))
  );
  const [creatingPdf, setCreatingPdf] = useState(false);
  const [includeAuditHistory, setIncludeAuditHistory] = useState(false);
  const [reportId, setReportId] = useState("");
  const [reportCreatedAt, setReportCreatedAt] = useState(() => new Date().toISOString());
  const [reportData, setReportData] = useState(data);
  const [loadingSnapshot, setLoadingSnapshot] = useState(true);
  const [staleSnapshot, setStaleSnapshot] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const canIncludeAuditHistory = session.permissions?.includes("audit:view") ?? false;
  const stats = useMemo(
    () => calculatePeriodStats(reportData, selection.startDate, selection.endDate),
    [reportData, selection.endDate, selection.startDate]
  );
  const entries = useMemo(
    () =>
      entriesForRange(reportData.entries, selection.startDate, selection.endDate)
        .slice()
        .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime)),
    [reportData.entries, selection.endDate, selection.startDate]
  );
  const auditEntries = useMemo(
    () =>
      reportData.auditLog
        .filter(
          (entry) =>
            entry.effectiveDate &&
            entry.effectiveDate >= selection.startDate &&
            entry.effectiveDate <= selection.endDate
        )
        .slice()
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    [reportData.auditLog, selection.endDate, selection.startDate]
  );
  const unavailablePeriods = useMemo(
    () =>
      unavailablePeriodsForRange(
        reportData.unavailablePeriods,
        selection.startDate,
        selection.endDate
      ).sort((a, b) => a.startDateTime.localeCompare(b.startDateTime)),
    [reportData.unavailablePeriods, selection.endDate, selection.startDate]
  );
  const closureDescription = useMemo(
    () =>
      reportClosureDescription(
        reportData,
        selection.startDate,
        selection.endDate,
        locale
      ),
    [reportData, locale, selection.endDate, selection.startDate]
  );
  const hasAnyEntries = reportData.entries.some((entry) => !entry.deletedAt);

  useEffect(() => {
    if (selection.endDate < selection.startDate) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoadingSnapshot(true);
      void api.reportSnapshot(
        selection.startDate,
        selection.endDate,
        canIncludeAuditHistory && includeAuditHistory,
        controller.signal
      ).then((snapshot: ApiReportSnapshot) => {
        setReportData(mapReportSnapshotData(snapshot));
        setReportId(snapshot.reportId);
        setReportCreatedAt(snapshot.generatedAt);
        setStaleSnapshot(false);
      }).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStaleSnapshot(true);
      }).finally(() => {
        if (!controller.signal.aborted) setLoadingSnapshot(false);
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canIncludeAuditHistory, includeAuditHistory, refreshRevision, selection.endDate, selection.startDate]);

  const createPdf = async () => {
    setCreatingPdf(true);
    try {
      await exportPdfReport(reportData, selection.startDate, selection.endDate, {
        reportId,
        includeAuditHistory,
        createdAt: reportCreatedAt,
        locale
      });
    } finally {
      setCreatingPdf(false);
    }
  };

  return (
    <div className="page report-page" data-testid="page-report">
      <div className="page-header no-print">
        <div>
          <p className="page-header__context">{t("report.context")}</p>
          <h1>{t("report.pageTitle")}</h1>
        </div>
        <div className="page-header__actions">
          {canIncludeAuditHistory ? <label className="check-row report-history-toggle">
            <input type="checkbox" checked={includeAuditHistory} onChange={(event) => setIncludeAuditHistory(event.target.checked)} />
            <FieldHelpLabel fieldId="export.includeAudit">
              {t("report.includeHistory")}
            </FieldHelpLabel>
          </label> : null}
          <button className="button button--secondary" type="button" onClick={() => setRefreshRevision((value) => value + 1)} disabled={loadingSnapshot}>
            <Icon name="history" size={17} />
            {t("report.refresh")}
          </button>
          <button className="button button--secondary" type="button" onClick={() => window.print()} disabled={loadingSnapshot || staleSnapshot}>
            <Icon name="printer" size={17} />
            {t("report.print")}
          </button>
          <button className="button button--primary" type="button" onClick={createPdf} disabled={creatingPdf || loadingSnapshot || staleSnapshot}>
            <Icon name="download" size={17} />
            {creatingPdf ? t("report.creating") : t("report.download")}
          </button>
          <FieldHelpButton fieldId="export.pdfReport" showRequirement={false} />
        </div>
      </div>

      <div className="no-print">
        <PeriodSelector value={selection} onChange={setSelection} />
        <MobileExportNotice />
      </div>

      {loadingSnapshot ? <div className="notice no-print" role="status"><Icon name="history" size={17} />{t("report.loading")}</div> : null}
      {staleSnapshot ? <div className="notice notice--warning no-print" role="alert"><Icon name="alert" size={17} />{t("report.stale")}</div> : null}

      {!hasAnyEntries ? (
        <section className="panel empty-state no-print" data-testid="report-empty-state">
          <span><Icon name="fileText" size={25} /></span>
          <h2>{t("report.emptyTitle")}</h2>
          <p>{t("report.emptyDescription")}</p>
        </section>
      ) : null}

      <article className="report-document" data-testid="report-document">
        <header className="report-document__header">
          <div>
            <p>{t("app.name")}</p>
            <h1 data-testid="report-title">{t("report.documentTitle")}</h1>
          </div>
          <dl>
            <div><dt>{messages.createdAt}</dt><dd>{formatDateTime(reportCreatedAt, intlLocale)}</dd></div>
            <div><dt>{messages.reportId}</dt><dd>{reportId}</dd></div>
            <div><dt>{messages.period}</dt><dd>{formatDate(selection.startDate, intlLocale)} {messages.through} {formatDate(selection.endDate, intlLocale)}</dd></div>
            <div><dt>{messages.dataAsOf}</dt><dd>{formatDateTime(reportData.updatedAt, intlLocale)}</dd></div>
            <div><dt>{messages.closureStatus}</dt><dd>{closureDescription}</dd></div>
            <div><dt>{messages.children}</dt><dd>{reportData.children.map((child) => child.name).join(", ") || messages.noChildren}</dd></div>
          </dl>
        </header>

        <section className="report-section">
          <h2>{messages.childSummary}</h2>
          <div className="table-scroll">
            <table className="report-table responsive-table">
              <thead>
                <tr>
                  <th>{messages.child}</th>
                  <th>{messages.careDays}</th>
                  <th>{messages.overnights}</th>
                  <th>{messages.weekends}</th>
                  <th>{messages.additionalCare}</th>
                  <th>{messages.holidayDays}</th>
                  <th>{messages.dayQuote}</th>
                  <th>{messages.nightQuote}</th>
                </tr>
              </thead>
              <tbody>
                {stats.byChild.map((childStats) => (
                  <tr key={childStats.childId}>
                    <td data-label={messages.child}>{reportData.children.find((child) => child.id === childStats.childId)?.name}</td>
                    <td data-label={messages.careDays}>{childStats.careDays}</td>
                    <td data-label={messages.overnights}>{childStats.overnights}</td>
                    <td data-label={messages.weekends}>{childStats.weekends}</td>
                    <td data-label={messages.additionalCare}>{childStats.additionalEntries}</td>
                    <td data-label={messages.holidayDays}>{childStats.holidayDays}</td>
                    <td data-label={messages.dayQuote}>{childStats.careDayQuote} %</td>
                    <td data-label={messages.nightQuote}>{childStats.overnightQuote} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="report-section report-summary-grid">
          <div>
            <h2>{messages.plannedActual}</h2>
            <dl className="report-definition-list">
              <div><dt>{messages.plannedDates}</dt><dd>{stats.contact.scheduled}</dd></div>
              <div><dt>{messages.completed}</dt><dd>{stats.contact.completed}</dd></div>
              <div><dt>{messages.cancelledDuty}</dt><dd>{stats.contact.cancelledDutyRelated}</dd></div>
              <div><dt>{messages.cancelledOther}</dt><dd>{stats.contact.cancelledOther}</dd></div>
              <div><dt>{messages.externallyBlocked}</dt><dd>{stats.contact.externallyBlocked}</dd></div>
              <div><dt>{messages.overlaps}</dt><dd>{stats.contact.unavailableOverlaps}</dd></div>
              <div><dt>{messages.unresolvedCare}</dt><dd>{stats.unresolvedCareHours} h</dd></div>
              <div><dt>{messages.additionalDates}</dt><dd>{stats.contact.additional}</dd></div>
            </dl>
          </div>
          <div>
            <h2>{messages.holidayAllocation}</h2>
            <dl className="report-definition-list">
              <div><dt>{messages.totalHolidayDays}</dt><dd>{stats.holidays.totalDays}</dd></div>
              <div><dt>{messages.father}</dt><dd>{stats.holidays.fatherDays}</dd></div>
              <div><dt>{messages.mother}</dt><dd>{stats.holidays.motherDays}</dd></div>
              <div><dt>{messages.fatherQuote}</dt><dd>{stats.holidays.fatherQuote} %</dd></div>
              <div><dt>{messages.dutyUnavailability}</dt><dd>{stats.holidays.unavailablePeriods}</dd></div>
              {stats.holidays.byCareParty.map((share) => (
                <div key={share.carePartyId}><dt>{share.name}</dt><dd>{share.days} / {share.quote} %</dd></div>
              ))}
              {stats.holidays.unassignedDays > 0 ? (
                <div><dt>{copy(locale, "holiday", "unassignedDays")}</dt><dd>{stats.holidays.unassignedDays}</dd></div>
              ) : null}
              {stats.holidays.unresolvedDays > 0 ? (
                <div><dt>{messages.unresolvedHoliday}</dt><dd>{stats.holidays.unresolvedDays}</dd></div>
              ) : null}
            </dl>
          </div>
          <div>
            <h2>{messages.tripsAndCosts}</h2>
            <dl className="report-definition-list">
              <div><dt>{messages.tripKm}</dt><dd>{stats.tripKm.toFixed(1)} km</dd></div>
              <div><dt>{messages.calculatedTripCosts}</dt><dd>{euro.format(stats.calculatedTravelCost)}</dd></div>
              <div><dt>{messages.reimbursements}</dt><dd>{euro.format(stats.reimbursedAmount)}</dd></div>
              <div><dt>{messages.documentedCosts}</dt><dd>{euro.format(stats.costsTotal)}</dd></div>
            </dl>
          </div>
          <div>
            <h2>{messages.costsByCategory}</h2>
            <dl className="report-definition-list">
              {Object.entries(stats.costsByCategory).map(([category, amount]) => (
                <div key={category}>
                  <dt>{costCategoryLabel(category as keyof typeof stats.costsByCategory, locale)}</dt>
                  <dd>{euro.format(amount)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="report-section">
          <h2>{messages.dutyUnavailabilityTitle}</h2>
          <p className="report-note">
            {messages.unavailabilityNote}
          </p>
          <div className="table-scroll">
            <table className="report-table responsive-table">
              <thead>
                <tr>
                  <th>{messages.period}</th>
                  <th>{messages.scope}</th>
                  <th>{messages.category}</th>
                  <th>{messages.careParty}</th>
                  <th>{messages.children}</th>
                  <th>{messages.dutyRelated}</th>
                  <th>{messages.affects}</th>
                  <th>{messages.location}</th>
                  <th>{messages.evidenceReference}</th>
                  <th>{messages.note}</th>
                </tr>
              </thead>
              <tbody>
                {unavailablePeriods.map((period) => (
                  <tr key={period.id}>
                    <td data-label={messages.period}>
                      {formatDate(period.startDateTime, intlLocale)} {formatTime(period.startDateTime, intlLocale)}
                      <br />
                      {messages.through} {formatDate(period.endDateTime, intlLocale)} {formatTime(period.endDateTime, intlLocale)}
                    </td>
                    <td data-label={messages.scope}>{unavailableScopeLabel(period.scope, locale)}</td>
                    <td data-label={messages.category}>{unavailableCategoryLabel(period.category, locale)}</td>
                    <td data-label={messages.careParty}>
                      {period.responsiblePartyId
                        ? reportData.careParties.find((party) => party.id === period.responsiblePartyId)?.name ?? period.responsiblePartyId
                        : "–"}
                    </td>
                    <td data-label={messages.children}>
                      {period.childIds.length
                        ? period.childIds.map((id) => reportData.children.find((child) => child.id === id)?.name ?? id).join(", ")
                        : "–"}
                    </td>
                    <td data-label={messages.dutyRelated}>{period.dutyRelated ? messages.yes : messages.no}</td>
                    <td data-label={messages.affects}>
                      {[
                        period.affectsContact ? messages.contact : "",
                        period.affectsHolidays ? messages.holidays : ""
                      ].filter(Boolean).join(", ") || "–"}
                    </td>
                    <td data-label={messages.location}>{period.location || "–"}</td>
                    <td data-label={messages.evidenceReference}>{period.evidenceReference || "–"}</td>
                    <td data-label={messages.note}>{period.notes || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {unavailablePeriods.length === 0 ? (
            <p>{messages.noUnavailable}</p>
          ) : null}
        </section>

        <section className="report-section">
          <h2>{messages.dailyList}</h2>
          <div className="table-scroll">
            <table className="report-table report-table--entries responsive-table">
              <thead>
                <tr>
                  <th>{messages.period}</th>
                  <th>{messages.children}</th>
                  <th>{messages.status}</th>
                  <th>{messages.classification}</th>
                  <th>{messages.trips}</th>
                  <th>{messages.costs}</th>
                  <th>{messages.notesOrReason}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label={messages.period}>{formatDate(entry.startDateTime, intlLocale)} {formatTime(entry.startDateTime, intlLocale)}<br />{messages.through} {formatDate(entry.endDateTime, intlLocale)} {formatTime(entry.endDateTime, intlLocale)}</td>
                    <td data-label={messages.children}>{entry.childIds.map((id) => reportData.children.find((child) => child.id === id)?.name).filter(Boolean).join(", ")}</td>
                    <td data-label={messages.status}>{statusLabel(entry.status, locale)}</td>
                    <td data-label={messages.classification}>
                      {entry.generatedByPatternId ? messages.plannedDate : entry.additionalCare ? messages.additionalCare : messages.singleDate}
                      {entry.overnight ? <><br />{messages.overnight}</> : null}
                      {entry.holiday ? <><br />{messages.holiday}</> : null}
                      {entry.deviationType ? <><br />{deviationLabel(entry.deviationType, locale)}</> : null}
                      {entry.plannedStartDateTime && entry.plannedEndDateTime ? (
                        <>
                          <br />
                          {messages.originalPlan}: {formatDate(entry.plannedStartDateTime, intlLocale)} {formatTime(entry.plannedStartDateTime, intlLocale)}-{formatTime(entry.plannedEndDateTime, intlLocale)}
                        </>
                      ) : null}
                    </td>
                    <td
                      data-label={messages.trips}
                      data-testid="report-entry-trip-km"
                      data-value={entry.trips.filter((trip) => !trip.deletedAt).reduce((sum, trip) => sum + trip.km, 0)}
                    >
                      {entry.trips.filter((trip) => !trip.deletedAt).reduce((sum, trip) => sum + trip.km, 0).toFixed(1)} km
                    </td>
                    <td
                      data-label={messages.costs}
                      data-testid="report-entry-cost"
                      data-value={entry.costs.filter((cost) => !cost.deletedAt).reduce((sum, cost) => sum + cost.amount, 0)}
                    >
                      {euro.format(entry.costs.filter((cost) => !cost.deletedAt).reduce((sum, cost) => sum + cost.amount, 0))}
                    </td>
                    <td data-label={messages.notesOrReason}>{entry.deviationNote || entry.cancellationReason || entry.notes || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {entries.length === 0 ? <p>{messages.noEntries}</p> : null}
        </section>

        {includeAuditHistory ? (
          <section className="report-section">
            <h2>{messages.changeHistory}</h2>
            <p className="report-note">{messages.historyNote}</p>
            <div className="table-scroll">
              <table className="report-table report-table--entries responsive-table">
                <thead>
                  <tr>
                    <th>{messages.timestamp}</th>
                    <th>{messages.object}</th>
                    <th>{messages.action}</th>
                    <th>{messages.field}</th>
                    <th>{messages.oldValue}</th>
                    <th>{messages.newValue}</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td data-label={messages.timestamp}>{formatDateTime(entry.timestamp, intlLocale)}</td>
                      <td data-label={messages.object}>{entry.objectLabel}</td>
                      <td data-label={messages.action}>{entry.action === "created" ? messages.created : entry.action === "deleted" ? messages.deleted : messages.changed}</td>
                      <td data-label={messages.field}>{entry.field}</td>
                      <td data-label={messages.oldValue}>{entry.oldValue}</td>
                      <td data-label={messages.newValue}>{entry.newValue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {auditEntries.length === 0 ? <p>{messages.noChanges}</p> : null}
          </section>
        ) : null}

        <footer className="report-document__footer">
          {messages.reportFooter}
        </footer>
      </article>
    </div>
  );
}
