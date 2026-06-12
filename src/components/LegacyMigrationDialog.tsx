import { useState } from "react";
import type {
  LegacyDatabaseSummary,
  LegacyDuplicatePolicy,
  LegacyMigrationPreview,
  LegacyMigrationReport
} from "../../shared/migration";
import { api } from "../lib/api";
import {
  ignoreLegacyFingerprint,
  type LegacyBrowserData
} from "../migration/legacyLocalStorage";
import { useAppStore } from "../store/AppStore";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

interface Props {
  legacy: LegacyBrowserData;
  database: LegacyDatabaseSummary;
  onClose: () => void;
}

function downloadReport(report: LegacyMigrationReport): void {
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `migrationsprotokoll-${report.id}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function LegacyMigrationDialog({ legacy, database, onClose }: Props) {
  const { reload, serverStatus } = useAppStore();
  const [preview, setPreview] = useState<LegacyMigrationPreview | null>(null);
  const [report, setReport] = useState<LegacyMigrationReport | null>(null);
  const [duplicatePolicy, setDuplicatePolicy] =
    useState<LegacyDuplicatePolicy>("skip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(legacy.error ?? null);

  const payload = legacy.data
    ? {
        data: legacy.data,
        fingerprint: legacy.fingerprint,
        invalidRecords: legacy.invalidRecords,
        warnings: legacy.warnings
      }
    : null;

  const analyze = async () => {
    if (!payload) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await api.previewLegacyMigration(payload));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Prüfung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const importData = async (mode: "add" | "replace") => {
    if (!payload) return;
    if (
      mode === "replace" &&
      !window.confirm(
        "Die aktuellen SQLite-Daten werden nach erfolgreicher SQLite-Sicherung ersetzt. Wirklich fortfahren?"
      )
    ) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.importLegacyMigration({
        ...payload,
        mode,
        duplicatePolicy
      });
      setReport(result);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Migration fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const skip = async (reason: "later" | "ignore" | "cancel") => {
    try {
      await api.recordLegacySkip({
        fingerprint: legacy.fingerprint,
        counts: legacy.counts,
        reason
      });
    } catch {
      // Dismissing the dialog must not mutate or delete legacy data.
    }
    if (reason === "ignore") ignoreLegacyFingerprint(legacy.fingerprint);
    onClose();
  };

  const totalImported = report
    ? Object.values(report.imported).reduce((total, value) => total + value, 0)
    : 0;

  return (
    <Modal
      title="Ältere Browserdaten"
      size="large"
      onClose={() => void skip("cancel")}
    >
      <div className="legacy-migration">
        {report ? (
          <>
            <div className={`notice notice--${report.status === "success" ? "success" : "warning"}`}>
              <Icon name={report.status === "success" ? "check" : "alert"} />
              <div>
                <strong>Migration {report.status === "success" ? "erfolgreich" : "mit Hinweisen"}</strong>
                <p>
                  {totalImported} Datensätze wurden übernommen,{" "}
                  {report.skippedDuplicates} potenzielle Duplikate übersprungen.
                </p>
              </div>
            </div>
            <dl className="migration-summary">
              <div><dt>Modus</dt><dd>{report.mode === "replace" ? "Ersetzen nach Backup" : "Zusätzlich importieren"}</dd></div>
              <div><dt>Beginn</dt><dd>{new Date(report.startedAt).toLocaleString("de-DE")}</dd></div>
              <div><dt>Ende</dt><dd>{new Date(report.finishedAt).toLocaleString("de-DE")}</dd></div>
              <div><dt>Konflikte</dt><dd>{report.conflicts}</dd></div>
              <div><dt>Backup-Datei</dt><dd>{report.backupFile ?? "Nicht erforderlich"}</dd></div>
            </dl>
            {report.warnings.length ? (
              <div className="migration-issues">
                <strong>Hinweise</strong>
                <ul>{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              </div>
            ) : null}
            <p className="migration-recommendation">
              Die Browserdaten wurden in SQLite übernommen. Bitte erstellen Sie jetzt
              zusätzlich ein JSON-Backup. Die alten Browserdaten wurden nicht gelöscht.
            </p>
            <footer className="form-actions">
              <button className="button button--secondary" type="button" onClick={() => downloadReport(report)}>
                <Icon name="download" size={17} />Protokoll als JSON
              </button>
              <button className="button button--primary" type="button" onClick={onClose}>Schließen</button>
            </footer>
          </>
        ) : preview ? (
          <>
            <div className="migration-count-grid">
              <span><strong>{preview.counts.children}</strong>Kinder</span>
              <span><strong>{preview.counts.entries}</strong>Betreuung</span>
              <span><strong>{preview.counts.holidays}</strong>Ferien</span>
              <span><strong>{preview.counts.contactPatterns}</strong>Umgangsregeln</span>
              <span><strong>{preview.counts.trips}</strong>Fahrten</span>
              <span><strong>{preview.counts.costs}</strong>Kosten</span>
              <span><strong>{preview.counts.unavailablePeriods}</strong>Nichtverfügbarkeiten</span>
              <span><strong>{preview.counts.monthClosures}</strong>Monatsabschlüsse</span>
            </div>
            <div className="migration-review-grid">
              <div className="notice">
                <strong>{preview.potentialDuplicates} potenzielle Duplikate</strong>
                <p>Standardmäßig werden diese nicht erneut importiert.</p>
              </div>
              <div className={preview.conflicts ? "notice notice--warning" : "notice"}>
                <strong>{preview.conflicts} Konflikte</strong>
                <p>Bestehende SQLite-Einträge werden nicht überschrieben.</p>
              </div>
              <div className={preview.invalidRecords ? "notice notice--error" : "notice"}>
                <strong>{preview.invalidRecords} nicht importierbar</strong>
                <p>Ungültige Datensätze verhindern keinen stillen Teilimport.</p>
              </div>
            </div>
            {preview.conflictDetails.length ? (
              <details className="migration-details">
                <summary>Konflikte anzeigen</summary>
                {preview.conflictDetails.map((issue) => (
                  <div key={`${issue.type}-${issue.legacyId}`}>
                    <strong>{issue.label}</strong>
                    <p>{issue.reasons.join(" ")}</p>
                    {issue.closedMonths.length ? <small>Abgeschlossen: {issue.closedMonths.join(", ")}</small> : null}
                  </div>
                ))}
              </details>
            ) : null}
            {preview.warnings.length ? (
              <div className="migration-issues">
                <strong>Warnungen</strong>
                <ul>{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              </div>
            ) : null}
            <label className="field">
              <span>Umgang mit potenziellen Duplikaten</span>
              <select
                value={duplicatePolicy}
                onChange={(event) => setDuplicatePolicy(event.target.value as LegacyDuplicatePolicy)}
              >
                <option value="skip">Duplikate überspringen (empfohlen)</option>
                <option value="include">Als neue Einträge importieren</option>
              </select>
            </label>
            <footer className="form-actions migration-actions">
              <button className="button button--secondary" type="button" onClick={() => setPreview(null)}>Zurück</button>
              <div className="form-actions__right">
                <button className="button button--primary" type="button" disabled={busy || serverStatus !== "online" || preview.invalidRecords > 0} onClick={() => void importData("add")}>
                  Zusätzlich importieren
                </button>
                {!database.isEmpty ? (
                  <button className="button button--danger-quiet" type="button" disabled={busy || serverStatus !== "online" || preview.invalidRecords > 0} onClick={() => void importData("replace")}>
                    Sichern und ersetzen
                  </button>
                ) : null}
              </div>
            </footer>
          </>
        ) : (
          <>
            <div className="notice">
              <Icon name="backup" />
              <div>
                <strong>
                  {database.isEmpty
                    ? "Es wurden ältere Browserdaten gefunden. Diese können in die zentrale SQLite-Datenbank übernommen werden."
                    : "Es wurden ältere Browserdaten gefunden. Die zentrale Datenbank enthält bereits Daten. Bitte wählen Sie, wie fortgefahren werden soll."}
                </strong>
                <p>
                  Der alte Browserbestand wird nur gelesen und weder automatisch
                  verändert noch gelöscht.
                </p>
              </div>
            </div>
            <div className="migration-count-grid">
              <span><strong>{legacy.counts.children}</strong>Kinder</span>
              <span><strong>{legacy.counts.entries}</strong>Betreuung</span>
              <span><strong>{legacy.counts.holidays}</strong>Ferien</span>
              <span><strong>{legacy.counts.trips}</strong>Fahrten</span>
              <span><strong>{legacy.counts.costs}</strong>Kosten</span>
              <span><strong>{legacy.counts.unavailablePeriods}</strong>Nichtverfügbarkeiten</span>
            </div>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <footer className="form-actions migration-actions">
              <div className="form-actions__right">
                <button className="button button--secondary" type="button" onClick={() => void skip("later")}>Später erinnern</button>
                <button className="button button--secondary" type="button" onClick={() => void skip("ignore")}>Browserdaten ignorieren</button>
                <button className="button button--primary" type="button" disabled={!payload || busy || serverStatus !== "online"} onClick={() => void analyze()}>
                  {database.isEmpty ? "Import prüfen" : "Nur prüfen / Import vorbereiten"}
                </button>
              </div>
            </footer>
            {!database.isEmpty ? (
              <p className="migration-risk">
                „Ersetzen“ wird erst nach der Vorschau angeboten und nur nach einer
                erfolgreich erstellten SQLite-Sicherung ausgeführt.
              </p>
            ) : null}
          </>
        )}
        {busy ? <p className="migration-progress" role="status">Migration wird verarbeitet…</p> : null}
        {error && preview ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
    </Modal>
  );
}
