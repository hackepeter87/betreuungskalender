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
  costCategoryLabels,
  statusLabels,
  unavailableCategoryLabels
} from "../lib/labels";
import { reportClosureDescription } from "../lib/monthClosure";
import { exportPdfReport, makeReportId } from "../lib/report";
import { useAppStore } from "../store/AppStore";

const euro = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR"
});

export function ReportPage() {
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
    () => reportClosureDescription(data, selection.startDate, selection.endDate),
    [data, selection.endDate, selection.startDate]
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
        createdAt: nextCreatedAt
      });
    } finally {
      setCreatingPdf(false);
    }
  };

  return (
    <div className="page report-page" data-testid="page-report">
      <div className="page-header no-print">
        <div>
          <p className="page-header__context">Neutraler Bericht</p>
          <h1>Bericht & Druckansicht</h1>
        </div>
        <div className="page-header__actions">
          <label className="check-row report-history-toggle">
            <input type="checkbox" checked={includeAuditHistory} onChange={(event) => setIncludeAuditHistory(event.target.checked)} />
            <FieldHelpLabel fieldId="export.includeAudit">
              Änderungshistorie aufnehmen
            </FieldHelpLabel>
          </label>
          <button className="button button--secondary" type="button" onClick={() => window.print()}>
            <Icon name="printer" size={17} />
            Drucken
          </button>
          <button className="button button--primary" type="button" onClick={createPdf} disabled={creatingPdf}>
            <Icon name="download" size={17} />
            {creatingPdf ? "PDF wird erstellt …" : "PDF herunterladen"}
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
            <p>Betreuungskalender</p>
            <h1>Bericht zu dokumentierten Betreuungszeiten</h1>
          </div>
          <dl>
            <div><dt>Erstellt am</dt><dd>{formatDateTime(reportCreatedAt)}</dd></div>
            <div><dt>Berichts-ID</dt><dd>{reportId}</dd></div>
            <div><dt>Zeitraum</dt><dd>{formatDate(selection.startDate)} bis {formatDate(selection.endDate)}</dd></div>
            <div><dt>Datenstand</dt><dd>{formatDateTime(data.updatedAt)}</dd></div>
            <div><dt>Abschlussstatus</dt><dd>{closureDescription}</dd></div>
            <div><dt>Kinder</dt><dd>{data.children.map((child) => child.name).join(", ") || "Keine Kinder erfasst"}</dd></div>
          </dl>
        </header>

        <section className="report-section">
          <h2>Zusammenfassung je Kind</h2>
          <div className="table-scroll">
            <table className="report-table responsive-table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Betreuungstage</th>
                  <th>Übernachtungen</th>
                  <th>Wochenenden</th>
                  <th>Zusatzbetreuung</th>
                  <th>Ferientage</th>
                  <th>Quote Tage</th>
                  <th>Quote Nächte</th>
                </tr>
              </thead>
              <tbody>
                {stats.byChild.map((childStats) => (
                  <tr key={childStats.childId}>
                    <td data-label="Kind">{data.children.find((child) => child.id === childStats.childId)?.name}</td>
                    <td data-label="Betreuungstage">{childStats.careDays}</td>
                    <td data-label="Übernachtungen">{childStats.overnights}</td>
                    <td data-label="Wochenenden">{childStats.weekends}</td>
                    <td data-label="Zusatzbetreuung">{childStats.additionalEntries}</td>
                    <td data-label="Ferientage">{childStats.holidayDays}</td>
                    <td data-label="Quote Tage">{childStats.careDayQuote} %</td>
                    <td data-label="Quote Nächte">{childStats.overnightQuote} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="report-section report-summary-grid">
          <div>
            <h2>Soll-Ist-Abweichungen</h2>
            <dl className="report-definition-list">
              <div><dt>Geplante Soll-Termine</dt><dd>{stats.contact.scheduled}</dd></div>
              <div><dt>Durchgeführt</dt><dd>{stats.contact.completed}</dd></div>
              <div><dt>Dienstlich ausgefallen</dt><dd>{stats.contact.cancelledDutyRelated}</dd></div>
              <div><dt>Sonstig ausgefallen</dt><dd>{stats.contact.cancelledOther}</dd></div>
              <div><dt>Überschneidungen</dt><dd>{stats.contact.unavailableOverlaps}</dd></div>
              <div><dt>Zusätzliche Termine</dt><dd>{stats.contact.additional}</dd></div>
            </dl>
          </div>
          <div>
            <h2>Ferienaufteilung</h2>
            <dl className="report-definition-list">
              <div><dt>Ferientage gesamt</dt><dd>{stats.holidays.totalDays}</dd></div>
              <div><dt>Vater</dt><dd>{stats.holidays.fatherDays}</dd></div>
              <div><dt>Mutter</dt><dd>{stats.holidays.motherDays}</dd></div>
              <div><dt>Vaterquote</dt><dd>{stats.holidays.fatherQuote} %</dd></div>
              <div><dt>Dienstliche Nichtverfügbarkeiten</dt><dd>{stats.holidays.unavailablePeriods}</dd></div>
            </dl>
          </div>
          <div>
            <h2>Fahrten und Kosten</h2>
            <dl className="report-definition-list">
              <div><dt>Fahrtkilometer</dt><dd>{stats.tripKm.toFixed(1)} km</dd></div>
              <div><dt>Rechnerische Fahrtkosten</dt><dd>{euro.format(stats.calculatedTravelCost)}</dd></div>
              <div><dt>Erstattungen</dt><dd>{euro.format(stats.reimbursedAmount)}</dd></div>
              <div><dt>Dokumentierte Kosten</dt><dd>{euro.format(stats.costsTotal)}</dd></div>
            </dl>
          </div>
          <div>
            <h2>Kosten nach Kategorie</h2>
            <dl className="report-definition-list">
              {Object.entries(stats.costsByCategory).map(([category, amount]) => (
                <div key={category}>
                  <dt>{costCategoryLabels[category as keyof typeof costCategoryLabels]}</dt>
                  <dd>{euro.format(amount)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="report-section">
          <h2>Dienstlich bedingte Nichtverfügbarkeit</h2>
          <p className="report-note">
            Dokumentierte Nichtverfügbarkeiten werden gesondert ausgewiesen und nicht automatisch als nicht wahrgenommene Betreuung bewertet.
          </p>
          <div className="table-scroll">
            <table className="report-table responsive-table">
              <thead>
                <tr>
                  <th>Zeitraum</th>
                  <th>Kategorie</th>
                  <th>Dienstlich</th>
                  <th>Betrifft</th>
                  <th>Ort</th>
                  <th>Belegreferenz</th>
                  <th>Notiz</th>
                </tr>
              </thead>
              <tbody>
                {unavailablePeriods.map((period) => (
                  <tr key={period.id}>
                    <td data-label="Zeitraum">
                      {formatDate(period.startDateTime)} {formatTime(period.startDateTime)}
                      <br />
                      bis {formatDate(period.endDateTime)} {formatTime(period.endDateTime)}
                    </td>
                    <td data-label="Kategorie">{unavailableCategoryLabels[period.category]}</td>
                    <td data-label="Dienstlich">{period.dutyRelated ? "Ja" : "Nein"}</td>
                    <td data-label="Betrifft">
                      {[
                        period.affectsContact ? "Umgang" : "",
                        period.affectsHolidays ? "Ferien" : ""
                      ].filter(Boolean).join(", ") || "–"}
                    </td>
                    <td data-label="Ort">{period.location || "–"}</td>
                    <td data-label="Belegreferenz">{period.evidenceReference || "–"}</td>
                    <td data-label="Notiz">{period.notes || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {unavailablePeriods.length === 0 ? (
            <p>Im Zeitraum sind keine Nichtverfügbarkeiten dokumentiert.</p>
          ) : null}
        </section>

        <section className="report-section">
          <h2>Tabellarische Tagesliste</h2>
          <div className="table-scroll">
            <table className="report-table report-table--entries responsive-table">
              <thead>
                <tr>
                  <th>Zeitraum</th>
                  <th>Kinder</th>
                  <th>Status</th>
                  <th>Einordnung</th>
                  <th>Fahrten</th>
                  <th>Kosten</th>
                  <th>Notizen / Ausfallgrund</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label="Zeitraum">{formatDate(entry.startDateTime)} {formatTime(entry.startDateTime)}<br />bis {formatDate(entry.endDateTime)} {formatTime(entry.endDateTime)}</td>
                    <td data-label="Kinder">{entry.childIds.map((id) => data.children.find((child) => child.id === id)?.name).filter(Boolean).join(", ")}</td>
                    <td data-label="Status">{statusLabels[entry.status]}</td>
                    <td data-label="Einordnung">
                      {entry.generatedByPatternId ? "Soll-Termin" : entry.additionalCare ? "Zusatzbetreuung" : "Einzeltermin"}
                      {entry.overnight ? <><br />Übernachtung</> : null}
                      {entry.holiday ? <><br />Ferientag</> : null}
                    </td>
                    <td
                      data-label="Fahrten"
                      data-testid="report-entry-trip-km"
                      data-value={entry.trips.filter((trip) => !trip.deletedAt).reduce((sum, trip) => sum + trip.km, 0)}
                    >
                      {entry.trips.filter((trip) => !trip.deletedAt).reduce((sum, trip) => sum + trip.km, 0).toFixed(1)} km
                    </td>
                    <td
                      data-label="Kosten"
                      data-testid="report-entry-cost"
                      data-value={entry.costs.filter((cost) => !cost.deletedAt).reduce((sum, cost) => sum + cost.amount, 0)}
                    >
                      {euro.format(entry.costs.filter((cost) => !cost.deletedAt).reduce((sum, cost) => sum + cost.amount, 0))}
                    </td>
                    <td data-label="Notizen / Ausfallgrund">{entry.cancellationReason || entry.notes || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {entries.length === 0 ? <p>Im Zeitraum sind keine Betreuungseinträge dokumentiert.</p> : null}
        </section>

        {includeAuditHistory ? (
          <section className="report-section">
            <h2>Änderungshistorie</h2>
            <p className="report-note">Enthalten sind protokollierte Änderungen mit einem Bezugsdatum im Berichtszeitraum.</p>
            <div className="table-scroll">
              <table className="report-table report-table--entries responsive-table">
                <thead>
                  <tr>
                    <th>Zeitpunkt</th>
                    <th>Objekt</th>
                    <th>Vorgang</th>
                    <th>Feld</th>
                    <th>Alter Wert</th>
                    <th>Neuer Wert</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td data-label="Zeitpunkt">{formatDateTime(entry.timestamp)}</td>
                      <td data-label="Objekt">{entry.objectLabel}</td>
                      <td data-label="Vorgang">{entry.action === "created" ? "Erstellt" : entry.action === "deleted" ? "Gelöscht" : "Geändert"}</td>
                      <td data-label="Feld">{entry.field}</td>
                      <td data-label="Alter Wert">{entry.oldValue}</td>
                      <td data-label="Neuer Wert">{entry.newValue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {auditEntries.length === 0 ? <p>Im Zeitraum sind keine Änderungen protokolliert.</p> : null}
          </section>
        ) : null}

        <footer className="report-document__footer">
          Die Auswertung basiert auf den vom Nutzer dokumentierten tatsächlichen Betreuungszeiten. Dokumentierte Nichtverfügbarkeiten werden gesondert ausgewiesen und nicht automatisch als nicht wahrgenommene Betreuung bewertet.
        </footer>
      </article>
    </div>
  );
}
