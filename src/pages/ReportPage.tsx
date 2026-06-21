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
  statusLabel,
  unavailableCategoryLabel
} from "../lib/labels";
import { useI18n } from "../i18n/I18nProvider";
import { reportMessages } from "../i18n/reportMessages";
import { reportClosureDescription } from "../lib/monthClosure";
import { exportPdfReport, makeReportId } from "../lib/report";
import { useAppStore } from "../store/AppStore";

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
  const { data } = useAppStore();
  const [selection, setSelection] = useState<PeriodSelection>(() =>
    periodSelection("month", toMonthKey(new Date()))
  );
  const [creatingPdf, setCreatingPdf] = useState(false);
  const [includeAuditHistory, setIncludeAuditHistory] = useState(false);
  const [reportId, setReportId] = useState(makeReportId);
  const [reportCreatedAt, setReportCreatedAt] = useState(() => new Date().toISOString());
  const stats = useMemo(
    () => calculatePeriodStats(data, selection.startDate, selection.endDate),
    [data, selection.endDate, selection.startDate]
  );
  const entries = useMemo(
    () =>
      entriesForRange(data.entries, selection.startDate, selection.endDate)
        .slice()
        .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime)),
    [data.entries, selection.endDate, selection.startDate]
  );
  const auditEntries = useMemo(
    () =>
      data.auditLog
        .filter(
          (entry) =>
            entry.effectiveDate &&
            entry.effectiveDate >= selection.startDate &&
            entry.effectiveDate <= selection.endDate
        )
        .slice()
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    [data.auditLog, selection.endDate, selection.startDate]
  );
  const unavailablePeriods = useMemo(
    () =>
      unavailablePeriodsForRange(
        data.unavailablePeriods,
        selection.startDate,
        selection.endDate
      ).sort((a, b) => a.startDateTime.localeCompare(b.startDateTime)),
    [data.unavailablePeriods, selection.endDate, selection.startDate]
  );
  const closureDescription = useMemo(
    () =>
      reportClosureDescription(
        data,
        selection.startDate,
        selection.endDate,
        locale
      ),
    [data, locale, selection.endDate, selection.startDate]
  );

  useEffect(() => {
    setReportId(makeReportId());
    setReportCreatedAt(new Date().toISOString());
  }, [data.updatedAt, selection.endDate, selection.startDate]);

  const createPdf = async () => {
    setCreatingPdf(true);
    try {
      const nextReportId = makeReportId();
      const nextCreatedAt = new Date().toISOString();
      setReportId(nextReportId);
      setReportCreatedAt(nextCreatedAt);
      await exportPdfReport(data, selection.startDate, selection.endDate, {
        reportId: nextReportId,
        includeAuditHistory,
        createdAt: nextCreatedAt,
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
          <label className="check-row report-history-toggle">
            <input type="checkbox" checked={includeAuditHistory} onChange={(event) => setIncludeAuditHistory(event.target.checked)} />
            <FieldHelpLabel fieldId="export.includeAudit">
              {t("report.includeHistory")}
            </FieldHelpLabel>
          </label>
          <button className="button button--secondary" type="button" onClick={() => window.print()}>
            <Icon name="printer" size={17} />
            {t("report.print")}
          </button>
          <button className="button button--primary" type="button" onClick={createPdf} disabled={creatingPdf}>
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
            <div><dt>{messages.dataAsOf}</dt><dd>{formatDateTime(data.updatedAt, intlLocale)}</dd></div>
            <div><dt>{messages.closureStatus}</dt><dd>{closureDescription}</dd></div>
            <div><dt>{messages.children}</dt><dd>{data.children.map((child) => child.name).join(", ") || messages.noChildren}</dd></div>
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
                    <td data-label={messages.child}>{data.children.find((child) => child.id === childStats.childId)?.name}</td>
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
              <div><dt>{messages.overlaps}</dt><dd>{stats.contact.unavailableOverlaps}</dd></div>
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
                  <th>{messages.category}</th>
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
                    <td data-label={messages.category}>{unavailableCategoryLabel(period.category, locale)}</td>
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
                    <td data-label={messages.children}>{entry.childIds.map((id) => data.children.find((child) => child.id === id)?.name).filter(Boolean).join(", ")}</td>
                    <td data-label={messages.status}>{statusLabel(entry.status, locale)}</td>
                    <td data-label={messages.classification}>
                      {entry.generatedByPatternId ? messages.plannedDate : entry.additionalCare ? messages.additionalCare : messages.singleDate}
                      {entry.overnight ? <><br />{messages.overnight}</> : null}
                      {entry.holiday ? <><br />{messages.holiday}</> : null}
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
                    <td data-label={messages.notesOrReason}>{entry.cancellationReason || entry.notes || "–"}</td>
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
