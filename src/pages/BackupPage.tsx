import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Icon } from "../components/Icon";
import { FieldHelpButton } from "../components/FieldHelp";
import { MobileExportNotice } from "../components/MobileExportNotice";
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
import { copy } from "../i18n/catalog";
import type {
  ApiImportedTransferActor,
  ApiMember,
  ApiTransferDryRunResult,
  ApiWorkspaceRole
} from "../../shared/api";

const transferRoles: ApiWorkspaceRole[] = ["admin", "editor", "scheduler", "viewer"];

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
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [transferPackage, setTransferPackage] = useState<unknown>();
  const [transferFileName, setTransferFileName] = useState("");
  const [dryRun, setDryRun] = useState<ApiTransferDryRunResult | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [actors, setActors] = useState<ApiImportedTransferActor[]>([]);
  const [members, setMembers] = useState<ApiMember[]>([]);
  const [actorLinks, setActorLinks] = useState<Record<string, string>>({});
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
    } catch (error) {
      setDryRun(null);
      setMessage({ type: "error", text: error instanceof Error ? error.message : copy(locale, "backup", "importFailed") });
    } finally {
      setTransferBusy(false);
    }
  };

  const importTransfer = async () => {
    if (transferPackage === undefined || !dryRun || dryRun.result === "blocked" || !dryRun.dryRunReceipt) return;
    if (!window.confirm(copy(locale, "backup", "importReplaceConfirm", {
      current: data.entries.filter((entry) => !entry.deletedAt).length,
      imported: dryRun.counts.entries ?? 0
    }))) return;
    setTransferBusy(true);
    try {
      await api.importPortableTransfer({
        package: transferPackage,
        fingerprint: dryRun.fingerprint,
        dryRunReceipt: dryRun.dryRunReceipt,
        confirmWarnings: dryRun.result === "warnings"
      });
      await reload();
      const [nextActors, nextMembers] = await Promise.all([api.listTransferActors(), api.listMembers()]);
      setActors(nextActors);
      setMembers(nextMembers);
      setMessage({ type: "success", text: copy(locale, "backup", "importSuccess") });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : copy(locale, "backup", "importFailed") });
    } finally {
      setTransferBusy(false);
    }
  };

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
          <input ref={fileInputRef} className="sr-only" type="file" accept="application/json,.json" onChange={selectTransfer} />
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
              <p>{copy(locale, "backup", `dryRun_${dryRun.result}`)}</p>
            </div>
            <span className={`status-pill${dryRun.result === "ready" ? " status-pill--ok" : ""}`}>{dryRun.result}</span>
          </div>
          <div className="transfer-result__body">
            <dl className="transfer-counts">
              {Object.entries(dryRun.counts).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}
            </dl>
            {dryRun.warnings.length ? <div className="notice notice--warning"><Icon name="alert" /><p>{dryRun.warnings.join(" ")}</p></div> : null}
            {dryRun.missingReferences.length ? <div className="notice notice--error"><Icon name="alert" /><p>{dryRun.missingReferences.join(", ")}</p></div> : null}
            <p className="transfer-result__meta">{copy(locale, "backup", "fingerprint")}: <code>{dryRun.fingerprint}</code></p>
            <button className="button button--primary" data-testid="data-transfer-import" type="button" disabled={dryRun.result === "blocked" || transferBusy} onClick={() => void importTransfer()}>
              <Icon name="upload" />
              {copy(locale, "backup", "executeImport")}
            </button>
          </div>
        </section>
      ) : null}

      {isOwner && actors.length ? (
        <section className="panel transfer-actors" data-testid="transfer-actors">
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
    </div>
  );
}
