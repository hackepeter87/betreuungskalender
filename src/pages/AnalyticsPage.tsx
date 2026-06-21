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
import { costCategoryLabels } from "../lib/labels";
import { useAppStore } from "../store/AppStore";

const euro = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR"
});

export function AnalyticsPage({ monthKey }: { monthKey: string }) {
  const { locale } = useI18n();
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
          <p className="page-header__context">Zeitraumauswertung</p>
          <h1>Auswertung</h1>
        </div>
      </div>

      <PeriodSelector value={selection} onChange={setSelection} />

      <div className="analytics-export-actions">
        <span className="action-with-help">
          <button className="button button--secondary" type="button" onClick={exportRangeCsv}>
            <Icon name="download" size={17} />
            CSV Zeitraum
          </button>
          <FieldHelpButton fieldId="export.csvExport" showRequirement={false} />
        </span>
        <span className="action-with-help">
          <button className="button button--primary" type="button" onClick={exportRangePdf} disabled={creatingPdf}>
            <Icon name="fileText" size={17} />
            {creatingPdf ? "PDF wird erstellt …" : "PDF Bericht"}
          </button>
          <FieldHelpButton fieldId="export.pdfReport" showRequirement={false} />
        </span>
      </div>
      <MobileExportNotice />

      <section className="summary-strip summary-strip--six">
        <div><small>Betreuungstage</small><strong>{stats.careDays}</strong></div>
        <div><small>Betreuungsstunden</small><strong>{stats.careHours.toLocaleString("de-DE")} h</strong></div>
        <div><small>Übernachtungen</small><strong>{stats.overnights}</strong></div>
        <div><small>Zusatzbetreuung</small><strong>{stats.additionalEntries}</strong></div>
        <div><small>Fahrtkilometer</small><strong>{stats.tripKm.toFixed(1)}</strong></div>
        <div><small>Kosten</small><strong>{euro.format(stats.costsTotal)}</strong></div>
      </section>

      <details className="panel analytics-section analytics-details" open>
        <summary className="panel__header">
          <div>
            <h2>Auswertung je Kind und gemeinsam</h2>
            <p>Kosten und Fahrten gemeinsamer Einträge werden in den Kinderzeilen anteilig verteilt.</p>
          </div>
          <Icon name="chevronRight" size={18} />
        </summary>
        <div className="table-scroll">
          <table className="stats-table stats-table--wide responsive-table">
            <thead>
              <tr>
                <th>Auswertung</th>
                <th>Tage</th>
                <th>Nächte</th>
                <th>Wochenenden</th>
                <th>Wochentagsnächte</th>
                <th>Zusätzlich</th>
                <th>Ferientage</th>
                <th>Quote Tage</th>
                <th>Quote Nächte</th>
                <th>km</th>
                <th>Fahrtkosten</th>
                <th>Kosten</th>
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
                <td data-label="Auswertung">Gemeinsam</td>
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
              <h2>Soll-Ist und Zusatzbetreuung</h2>
              <p>Termine aus der 14-Tage-Regel im Zeitraum</p>
            </div>
          </div>
          <dl className="key-value-list">
            <div><dt>Geplante Soll-Termine</dt><dd>{stats.contact.scheduled}</dd></div>
            <div><dt>Noch offen</dt><dd>{stats.contact.pending}</dd></div>
            <div><dt>Durchgeführt</dt><dd>{stats.contact.completed}</dd></div>
            <div><dt>Dienstlich ausgefallen</dt><dd>{stats.contact.cancelledDutyRelated}</dd></div>
            <div><dt>Sonstig ausgefallen</dt><dd>{stats.contact.cancelledOther}</dd></div>
            <div><dt>Überschneidungen</dt><dd>{stats.contact.unavailableOverlaps}</dd></div>
            <div><dt>Zusätzlich</dt><dd>{stats.contact.additional}</dd></div>
          </dl>
        </section>

        <section className="panel">
          <div className="panel__header panel__header--compact">
            <div>
              <h2>Fahrten</h2>
              <p>Kilometersatz: {data.settings.kilometerRate.toFixed(2)} EUR/km</p>
            </div>
          </div>
          <dl className="key-value-list">
            <div><dt>Gefahrene Kilometer</dt><dd>{stats.tripKm.toFixed(1)} km</dd></div>
            <div><dt>Rechnerische Fahrtkosten</dt><dd>{euro.format(stats.calculatedTravelCost)}</dd></div>
            <div><dt>Dokumentierte Erstattungen</dt><dd>{euro.format(stats.reimbursedAmount)}</dd></div>
          </dl>
        </section>

        <section className="panel">
          <div className="panel__header panel__header--compact">
            <div>
              <h2>Kosten nach Kategorie</h2>
              <p>Durchgeführte Betreuungseinträge</p>
            </div>
          </div>
          <dl className="key-value-list">
            {Object.entries(stats.costsByCategory).map(([category, amount]) => (
              <div key={category}>
                <dt>{costCategoryLabels[category as keyof typeof costCategoryLabels]}</dt>
                <dd>{euro.format(amount)}</dd>
              </div>
            ))}
            <div className="key-value-list__total"><dt>Gesamt</dt><dd>{euro.format(stats.costsTotal)}</dd></div>
          </dl>
        </section>

        <section className="panel">
          <div className="panel__header panel__header--compact">
            <div>
              <h2>Ferienaufteilung</h2>
              <p>Geteilte Tage werden hälftig angerechnet.</p>
            </div>
          </div>
          <dl className="key-value-list">
            <div><dt>Ferientage gesamt</dt><dd>{stats.holidays.totalDays}</dd></div>
            <div><dt>Beim Vater</dt><dd>{stats.holidays.fatherDays}</dd></div>
            <div><dt>Bei der Mutter</dt><dd>{stats.holidays.motherDays}</dd></div>
            <div><dt>Vaterquote</dt><dd>{stats.holidays.fatherQuote} %</dd></div>
            <div><dt>Dienstliche Nichtverfügbarkeiten</dt><dd>{stats.holidays.unavailablePeriods}</dd></div>
          </dl>
        </section>
      </div>

      <section className="notice">
        <Icon name="info" />
        <div>
          <strong>Sachliche Auswertung</strong>
          <p>Quoten beziehen sich auf alle Kalendertage beziehungsweise Nächte des gewählten Zeitraums. Die Auswertung stellt keine rechtliche Bewertung dar.</p>
        </div>
      </section>
    </div>
  );
}
