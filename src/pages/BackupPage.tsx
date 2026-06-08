import { useRef, useState, type ChangeEvent } from "react";
import { Icon } from "../components/Icon";
import { FieldHelpButton } from "../components/FieldHelp";
import { MobileExportNotice } from "../components/MobileExportNotice";
import { createBackup, parseBackup } from "../lib/storage";
import { formatDate, formatDateTime, nowIso } from "../lib/date";
import {
  exportCostsCsv,
  exportEntriesCsv,
  exportHolidaysCsv,
  exportTripsCsv,
  exportUnavailablePeriodsCsv
} from "../lib/export";
import { useAppStore } from "../store/AppStore";

export function BackupPage() {
  const {
    data,
    recordBackupExport,
    replaceData,
    canWrite,
    isSaving
  } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const backupAgeDays = data.lastJsonBackupAt
    ? Math.floor(
        (Date.now() - new Date(data.lastJsonBackupAt).getTime()) / 86_400_000
      )
    : null;
  const backupIsCurrent = backupAgeDays !== null && backupAgeDays <= 7;

  const exportJson = async () => {
    const timestamp = nowIso();
    const backup = createBackup({
      ...data,
      lastJsonBackupAt: timestamp
    });
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `betreuungskalender-backup-${backup.exportedAt.slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    const recorded = await recordBackupExport(timestamp);
    setMessage(
      recorded
        ? { type: "success", text: "JSON-Sicherung wurde erstellt." }
        : {
            type: "error",
            text: "Die Datei wurde erzeugt, der Backup-Zeitpunkt konnte jedoch nicht in SQLite gespeichert werden."
          }
    );
  };

  const chooseImport = () => {
    if (
      !backupIsCurrent &&
      !window.confirm(
        data.lastJsonBackupAt
          ? `Das letzte JSON-Backup ist ${backupAgeDays} Tage alt. Vor einem Import wird ein aktuelles Backup empfohlen. Trotzdem eine Importdatei auswählen?`
          : "Es wurde noch kein JSON-Backup erstellt. Vor einem Import wird ein aktuelles Backup empfohlen. Trotzdem eine Importdatei auswählen?"
      )
    ) {
      return;
    }
    fileInputRef.current?.click();
  };

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const imported = parseBackup(await file.text());
      if (!window.confirm(`Import ersetzt ${data.entries.filter((entry) => !entry.deletedAt).length} vorhandene Einträge durch ${imported.entries.filter((entry) => !entry.deletedAt).length} Einträge. Diese Wiederherstellung jetzt ausführen?`)) {
        return;
      }
      if (await replaceData(imported)) {
        setMessage({ type: "success", text: "Sicherung wurde erfolgreich importiert." });
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Die Datei konnte nicht importiert werden."
      });
    }
  };

  return (
    <div className="page page--narrow">
      <div className="page-header">
        <div>
          <p className="page-header__context">Datensicherung</p>
          <h1>Export & Import</h1>
        </div>
      </div>

      <section className="backup-hero">
        <span className="backup-hero__icon"><Icon name="backup" size={30} /></span>
        <div>
          <h2>Deine Daten liegen in der lokalen SQLite-Datenbank</h2>
          <p>Es gibt keine Cloud-Synchronisation. Eine regelmäßige JSON-Sicherung schützt vor Datenverlust und ermöglicht die Wiederherstellung auf einer anderen Installation.</p>
        </div>
      </section>

      {message ? (
        <div className={`notice notice--${message.type}`}>
          <Icon name={message.type === "success" ? "check" : "alert"} />
          <p>{message.text}</p>
        </div>
      ) : null}

      <section className={`backup-status ${backupIsCurrent ? "backup-status--current" : "backup-status--warning"}`}>
        <Icon name={backupIsCurrent ? "check" : "alert"} size={20} />
        <div>
          <strong>
            {data.lastJsonBackupAt
              ? `Letztes JSON-Backup: ${formatDateTime(data.lastJsonBackupAt)}`
              : "Noch kein JSON-Backup dokumentiert"}
          </strong>
          <p>
            {backupIsCurrent
              ? "Die letzte Sicherung ist höchstens sieben Tage alt."
              : "Die letzte Sicherung fehlt oder ist älter als sieben Tage. Bitte vor größeren Änderungen oder einem Import sichern."}
          </p>
        </div>
      </section>

      <div className="backup-grid">
        <section className="panel backup-card">
          <span className="backup-card__number">01</span>
          <div>
            <h2>JSON exportieren</h2>
            <p>Speichert Kinder, Betreuungseinträge, Umgangsregeln, Ferien, Nichtverfügbarkeiten, Fahrten, Kosten und Einstellungen vollständig in einer Datei.</p>
            <dl>
              <div><dt>Kinder</dt><dd>{data.children.length}</dd></div>
              <div><dt>Einträge</dt><dd>{data.entries.filter((entry) => !entry.deletedAt).length}</dd></div>
              <div><dt>Letzte Änderung</dt><dd>{formatDate(data.updatedAt)}</dd></div>
              <div><dt>Letztes Backup</dt><dd>{data.lastJsonBackupAt ? formatDate(data.lastJsonBackupAt) : "Noch keines"}</dd></div>
            </dl>
          </div>
          <span className="action-with-help">
            <button className="button button--primary" type="button" onClick={() => void exportJson()} disabled={isSaving}>
              <Icon name="download" />
              JSON exportieren
            </button>
            <FieldHelpButton fieldId="export.jsonExport" showRequirement={false} />
          </span>
        </section>

        <section className="panel backup-card">
          <span className="backup-card__number">02</span>
          <div>
            <h2>JSON importieren</h2>
            <p>Lädt eine zuvor exportierte Sicherung. Die Datei wird geprüft und anschließend transaktional in SQLite wiederhergestellt.</p>
            <div className="import-warning">
              <Icon name="alert" size={18} />
              Ein Import ersetzt den aktuellen Datenbestand.
            </div>
          </div>
          <input ref={fileInputRef} className="sr-only" type="file" accept="application/json,.json" onChange={importJson} />
          <span className="action-with-help">
            <button className="button button--secondary" type="button" onClick={chooseImport} disabled={!canWrite || isSaving}>
              <Icon name="upload" />
              JSON auswählen
            </button>
            <FieldHelpButton fieldId="export.jsonImport" showRequirement={false} />
          </span>
        </section>
      </div>

      <section className="panel csv-export-panel">
        <div className="panel__header">
          <div>
            <h2>CSV-Rohdatenexport</h2>
            <p>Die Dateien sind getrennt, damit Betreuungseinträge und ihre Unterpositionen ohne Informationsverlust ausgewertet werden können.</p>
          </div>
          <FieldHelpButton fieldId="export.csvExport" showRequirement={false} />
        </div>
        <div className="csv-export-grid">
          <button className="button button--secondary" type="button" onClick={() => exportEntriesCsv(data)}>
            <Icon name="download" size={17} />
            Betreuungseinträge
          </button>
          <button className="button button--secondary" type="button" onClick={() => exportTripsCsv(data)}>
            <Icon name="car" size={17} />
            Fahrten
          </button>
          <button className="button button--secondary" type="button" onClick={() => exportCostsCsv(data)}>
            <Icon name="coins" size={17} />
            Kosten
          </button>
          <button className="button button--secondary" type="button" onClick={() => exportHolidaysCsv(data)}>
            <Icon name="sun" size={17} />
            Ferien
          </button>
          <button className="button button--secondary" type="button" onClick={() => exportUnavailablePeriodsCsv(data)}>
            <Icon name="briefcase" size={17} />
            Nichtverfügbarkeiten
          </button>
        </div>
      </section>
      <MobileExportNotice />
    </div>
  );
}
