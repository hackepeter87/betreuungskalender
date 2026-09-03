import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Icon } from "../components/Icon";
import { FieldHelpButton } from "../components/FieldHelp";
import { MobileExportNotice } from "../components/MobileExportNotice";
import { Modal } from "../components/Modal";
import { api } from "../lib/api";
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
import { catalogKey, copy, type CatalogKey } from "../i18n/catalog";
import { createPrivacySafeTransferReviewReport } from "../lib/transferReview";
import type {
  ApiImportedTransferActor,
  ApiMember,
  ApiTransferCategoryCode,
  ApiTransferCheckCode,
  ApiTransferDryRunResult,
  ApiWorkspaceRole
} from "../../shared/api";

const transferRoles: ApiWorkspaceRole[] = ["admin", "editor", "scheduler", "viewer"];
const transferStepKeys = [
  "stepSelect",
  "stepTest",
  "stepReview",
  "stepPrepare",
  "stepReplace",
  "stepMap"
] as const satisfies readonly CatalogKey<"backup">[];

function categoryLabel(locale: "de" | "en", category: ApiTransferCategoryCode): string {
  const keys = {
    children: "category_children",
    care_parties: "category_care_parties",
    care_entries: "category_care_entries",
    holiday_periods: "category_holiday_periods",
    unavailable_periods: "category_unavailable_periods",
    external_calendar_sources: "category_external_calendar_sources",
    external_calendar_events: "category_external_calendar_events",
    contact_patterns: "category_contact_patterns",
    contact_rules: "category_contact_rules",
    audit_records: "category_audit_records",
    month_closures: "category_month_closures"
  } as const;
  return copy(locale, "backup", catalogKey("backup", keys[category]));
}

function checkLabel(locale: "de" | "en", code: ApiTransferCheckCode): string {
  const keys = {
    checksum: "check_checksum",
    format: "check_format",
    schema: "check_schema",
    references: "check_references",
    sqlite_foreign_keys: "check_sqlite_foreign_keys",
    sqlite_integrity: "check_sqlite_integrity"
  } as const;
  return copy(locale, "backup", catalogKey("backup", keys[code]));
}

function resultLabel(locale: "de" | "en", result: ApiTransferDryRunResult["result"]): string {
  if (locale === "en") return result === "ready" ? "Ready" : result === "warnings" ? "Review notes" : "Blocked";
  return result === "ready" ? "Bereit" : result === "warnings" ? "Hinweise prüfen" : "Blockiert";
}

function skippedRuntimeLabel(locale: "de" | "en", code: string): string {
  const keys = {
    identity: "skipped_identity",
    sessions: "skipped_sessions",
    feeds_push: "skipped_feeds_push",
    credentials: "skipped_credentials",
    external_urls: "skipped_external_urls"
  } as const;
  return code in keys
    ? copy(locale, "backup", catalogKey("backup", keys[code as keyof typeof keys]))
    : locale === "de" ? "Weitere Laufzeitdaten" : "Other runtime data";
}

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function BackupPage() {
  const { locale, intlLocale } = useI18n();
  const {
    data,
    session,
    reload,
    recordBackupExport,
    canWrite,
    isSaving
  } = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const actorsRef = useRef<HTMLElement>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [transferPackage, setTransferPackage] = useState<unknown>();
  const [transferFileName, setTransferFileName] = useState("");
  const [dryRun, setDryRun] = useState<ApiTransferDryRunResult | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [actors, setActors] = useState<ApiImportedTransferActor[]>([]);
  const [members, setMembers] = useState<ApiMember[]>([]);
  const [actorLinks, setActorLinks] = useState<Record<string, string>>({});
  const [confirmImportOpen, setConfirmImportOpen] = useState(false);
  const [confirmImportChecked, setConfirmImportChecked] = useState(false);
  const [completedImport, setCompletedImport] = useState<{ completedAt: string; result: ApiTransferDryRunResult } | null>(null);
  const isOwner = session.isOwner === true || !session.authRequired;
  const backupAgeDays = data.lastJsonBackupAt
    ? Math.floor(
        (Date.now() - new Date(data.lastJsonBackupAt).getTime()) / 86_400_000
      )
    : null;
  const backupIsCurrent = backupAgeDays !== null && backupAgeDays <= 7;

  const exportJson = async () => {
    setTransferBusy(true);
    try {
      const transfer = await api.exportPortableTransfer();
      downloadJson(transfer, `betreuungskalender-transfer-${nowIso().slice(0, 10)}.json`);
      await recordBackupExport(nowIso());
      setMessage({ type: "success", text: copy(locale, "backup", "exportSuccess") });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : copy(locale, "backup", "importFailed") });
    } finally {
      setTransferBusy(false);
    }
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

  const selectTransfer = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      setTransferPackage(parsed);
      setTransferFileName(file.name);
      setDryRun(null);
      setCompletedImport(null);
      setMessage(null);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : copy(locale, "backup", "importFailed")
      });
    }
  };

  const testTransfer = async () => {
    if (transferPackage === undefined) return;
    setTransferBusy(true);
    setMessage(null);
    try {
      setDryRun(await api.dryRunPortableTransfer(transferPackage));
      setCompletedImport(null);
    } catch (error) {
      setDryRun(null);
      setMessage({ type: "error", text: error instanceof Error ? error.message : copy(locale, "backup", "importFailed") });
    } finally {
      setTransferBusy(false);
    }
  };

  const importTransfer = async () => {
    if (transferPackage === undefined || !dryRun || dryRun.result === "blocked" || !dryRun.dryRunReceipt) return;
    setTransferBusy(true);
    try {
      const result = await api.importPortableTransfer({
        package: transferPackage,
        fingerprint: dryRun.fingerprint,
        dryRunReceipt: dryRun.dryRunReceipt,
        confirmWarnings: dryRun.result === "warnings"
      });
      await reload();
      const [nextActors, nextMembers] = await Promise.all([api.listTransferActors(), api.listMembers()]);
      setActors(nextActors);
      setMembers(nextMembers);
      setCompletedImport({ completedAt: new Date().toISOString(), result });
      setConfirmImportOpen(false);
      setConfirmImportChecked(false);
      setMessage({ type: "success", text: copy(locale, "backup", "importSuccess") });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : copy(locale, "backup", "importFailed") });
    } finally {
      setTransferBusy(false);
    }
  };

  const downloadReview = () => {
    if (!dryRun) return;
    downloadJson(
      createPrivacySafeTransferReviewReport(dryRun),
      `betreuungskalender-transfer-review-${nowIso().slice(0, 10)}.json`
    );
  };

  const copyFingerprint = async () => {
    if (!dryRun) return;
    await navigator.clipboard.writeText(dryRun.fingerprint.slice(0, 12));
    setMessage({ type: "success", text: copy(locale, "backup", "fingerprintCopied") });
  };

  const visibleComparison = dryRun?.comparison.filter((item) => item.current > 0 || item.incoming > 0) ?? [];
  const emptyComparison = dryRun?.comparison.filter((item) => item.current === 0 && item.incoming === 0) ?? [];
  const destructiveComparison = dryRun?.comparison.filter((item) => item.current > 0 && item.afterImport === 0) ?? [];

  useEffect(() => {
    if (!isOwner) return;
    void Promise.all([api.listTransferActors(), api.listMembers()])
      .then(([nextActors, nextMembers]) => {
        setActors(nextActors);
        setMembers(nextMembers);
      })
      .catch(() => undefined);
  }, [isOwner]);

  const mapActor = async (actor: ApiImportedTransferActor, userId: string, role: ApiWorkspaceRole) => {
    setTransferBusy(true);
    try {
      await api.mapTransferActor(actor.id, { userId, role, carePartyIds: actor.carePartyIds });
      setActors(await api.listTransferActors());
      setMessage({ type: "success", text: copy(locale, "backup", "actorMapped") });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : copy(locale, "backup", "importFailed") });
    } finally {
      setTransferBusy(false);
    }
  };

  const inviteActor = async (actor: ApiImportedTransferActor, role: ApiWorkspaceRole) => {
    setTransferBusy(true);
    try {
      const invitation = await api.inviteTransferActor(actor.id, {
        role,
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        emailHint: actor.email
      });
      setActorLinks((current) => ({ ...current, [actor.id]: invitation.invitationUrl }));
      setActors(await api.listTransferActors());
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : copy(locale, "backup", "importFailed") });
    } finally {
      setTransferBusy(false);
    }
  };

  return (
    <div className="page page--backup" data-testid="page-backup">
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
            <h2>{copy(locale, "backup", "exportTransfer")}</h2>
            <p>{copy(locale, "backup", "exportDescription")}</p>
            <dl>
              <div><dt>{copy(locale, "backup", "children")}</dt><dd>{data.children.length}</dd></div>
              <div><dt>{copy(locale, "backup", "entries")}</dt><dd>{data.entries.filter((entry) => !entry.deletedAt).length}</dd></div>
              <div><dt>{copy(locale, "backup", "lastChange")}</dt><dd>{formatDate(data.updatedAt, intlLocale)}</dd></div>
              <div><dt>{copy(locale, "backup", "lastBackup")}</dt><dd>{data.lastJsonBackupAt ? formatDate(data.lastJsonBackupAt, intlLocale) : copy(locale, "backup", "none")}</dd></div>
            </dl>
          </div>
          <span className="action-with-help">
            <button className="button button--primary" data-testid="export-json" type="button" onClick={() => void exportJson()} disabled={!isOwner || isSaving || transferBusy}>
              <Icon name="download" />
              {copy(locale, "backup", "exportTransfer")}
            </button>
            <FieldHelpButton fieldId="export.jsonExport" showRequirement={false} />
          </span>
        </section>

        <section className="panel backup-card">
          <span className="backup-card__number">02</span>
          <div>
            <h2>{copy(locale, "backup", "importTransfer")}</h2>
            <p>{copy(locale, "backup", "importDescription")}</p>
            <div className="import-warning">
              <Icon name="alert" size={18} />
              {copy(locale, "backup", "importWarning")}
            </div>
          </div>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            aria-label={copy(locale, "backup", "chooseJson")}
            accept="application/json,.json"
            onChange={selectTransfer}
          />
          <div className="transfer-actions">
            <button className="button button--secondary" type="button" onClick={chooseImport} disabled={!isOwner || !canWrite || isSaving || transferBusy}>
              <Icon name="upload" />
              {copy(locale, "backup", "chooseJson")}
            </button>
            {transferFileName ? <small>{transferFileName}</small> : null}
            <button className="button button--secondary" data-testid="data-transfer-dry-run" type="button" onClick={() => void testTransfer()} disabled={transferPackage === undefined || transferBusy}>
              <Icon name="check" />
              {copy(locale, "backup", "testImport")}
            </button>
          </div>
        </section>
      </div>

      {dryRun ? (
        <section className="panel transfer-result" data-testid="data-transfer-result">
          <div className="panel__header">
            <div>
              <h2>{copy(locale, "backup", "dryRunTitle")}</h2>
              <p>{dryRun.result === "ready"
                ? copy(locale, "backup", "dryRun_ready")
                : dryRun.result === "warnings"
                  ? copy(locale, "backup", "dryRun_warnings")
                  : copy(locale, "backup", "dryRun_blocked")}</p>
            </div>
            <span className={`status-pill transfer-status transfer-status--${dryRun.result}`}>{resultLabel(locale, dryRun.result)}</span>
          </div>
          <div className="transfer-result__body">
            <ol className="transfer-steps" aria-label={copy(locale, "backup", "dryRunTitle")}>
              {transferStepKeys.map((key, index) => (
                <li className={index <= 2 ? "is-complete" : ""} key={key}>
                  <span>{index + 1}</span>{copy(locale, "backup", catalogKey("backup", key))}
                </li>
              ))}
            </ol>

            <section className="transfer-review-section" aria-labelledby="transfer-package-title">
              <h3 id="transfer-package-title">{copy(locale, "backup", "packageDetails")}</h3>
              <dl className="transfer-package-meta">
                <div><dt>{copy(locale, "backup", "sourceVersion")}</dt><dd>{dryRun.sourceVersion}</dd></div>
                <div><dt>{copy(locale, "backup", "formatVersion")}</dt><dd>{dryRun.formatVersion}</dd></div>
                <div><dt>{copy(locale, "backup", "exportedAt")}</dt><dd>{dryRun.exportedAt ? formatDateTime(dryRun.exportedAt, intlLocale) : copy(locale, "common", "notAvailable")}</dd></div>
              </dl>
            </section>

            <dl className="transfer-summary">
              <div><dt>{copy(locale, "backup", "replacedRecords")}</dt><dd>{dryRun.summary.replacedRecords}</dd></div>
              <div><dt>{copy(locale, "backup", "totalIncoming")}</dt><dd>{dryRun.summary.incomingRecords}</dd></div>
              <div><dt>{copy(locale, "backup", "warningCount")}</dt><dd>{dryRun.summary.warnings}</dd></div>
              <div><dt>{copy(locale, "backup", "mappingCount")}</dt><dd>{dryRun.summary.actorMappingsRequired}</dd></div>
            </dl>

            <section className="transfer-review-section" aria-labelledby="transfer-comparison-title">
              <div className="transfer-review-heading">
                <div><h3 id="transfer-comparison-title">{copy(locale, "backup", "comparisonTitle")}</h3><p>{copy(locale, "backup", "comparisonDescription")}</p></div>
              </div>
              {destructiveComparison.length ? (
                <div className="notice notice--error"><Icon name="alert" /><p>{copy(locale, "backup", "dataLossWarning")}</p></div>
              ) : (
                <div className="notice notice--success"><Icon name="check" /><p>{copy(locale, "backup", "noDataLoss")}</p></div>
              )}
              <div className="transfer-comparison-wrap">
                <table className="transfer-comparison">
                  <thead><tr><th>{copy(locale, "backup", "category")}</th><th>{copy(locale, "backup", "currentRecords")}</th><th>{copy(locale, "backup", "incomingRecords")}</th><th>{copy(locale, "backup", "afterImport")}</th></tr></thead>
                  <tbody>{visibleComparison.map((item) => (
                    <tr className={item.current > 0 && item.afterImport === 0 ? "is-destructive" : ""} key={item.category}>
                      <th>{categoryLabel(locale, item.category)}</th><td>{item.current}</td><td>{item.incoming}</td><td>{item.afterImport}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {emptyComparison.length ? <details className="transfer-details"><summary>{copy(locale, "backup", "otherCategories")} ({emptyComparison.length})</summary><ul>{emptyComparison.map((item) => <li key={item.category}>{categoryLabel(locale, item.category)}: 0</li>)}</ul></details> : null}
            </section>

            {dryRun.warnings.length ? <div className="notice notice--warning"><Icon name="alert" /><p>{copy(locale, "backup", "warningsGeneric")}</p></div> : null}
            {dryRun.missingReferences.length ? <div className="notice notice--error"><Icon name="alert" /><p>{copy(locale, "backup", "referencesFailed")}</p></div> : null}

            <details className="transfer-details">
              <summary>{copy(locale, "backup", "technicalChecks")}</summary>
              <ul className="transfer-checks">{dryRun.checks.map((check) => <li key={check.code}><span>{checkLabel(locale, check.code)}</span><strong className={`check-status check-status--${check.status}`}>{copy(locale, "backup", catalogKey("backup", `check_${check.status}`))}</strong></li>)}</ul>
            </details>
            <details className="transfer-details">
              <summary>{copy(locale, "backup", "skippedRuntimeTitle")}</summary>
              <ul>{dryRun.skippedRuntimeCodes.map((code) => <li key={code}>{skippedRuntimeLabel(locale, code)}</li>)}</ul>
            </details>

            <div className="transfer-review-actions">
              <div className="transfer-fingerprint"><span>{copy(locale, "backup", "fingerprintShort")}</span><code>{dryRun.fingerprint.slice(0, 12)}</code><button className="button button--icon" type="button" title={copy(locale, "backup", "copyFingerprint")} onClick={() => void copyFingerprint()}><Icon name="copy" /></button></div>
              <button className="button button--secondary" type="button" onClick={downloadReview}><Icon name="download" />{copy(locale, "backup", "downloadReview")}</button>
              <button className="button button--danger" data-testid="data-transfer-import" type="button" disabled={dryRun.result === "blocked" || transferBusy || !dryRun.dryRunReceipt} onClick={() => { setConfirmImportChecked(false); setConfirmImportOpen(true); }}>
                <Icon name="upload" />{copy(locale, "backup", "prepareImport")}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {completedImport ? <section className="notice notice--success transfer-complete" data-testid="data-transfer-complete"><Icon name="check" /><div><h2>{copy(locale, "backup", "importCompletedTitle")}</h2><p>{copy(locale, "backup", "importedAt")}: {formatDateTime(completedImport.completedAt, intlLocale)} · {copy(locale, "backup", "totalIncoming")}: {completedImport.result.summary.incomingRecords} · {copy(locale, "backup", "mappingCount")}: {completedImport.result.summary.actorMappingsRequired}</p>{actors.length ? <button className="button button--quiet" type="button" onClick={() => actorsRef.current?.scrollIntoView({ behavior: "smooth" })}>{copy(locale, "backup", "goToActors")}</button> : null}</div></section> : null}

      {isOwner && actors.length ? (
        <section className="panel transfer-actors" data-testid="transfer-actors" ref={actorsRef}>
          <div className="panel__header">
            <div><h2>{copy(locale, "backup", "actorsTitle")}</h2><p>{copy(locale, "backup", "actorsDescription")}</p></div>
          </div>
          <div className="transfer-actor-list">
            {actors.map((actor) => {
              const defaultMember = actor.mappedUserId ?? "";
              const defaultRole = actor.suggestedRole ?? "editor";
              return <div className="transfer-actor" key={actor.id}>
                <div><strong>{actor.displayName}</strong>{actor.email ? <small>{actor.email}</small> : null}</div>
                <label className="field field--compact"><span>{copy(locale, "backup", "targetMember")}</span><select defaultValue={defaultMember} data-actor-member={actor.id}><option value="">{copy(locale, "backup", "notMapped")}</option>{members.filter((member) => member.workspaceAccess).map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>
                <label className="field field--compact"><span>{copy(locale, "backup", "targetRole")}</span><select defaultValue={defaultRole} data-actor-role={actor.id}>{transferRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
                <p className="transfer-actor__parties">
                  {copy(locale, "backup", "carePartyMappings")}: {actor.carePartyIds.length
                    ? data.careParties.filter((party) => actor.carePartyIds.includes(party.id)).map((party) => party.name).join(", ")
                    : copy(locale, "backup", "none")}
                </p>
                <div className="transfer-actor__actions">
                  <button className="button button--secondary" type="button" disabled={transferBusy} onClick={(event) => {
                    const row = event.currentTarget.closest(".transfer-actor");
                    const userId = row?.querySelector<HTMLSelectElement>(`[data-actor-member="${actor.id}"]`)?.value;
                    const role = row?.querySelector<HTMLSelectElement>(`[data-actor-role="${actor.id}"]`)?.value as ApiWorkspaceRole | undefined;
                    if (userId && role) void mapActor(actor, userId, role);
                  }}>{copy(locale, "backup", "mapActor")}</button>
                  <button className="button button--secondary" type="button" disabled={transferBusy || Boolean(actor.mappedUserId)} onClick={(event) => {
                    const role = event.currentTarget.closest(".transfer-actor")?.querySelector<HTMLSelectElement>(`[data-actor-role="${actor.id}"]`)?.value as ApiWorkspaceRole | undefined;
                    if (role) void inviteActor(actor, role);
                  }}>{copy(locale, "backup", "inviteActor")}</button>
                </div>
                {actorLinks[actor.id] ? <div className="transfer-actor__link"><input readOnly value={actorLinks[actor.id]} /><button className="button button--icon" type="button" title={copy(locale, "backup", "copyLink")} onClick={() => void navigator.clipboard.writeText(actorLinks[actor.id])}><Icon name="copy" /></button></div> : null}
              </div>;
            })}
          </div>
        </section>
      ) : null}

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
      {confirmImportOpen && dryRun ? (
        <Modal title={copy(locale, "backup", "confirmImportTitle")} onClose={() => setConfirmImportOpen(false)}>
          <div className="transfer-confirm">
            <p>{copy(locale, "backup", "confirmImportDescription")}</p>
            <dl className="transfer-summary">
              <div><dt>{copy(locale, "backup", "replacedRecords")}</dt><dd>{dryRun.summary.replacedRecords}</dd></div>
              <div><dt>{copy(locale, "backup", "totalIncoming")}</dt><dd>{dryRun.summary.incomingRecords}</dd></div>
              <div><dt>{copy(locale, "backup", "warningCount")}</dt><dd>{dryRun.summary.warnings}</dd></div>
              <div><dt>{copy(locale, "backup", "mappingCount")}</dt><dd>{dryRun.summary.actorMappingsRequired}</dd></div>
            </dl>
            <label className="check-row transfer-confirm__check"><input type="checkbox" checked={confirmImportChecked} onChange={(event) => setConfirmImportChecked(event.target.checked)} /><span>{copy(locale, "backup", "confirmImportCheckbox")}</span></label>
            <div className="transfer-confirm__actions"><button className="button button--secondary" type="button" onClick={() => setConfirmImportOpen(false)}>{copy(locale, "common", "cancel")}</button><button className="button button--danger" data-testid="data-transfer-import-confirm" type="button" disabled={!confirmImportChecked || transferBusy} onClick={() => void importTransfer()}><Icon name="alert" />{copy(locale, "backup", "executeImport")}</button></div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
