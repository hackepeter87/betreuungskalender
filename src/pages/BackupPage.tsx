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
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";

export function BackupPage() {
  const { locale, intlLocale } = useI18n();
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
        ? { type: "success", text: copy(locale, "backup", "exportSuccess") }
        : {
            type: "error",
            text: copy(locale, "backup", "exportRecordedFailed")
          }
    );
  };

  const chooseImport = () => {
    if (
      !backupIsCurrent &&
      !window.confirm(
        data.lastJsonBackupAt
          ? copy(locale, "backup", "importOutdatedConfirm", { days: backupAgeDays ?? 0 })
          : copy(locale, "backup", "importMissingConfirm")
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
      if (!window.confirm(copy(locale, "backup", "importReplaceConfirm", {
        current: data.entries.filter((entry) => !entry.deletedAt).length,
        imported: imported.entries.filter((entry) => !entry.deletedAt).length
      }))) {
        return;
      }
      if (await replaceData(imported)) {
        setMessage({ type: "success", text: copy(locale, "backup", "importSuccess") });
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : copy(locale, "backup", "importFailed")
      });
    }
  };

  return (
    <div className="page page--narrow" data-testid="page-backup">
      <div className="page-header">
        <div>
          <p className="page-header__context">{copy(locale, "backup", "context")}</p>
          <h1>{copy(locale, "backup", "title")}</h1>
        </div>
      </div>

      <section className="backup-hero">
        <span className="backup-hero__icon"><Icon name="backup" size={30} /></span>
        <div>
          <h2>{copy(locale, "backup", "heroTitle")}</h2>
          <p>{copy(locale, "backup", "heroDescription")}</p>
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
              ? copy(locale, "backup", "latestBackup", { date: formatDateTime(data.lastJsonBackupAt, intlLocale) })
              : copy(locale, "backup", "noBackupDocumented")}
          </strong>
          <p>
            {backupIsCurrent
              ? copy(locale, "backup", "backupCurrent")
              : copy(locale, "backup", "backupWarning")}
          </p>
        </div>
      </section>

      <div className="backup-grid">
        <section className="panel backup-card">
          <span className="backup-card__number">01</span>
          <div>
            <h2>{copy(locale, "backup", "exportJson")}</h2>
            <p>{copy(locale, "backup", "exportDescription")}</p>
            <dl>
              <div><dt>{copy(locale, "backup", "children")}</dt><dd>{data.children.length}</dd></div>
              <div><dt>{copy(locale, "backup", "entries")}</dt><dd>{data.entries.filter((entry) => !entry.deletedAt).length}</dd></div>
              <div><dt>{copy(locale, "backup", "lastChange")}</dt><dd>{formatDate(data.updatedAt, intlLocale)}</dd></div>
              <div><dt>{copy(locale, "backup", "lastBackup")}</dt><dd>{data.lastJsonBackupAt ? formatDate(data.lastJsonBackupAt, intlLocale) : copy(locale, "backup", "none")}</dd></div>
            </dl>
          </div>
          <span className="action-with-help">
            <button className="button button--primary" type="button" onClick={() => void exportJson()} disabled={isSaving}>
              <Icon name="download" />
              {copy(locale, "backup", "exportJson")}
            </button>
            <FieldHelpButton fieldId="export.jsonExport" showRequirement={false} />
          </span>
        </section>

        <section className="panel backup-card">
          <span className="backup-card__number">02</span>
          <div>
            <h2>{copy(locale, "backup", "importJson")}</h2>
            <p>{copy(locale, "backup", "importDescription")}</p>
            <div className="import-warning">
              <Icon name="alert" size={18} />
              {copy(locale, "backup", "importWarning")}
            </div>
          </div>
          <input ref={fileInputRef} className="sr-only" type="file" accept="application/json,.json" onChange={importJson} />
          <span className="action-with-help">
            <button className="button button--secondary" type="button" onClick={chooseImport} disabled={!canWrite || isSaving}>
              <Icon name="upload" />
              {copy(locale, "backup", "chooseJson")}
            </button>
            <FieldHelpButton fieldId="export.jsonImport" showRequirement={false} />
          </span>
        </section>
      </div>

      <section className="panel csv-export-panel" data-testid="csv-export-panel">
        <div className="panel__header">
          <div>
            <h2>{copy(locale, "backup", "csvTitle")}</h2>
            <p>{copy(locale, "backup", "csvDescription")}</p>
          </div>
          <FieldHelpButton fieldId="export.csvExport" showRequirement={false} />
        </div>
        <div className="csv-export-grid">
          <button className="button button--secondary" data-testid="export-entries-csv" type="button" onClick={() => exportEntriesCsv(data)}>
            <Icon name="download" size={17} />
            {copy(locale, "backup", "careEntries")}
          </button>
          <button className="button button--secondary" type="button" onClick={() => exportTripsCsv(data)}>
            <Icon name="car" size={17} />
            {copy(locale, "backup", "trips")}
          </button>
          <button className="button button--secondary" type="button" onClick={() => exportCostsCsv(data)}>
            <Icon name="coins" size={17} />
            {copy(locale, "backup", "costs")}
          </button>
          <button className="button button--secondary" type="button" onClick={() => exportHolidaysCsv(data)}>
            <Icon name="sun" size={17} />
            {copy(locale, "backup", "holidays")}
          </button>
          <button className="button button--secondary" type="button" onClick={() => exportUnavailablePeriodsCsv(data)}>
            <Icon name="briefcase" size={17} />
            {copy(locale, "backup", "unavailability")}
          </button>
        </div>
      </section>
      <MobileExportNotice />
    </div>
  );
}
