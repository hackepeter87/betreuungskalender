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
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";

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
  const { locale, intlLocale } = useI18n();
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
      setError(reason instanceof Error ? reason.message : copy(locale, "legacy", "checkFailed"));
    } finally {
      setBusy(false);
    }
  };

  const importData = async (mode: "add" | "replace") => {
    if (!payload) return;
    if (
      mode === "replace" &&
      !window.confirm(
        copy(locale, "legacy", "replaceConfirm")
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
      setError(reason instanceof Error ? reason.message : copy(locale, "legacy", "migrationFailed"));
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
      title={copy(locale, "legacy", "title")}
      size="large"
      onClose={() => void skip("cancel")}
    >
      <div className="legacy-migration">
        {report ? (
          <>
            <div className={`notice notice--${report.status === "success" ? "success" : "warning"}`}>
              <Icon name={report.status === "success" ? "check" : "alert"} />
              <div>
                <strong>{report.status === "success" ? copy(locale, "legacy", "success") : copy(locale, "legacy", "completedWithNotes")}</strong>
                <p>{copy(locale, "legacy", "importedSummary", { imported: totalImported, duplicates: report.skippedDuplicates })}</p>
              </div>
            </div>
            <dl className="migration-summary">
              <div><dt>{copy(locale, "legacy", "mode")}</dt><dd>{report.mode === "replace" ? copy(locale, "legacy", "replaceAfterBackup") : copy(locale, "legacy", "addImport")}</dd></div>
              <div><dt>{copy(locale, "legacy", "started")}</dt><dd>{new Date(report.startedAt).toLocaleString(intlLocale)}</dd></div>
              <div><dt>{copy(locale, "legacy", "ended")}</dt><dd>{new Date(report.finishedAt).toLocaleString(intlLocale)}</dd></div>
              <div><dt>{copy(locale, "legacy", "conflicts")}</dt><dd>{report.conflicts}</dd></div>
              <div><dt>{copy(locale, "legacy", "backupFile")}</dt><dd>{report.backupFile ?? copy(locale, "legacy", "notRequired")}</dd></div>
            </dl>
            {report.warnings.length ? (
              <div className="migration-issues">
                <strong>{copy(locale, "legacy", "notes")}</strong>
                <ul>{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              </div>
            ) : null}
            <p className="migration-recommendation">
              {copy(locale, "legacy", "recommendation")}
            </p>
            <footer className="form-actions">
              <button className="button button--secondary" type="button" onClick={() => downloadReport(report)}>
                <Icon name="download" size={17} />{copy(locale, "legacy", "downloadReport")}
              </button>
              <button className="button button--primary" type="button" onClick={onClose}>{copy(locale, "legacy", "close")}</button>
            </footer>
          </>
        ) : preview ? (
          <>
            <div className="migration-count-grid">
              <span><strong>{preview.counts.children}</strong>{copy(locale, "legacy", "children")}</span>
              <span><strong>{preview.counts.entries}</strong>{copy(locale, "legacy", "care")}</span>
              <span><strong>{preview.counts.holidays}</strong>{copy(locale, "legacy", "holidays")}</span>
              <span><strong>{preview.counts.contactPatterns}</strong>{copy(locale, "legacy", "contactRules")}</span>
              <span><strong>{preview.counts.trips}</strong>{copy(locale, "legacy", "trips")}</span>
              <span><strong>{preview.counts.costs}</strong>{copy(locale, "legacy", "costs")}</span>
              <span><strong>{preview.counts.unavailablePeriods}</strong>{copy(locale, "legacy", "unavailability")}</span>
              <span><strong>{preview.counts.monthClosures}</strong>{copy(locale, "legacy", "monthClosures")}</span>
            </div>
            <div className="migration-review-grid">
              <div className="notice">
                <strong>{copy(locale, "legacy", "duplicateCount", { count: preview.potentialDuplicates })}</strong>
                <p>{copy(locale, "legacy", "duplicateDescription")}</p>
              </div>
              <div className={preview.conflicts ? "notice notice--warning" : "notice"}>
                <strong>{copy(locale, "legacy", "conflictCount", { count: preview.conflicts })}</strong>
                <p>{copy(locale, "legacy", "conflictDescription")}</p>
              </div>
              <div className={preview.invalidRecords ? "notice notice--error" : "notice"}>
                <strong>{copy(locale, "legacy", "invalidCount", { count: preview.invalidRecords })}</strong>
                <p>{copy(locale, "legacy", "invalidDescription")}</p>
              </div>
            </div>
            {preview.conflictDetails.length ? (
              <details className="migration-details">
                <summary>{copy(locale, "legacy", "showConflicts")}</summary>
                {preview.conflictDetails.map((issue) => (
                  <div key={`${issue.type}-${issue.legacyId}`}>
                    <strong>{issue.label}</strong>
                    <p>{issue.reasons.join(" ")}</p>
                    {issue.closedMonths.length ? <small>{copy(locale, "legacy", "closed", { months: issue.closedMonths.join(", ") })}</small> : null}
                  </div>
                ))}
              </details>
            ) : null}
            {preview.warnings.length ? (
              <div className="migration-issues">
                <strong>{copy(locale, "legacy", "warnings")}</strong>
                <ul>{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              </div>
            ) : null}
            <label className="field">
              <span>{copy(locale, "legacy", "duplicatePolicy")}</span>
              <select
                value={duplicatePolicy}
                onChange={(event) => setDuplicatePolicy(event.target.value as LegacyDuplicatePolicy)}
              >
                <option value="skip">{copy(locale, "legacy", "skipDuplicates")}</option>
                <option value="include">{copy(locale, "legacy", "includeDuplicates")}</option>
              </select>
            </label>
            <footer className="form-actions migration-actions">
              <button className="button button--secondary" type="button" onClick={() => setPreview(null)}>{copy(locale, "legacy", "back")}</button>
              <div className="form-actions__right">
                <button className="button button--primary" type="button" disabled={busy || serverStatus !== "online" || preview.invalidRecords > 0} onClick={() => void importData("add")}>
                  {copy(locale, "legacy", "addImport")}
                </button>
                {!database.isEmpty ? (
                  <button className="button button--danger-quiet" type="button" disabled={busy || serverStatus !== "online" || preview.invalidRecords > 0} onClick={() => void importData("replace")}>
                    {copy(locale, "legacy", "replace")}
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
                    ? copy(locale, "legacy", "foundEmpty")
                    : copy(locale, "legacy", "foundExisting")}
                </strong>
                <p>
                  {copy(locale, "legacy", "readOnly")}
                </p>
              </div>
            </div>
            <div className="migration-count-grid">
              <span><strong>{legacy.counts.children}</strong>{copy(locale, "legacy", "children")}</span>
              <span><strong>{legacy.counts.entries}</strong>{copy(locale, "legacy", "care")}</span>
              <span><strong>{legacy.counts.holidays}</strong>{copy(locale, "legacy", "holidays")}</span>
              <span><strong>{legacy.counts.trips}</strong>{copy(locale, "legacy", "trips")}</span>
              <span><strong>{legacy.counts.costs}</strong>{copy(locale, "legacy", "costs")}</span>
              <span><strong>{legacy.counts.unavailablePeriods}</strong>{copy(locale, "legacy", "unavailability")}</span>
            </div>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <footer className="form-actions migration-actions">
              <div className="form-actions__right">
                <button className="button button--secondary" type="button" onClick={() => void skip("later")}>{copy(locale, "legacy", "remindLater")}</button>
                <button className="button button--secondary" type="button" onClick={() => void skip("ignore")}>{copy(locale, "legacy", "ignore")}</button>
                <button className="button button--primary" type="button" disabled={!payload || busy || serverStatus !== "online"} onClick={() => void analyze()}>
                  {database.isEmpty ? copy(locale, "legacy", "inspect") : copy(locale, "legacy", "prepare")}
                </button>
              </div>
            </footer>
            {!database.isEmpty ? (
              <p className="migration-risk">
                {copy(locale, "legacy", "risk")}
              </p>
            ) : null}
          </>
        )}
        {busy ? <p className="migration-progress" role="status">{copy(locale, "legacy", "processing")}</p> : null}
        {error && preview ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
    </Modal>
  );
}
