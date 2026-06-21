import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { FieldHelpButton } from "../components/FieldHelp";
import { MobileExportNotice } from "../components/MobileExportNotice";
import {
  PeriodSelector,
  periodSelection,
  type PeriodSelection
} from "../components/PeriodSelector";
import { calculatePeriodStats, entriesForRange } from "../lib/analytics";
import { exportEntriesCsv } from "../lib/export";
import { exportPdfReport, makeReportId } from "../lib/report";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";
import { costCategoryLabel } from "../lib/labels";
import { useAppStore } from "../store/AppStore";

export function AnalyticsPage({ monthKey }: { monthKey: string }) {
  const { locale, intlLocale } = useI18n();
  const euro = useMemo(() => new Intl.NumberFormat(intlLocale, { style: "currency", currency: "EUR" }), [intlLocale]);
  const { data } = useAppStore();
  const [selection, setSelection] = useState<PeriodSelection>(() =>
    periodSelection("month", monthKey)
  );
  const [creatingPdf, setCreatingPdf] = useState(false);
  const stats = useMemo(
    () => calculatePeriodStats(data, selection.startDate, selection.endDate),
    [data, selection.endDate, selection.startDate]
  );
  const exportRangeCsv = () =>
    exportEntriesCsv({
      ...data,
      entries: entriesForRange(data.entries, selection.startDate, selection.endDate)
    });
  const exportRangePdf = async () => {
    setCreatingPdf(true);
    try {
      await exportPdfReport(data, selection.startDate, selection.endDate, {
      reportId: makeReportId(),
      includeAuditHistory: false,
      createdAt: new Date().toISOString(),
      locale
      });
    } finally {
      setCreatingPdf(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="page-header__context">{copy(locale, "analytics", "context")}</p>
          <h1>{copy(locale, "analytics", "title")}</h1>
        </div>
      </div>

      <PeriodSelector value={selection} onChange={setSelection} />

      <div className="analytics-export-actions">
        <span className="action-with-help">
          <button className="button button--secondary" type="button" onClick={exportRangeCsv}>
            <Icon name="download" size={17} />
            {copy(locale, "analytics", "csvPeriod")}
          </button>
          <FieldHelpButton fieldId="export.csvExport" showRequirement={false} />
        </span>
        <span className="action-with-help">
          <button className="button button--primary" type="button" onClick={exportRangePdf} disabled={creatingPdf}>
            <Icon name="fileText" size={17} />
            {creatingPdf ? copy(locale, "analytics", "creatingPdf") : copy(locale, "analytics", "pdfReport")}
          </button>
          <FieldHelpButton fieldId="export.pdfReport" showRequirement={false} />
        </span>
      </div>
      <MobileExportNotice />

      <section className="summary-strip summary-strip--six">
        <div><small>{copy(locale, "analytics", "careDays")}</small><strong>{stats.careDays}</strong></div>
        <div><small>{copy(locale, "analytics", "careHours")}</small><strong>{stats.careHours.toLocaleString(intlLocale)} h</strong></div>
        <div><small>{copy(locale, "analytics", "overnights")}</small><strong>{stats.overnights}</strong></div>
        <div><small>{copy(locale, "analytics", "additionalCare")}</small><strong>{stats.additionalEntries}</strong></div>
        <div><small>{copy(locale, "analytics", "tripKm")}</small><strong>{stats.tripKm.toFixed(1)}</strong></div>
        <div><small>{copy(locale, "analytics", "costs")}</small><strong>{euro.format(stats.costsTotal)}</strong></div>
      </section>

      <details className="panel analytics-section analytics-details" open>
        <summary className="panel__header">
          <div>
            <h2>{copy(locale, "analytics", "byChild")}</h2>
            <p>{copy(locale, "analytics", "byChildDescription")}</p>
          </div>
          <Icon name="chevronRight" size={18} />
        </summary>
        <div className="table-scroll">
          <table className="stats-table stats-table--wide responsive-table">
            <thead>
              <tr>
                <th>{copy(locale, "analytics", "analysis")}</th>
                <th>{copy(locale, "analytics", "days")}</th>
                <th>{copy(locale, "analytics", "nights")}</th>
                <th>{copy(locale, "analytics", "weekends")}</th>
                <th>{copy(locale, "analytics", "weekdayNights")}</th>
                <th>{copy(locale, "analytics", "additional")}</th>
                <th>{copy(locale, "analytics", "holidayDays")}</th>
                <th>{copy(locale, "analytics", "dayQuote")}</th>
                <th>{copy(locale, "analytics", "nightQuote")}</th>
                <th>km</th>
                <th>{copy(locale, "analytics", "travelCosts")}</th>
                <th>{copy(locale, "analytics", "costs")}</th>
              </tr>
            </thead>
            <tbody>
              {stats.byChild.map((childStats) => {
                const child = data.children.find((item) => item.id === childStats.childId);
                return (
                  <tr key={childStats.childId}>
                    <td data-label="Auswertung"><span className="table-child"><span className="child-dot" style={{ backgroundColor: child?.color }} />{child?.name}</span></td>
                    <td data-label="Tage">{childStats.careDays}</td>
                    <td data-label="Nächte">{childStats.overnights}</td>
                    <td data-label="Wochenenden">{childStats.weekends}</td>
                    <td data-label="Wochentagsnächte">{childStats.weekdayOvernights}</td>
                    <td data-label="Zusätzlich">{childStats.additionalEntries}</td>
                    <td data-label="Ferientage">{childStats.holidayDays}</td>
                    <td data-label="Quote Tage">{childStats.careDayQuote} %</td>
                    <td data-label="Quote Nächte">{childStats.overnightQuote} %</td>
                    <td data-label="Kilometer">{childStats.tripKm.toFixed(1)}</td>
                    <td data-label="Fahrtkosten">{euro.format(childStats.calculatedTravelCost)}</td>
                    <td data-label="Kosten">{euro.format(childStats.costsTotal)}</td>
                  </tr>
                );
              })}
              <tr className="stats-table__total">
                <td data-label={copy(locale, "analytics", "analysis")}>{copy(locale, "analytics", "combined")}</td>
                <td data-label="Tage">{stats.careDays}</td>
                <td data-label="Nächte">{stats.overnights}</td>
                <td data-label="Wochenenden">{stats.weekends}</td>
                <td data-label="Wochentagsnächte">{stats.weekdayOvernights}</td>
                <td data-label="Zusätzlich">{stats.additionalEntries}</td>
                <td data-label="Ferientage">{stats.holidayDays}</td>
                <td data-label="Quote Tage">{stats.careDayQuote} %</td>
                <td data-label="Quote Nächte">{stats.overnightQuote} %</td>
                <td data-label="Kilometer">{stats.tripKm.toFixed(1)}</td>
                <td data-label="Fahrtkosten">{euro.format(stats.calculatedTravelCost)}</td>
                <td data-label="Kosten">{euro.format(stats.costsTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      <div className="two-column-layout analytics-grid">
        <section className="panel">
          <div className="panel__header panel__header--compact">
            <div>
            <h2>{copy(locale, "analytics", "plannedActual")}</h2>
            <p>{copy(locale, "analytics", "plannedActualDescription")}</p>
            </div>
          </div>
          <dl className="key-value-list">
            <div><dt>{copy(locale, "analytics", "plannedDates")}</dt><dd>{stats.contact.scheduled}</dd></div>
            <div><dt>{copy(locale, "analytics", "pending")}</dt><dd>{stats.contact.pending}</dd></div>
            <div><dt>{copy(locale, "analytics", "completed")}</dt><dd>{stats.contact.completed}</dd></div>
            <div><dt>{copy(locale, "analytics", "cancelledDuty")}</dt><dd>{stats.contact.cancelledDutyRelated}</dd></div>
            <div><dt>{copy(locale, "analytics", "cancelledOther")}</dt><dd>{stats.contact.cancelledOther}</dd></div>
            <div><dt>{copy(locale, "analytics", "overlaps")}</dt><dd>{stats.contact.unavailableOverlaps}</dd></div>
            <div><dt>{copy(locale, "analytics", "additional")}</dt><dd>{stats.contact.additional}</dd></div>
          </dl>
        </section>

        <section className="panel">
          <div className="panel__header panel__header--compact">
            <div>
            <h2>{copy(locale, "analytics", "trips")}</h2>
            <p>{copy(locale, "analytics", "rate", { rate: data.settings.kilometerRate.toFixed(2) })}</p>
            </div>
          </div>
          <dl className="key-value-list">
            <div><dt>{copy(locale, "analytics", "drivenKm")}</dt><dd>{stats.tripKm.toFixed(1)} km</dd></div>
            <div><dt>{copy(locale, "analytics", "calculatedTravelCost")}</dt><dd>{euro.format(stats.calculatedTravelCost)}</dd></div>
            <div><dt>{copy(locale, "analytics", "reimbursements")}</dt><dd>{euro.format(stats.reimbursedAmount)}</dd></div>
          </dl>
        </section>

        <section className="panel">
          <div className="panel__header panel__header--compact">
            <div>
            <h2>{copy(locale, "analytics", "costsByCategory")}</h2>
            <p>{copy(locale, "analytics", "completedEntries")}</p>
            </div>
          </div>
          <dl className="key-value-list">
            {Object.entries(stats.costsByCategory).map(([category, amount]) => (
              <div key={category}>
                <dt>{costCategoryLabel(category as keyof typeof stats.costsByCategory, locale)}</dt>
                <dd>{euro.format(amount)}</dd>
              </div>
            ))}
            <div className="key-value-list__total"><dt>{copy(locale, "analytics", "total")}</dt><dd>{euro.format(stats.costsTotal)}</dd></div>
          </dl>
        </section>

        <section className="panel">
          <div className="panel__header panel__header--compact">
            <div>
            <h2>{copy(locale, "analytics", "holidayAllocation")}</h2>
            <p>{copy(locale, "analytics", "holidayDescription")}</p>
            </div>
          </div>
          <dl className="key-value-list">
            <div><dt>{copy(locale, "holiday", "totalDays")}</dt><dd>{stats.holidays.totalDays}</dd></div>
            <div><dt>{copy(locale, "analytics", "fatherDays")}</dt><dd>{stats.holidays.fatherDays}</dd></div>
            <div><dt>{copy(locale, "analytics", "motherDays")}</dt><dd>{stats.holidays.motherDays}</dd></div>
            <div><dt>{copy(locale, "analytics", "fatherQuote")}</dt><dd>{stats.holidays.fatherQuote} %</dd></div>
            <div><dt>{copy(locale, "analytics", "dutyUnavailability")}</dt><dd>{stats.holidays.unavailablePeriods}</dd></div>
          </dl>
        </section>
      </div>

      <section className="notice">
        <Icon name="info" />
        <div>
          <strong>{copy(locale, "analytics", "neutralTitle")}</strong>
          <p>{copy(locale, "analytics", "neutralDescription")}</p>
        </div>
      </section>
    </div>
  );
}
