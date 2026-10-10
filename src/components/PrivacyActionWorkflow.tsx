import { useEffect, useMemo, useState } from "react";
import type { ApiMember } from "../../shared/api";
import type {
  PrivacyActionCategoryCode,
  PrivacyActionKind,
  PrivacyActionPreviewResponse,
  PrivacyActionResultResponse,
  PrivacyActionSelection,
  PrivacySubjectType
} from "../../shared/privacyActions";
import type { CareParty, Child } from "../types";
import { useI18n } from "../i18n/I18nProvider";
import { catalogKey, copy, type CatalogKey } from "../i18n/catalog";
import { api } from "../lib/api";
import {
  privacyCategoryOptions,
  setPrivacyActionSelection
} from "../lib/privacyActionWorkflow";
import { useAppStore } from "../store/AppStore";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

interface SubjectOption {
  id: string;
  label: string;
  protected?: boolean;
}

function workflowCopy(
  locale: "de" | "en",
  key: CatalogKey<"privacyWorkflow">,
  values?: Record<string, string | number>
) {
  return copy(locale, "privacyWorkflow", catalogKey("privacyWorkflow", key), values);
}

function categoryLabel(locale: "de" | "en", code: PrivacyActionCategoryCode) {
  return workflowCopy(locale, `category_${code}` as CatalogKey<"privacyWorkflow">);
}

function actionLabel(locale: "de" | "en", action: PrivacyActionKind | "retain") {
  return workflowCopy(locale, `action_${action}` as CatalogKey<"privacyWorkflow">);
}

const codeKeys: Record<"warning" | "blocker" | "external", Record<string, CatalogKey<"privacyWorkflow">>> = {
  warning: {
    shared_records_require_review: "warning_shared_records_require_review"
  },
  blocker: {
    current_owner_protected: "blocker_current_owner_protected",
    unsupported_action: "blocker_unsupported_action",
    identity_detachment_requires_full_revocation: "blocker_identity_detachment_requires_full_revocation",
    identity_anonymization_requires_history_resolution: "blocker_identity_anonymization_requires_history_resolution",
    identity_detachment_requires_transfer_resolution: "blocker_identity_detachment_requires_transfer_resolution",
    profile_anonymization_requires_history_resolution: "blocker_profile_anonymization_requires_history_resolution",
    profile_deletion_requires_history_resolution: "blocker_profile_deletion_requires_history_resolution",
    profile_deletion_requires_relationship_resolution: "blocker_profile_deletion_requires_relationship_resolution",
    profile_deletion_requires_record_resolution: "blocker_profile_deletion_requires_record_resolution",
    record_deletion_requires_relationship_resolution: "blocker_record_deletion_requires_relationship_resolution",
    relationship_deletion_requires_record_resolution: "blocker_relationship_deletion_requires_record_resolution",
    shared_record_requires_manual_review: "blocker_shared_record_requires_manual_review"
  },
  external: {
    backups: "external_backups",
    exports: "external_exports",
    identity_provider: "external_identity_provider",
    logs: "external_logs"
  }
};

function codeLabel(locale: "de" | "en", kind: "warning" | "blocker" | "external", code: string) {
  return workflowCopy(locale, codeKeys[kind][code] ?? `${kind}_generic` as CatalogKey<"privacyWorkflow">);
}

function statusLabel(locale: "de" | "en", result: PrivacyActionPreviewResponse["result"]) {
  return workflowCopy(locale, `status_${result}` as CatalogKey<"privacyWorkflow">);
}

export function PrivacyActionWorkflow({
  children,
  careParties
}: {
  children: Child[];
  careParties: CareParty[];
}) {
  const { locale } = useI18n();
  const { session, reload } = useAppStore();
  const [members, setMembers] = useState<ApiMember[]>([]);
  const [subjectType, setSubjectType] = useState<PrivacySubjectType>("user");
  const [subjectId, setSubjectId] = useState("");
  const [selections, setSelections] = useState<PrivacyActionSelection[]>([]);
  const [preview, setPreview] = useState<PrivacyActionPreviewResponse | null>(null);
  const [result, setResult] = useState<PrivacyActionResultResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const isOwner = session.isOwner === true || !session.authRequired;

  useEffect(() => {
    if (!isOwner) return;
    void api.listMembers()
      .then(setMembers)
      .catch(() => setError(workflowCopy(locale, "membersLoadFailed")));
  }, [isOwner, locale]);

  const subjectOptions = useMemo<SubjectOption[]>(() => {
    if (subjectType === "child") {
      return children.map((child) => ({ id: child.id, label: child.name }));
    }
    if (subjectType === "care_party") {
      return careParties.map((party) => ({ id: party.id, label: party.name }));
    }
    return members.map((member) => ({
      id: member.id,
      label: member.displayName,
      protected: member.owner || member.id === session.user?.id
    }));
  }, [careParties, children, members, session.user?.id, subjectType]);

  if ((session.authRequired && !session.authenticated) || !isOwner) return null;

  const clearReview = () => {
    setPreview(null);
    setResult(null);
    setError(null);
    setConfirmOpen(false);
    setConfirmed(false);
  };

  const changeSubjectType = (next: PrivacySubjectType) => {
    setSubjectType(next);
    setSubjectId("");
    setSelections([]);
    clearReview();
  };

  const changeSubject = (next: string) => {
    setSubjectId(next);
    setSelections([]);
    clearReview();
  };

  const changeSelection = (
    category: PrivacyActionCategoryCode,
    action: PrivacyActionKind | "retain"
  ) => {
    setSelections((current) => setPrivacyActionSelection(current, category, action));
    clearReview();
  };

  const requestPreview = async () => {
    if (!subjectId || selections.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setPreview(await api.previewPrivacyAction({ subjectType, subjectId, actions: selections }));
    } catch {
      setPreview(null);
      setError(workflowCopy(locale, "previewFailed"));
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (!preview || preview.result === "blocked") return;
    setBusy(true);
    setError(null);
    try {
      const completed = await api.executePrivacyAction({
        subjectType,
        subjectId,
        actions: selections,
        fingerprint: preview.fingerprint
      });
      setResult(completed);
      setConfirmOpen(false);
      setConfirmed(false);
      await reload();
    } catch {
      setError(workflowCopy(locale, "executeFailed"));
      setConfirmOpen(false);
      setConfirmed(false);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel settings-section privacy-workflow" data-testid="privacy-action-workflow">
      <div className="panel__header panel__header--compact">
        <div>
          <h2>{workflowCopy(locale, "title")}</h2>
          <p>{workflowCopy(locale, "description")}</p>
        </div>
      </div>

      <div className="member-management-grid member-management-grid--single">
        <div className="notice" role="note">
          <Icon name="info" size={18} />
          <div>
            <strong>{workflowCopy(locale, "legalDecisionTitle")}</strong>
            <p>{workflowCopy(locale, "legalDecisionDescription")}</p>
          </div>
        </div>

        <div className="readiness-pills" aria-label={workflowCopy(locale, "stepsLabel")}>
          <span className={`status-pill${subjectId ? " status-pill--ok" : ""}`}>1. {workflowCopy(locale, "stepSubject")}</span>
          <span className={`status-pill${selections.length > 0 ? " status-pill--ok" : ""}`}>2. {workflowCopy(locale, "stepDecisions")}</span>
          <span className={`status-pill${preview ? " status-pill--ok" : ""}`}>3. {workflowCopy(locale, "stepReview")}</span>
        </div>

        <div className="settings-form-grid">
          <label className="field">
            <span>{workflowCopy(locale, "subjectType")}</span>
            <select
              data-testid="privacy-subject-type"
              value={subjectType}
              onChange={(event) => changeSubjectType(event.target.value as PrivacySubjectType)}
            >
              <option value="user">{workflowCopy(locale, "subject_user")}</option>
              <option value="care_party">{workflowCopy(locale, "subject_care_party")}</option>
              <option value="child">{workflowCopy(locale, "subject_child")}</option>
            </select>
          </label>
          <label className="field">
            <span>{workflowCopy(locale, "subject")}</span>
            <select
              data-testid="privacy-subject"
              value={subjectId}
              onChange={(event) => changeSubject(event.target.value)}
            >
              <option value="">{workflowCopy(locale, "chooseSubject")}</option>
              {subjectOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}{option.protected ? ` (${workflowCopy(locale, "protectedOwner")})` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        {subjectId ? (
          <fieldset className="member-invite-card privacy-workflow__decisions">
            <legend>{workflowCopy(locale, "decisionsTitle")}</legend>
            <p>{workflowCopy(locale, "decisionsDescription")}</p>
            <div className="assignment-list">
              {privacyCategoryOptions(subjectType).map(({ code, actions }) => {
                const selected = selections.find((selection) => selection.category === code)?.action ?? "retain";
                return (
                  <label className="assignment-row field" key={code}>
                    <span>
                      <strong>{categoryLabel(locale, code)}</strong>
                      <small>{workflowCopy(locale, `categoryDescription_${code}` as CatalogKey<"privacyWorkflow">)}</small>
                    </span>
                    <select
                      data-testid={`privacy-action-${code}`}
                      value={selected}
                      onChange={(event) => changeSelection(code, event.target.value as PrivacyActionKind | "retain")}
                    >
                      <option value="retain">{actionLabel(locale, "retain")}</option>
                      {actions.map((action) => (
                        <option key={action} value={action}>{actionLabel(locale, action)}</option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <div className="form-actions">
          <span />
          <div className="form-actions__right">
            <button
              className="button button--secondary"
              data-testid="privacy-action-preview"
              type="button"
              disabled={busy || !subjectId || selections.length === 0}
              onClick={() => void requestPreview()}
            >
              <Icon name="check" size={17} />
              {busy ? workflowCopy(locale, "checking") : workflowCopy(locale, "preview")}
            </button>
          </div>
        </div>

        {error ? <div className="notice notice--error" role="alert"><Icon name="alert" size={18} /><p>{error}</p></div> : null}

        {preview ? (
          <div className="member-invite-card" data-testid="privacy-action-review">
            <div className={`privacy-card${preview.result === "ready" ? "" : " privacy-card--warning"}`}>
              <Icon name={preview.result === "ready" ? "check" : "alert"} size={18} />
              <div>
                <strong>{workflowCopy(locale, "reviewTitle")}</strong>
                <p>{statusLabel(locale, preview.result)}</p>
              </div>
            </div>
            <dl className="instance-readiness-grid">
              {preview.categories.map((category) => (
                <div className="readiness-item" key={category.code}>
                  <dt><small>{categoryLabel(locale, category.code)}</small></dt>
                  <dd><strong>{category.count}</strong></dd>
                  <dd><span>{actionLabel(locale, category.selectedAction ?? "retain")}</span></dd>
                </div>
              ))}
            </dl>

            {preview.blockerCodes.length > 0 ? (
              <div className="notice notice--error" role="alert">
                <Icon name="alert" size={18} />
                <div><strong>{workflowCopy(locale, "blockersTitle")}</strong><ul>{preview.blockerCodes.map((code) => <li key={code}>{codeLabel(locale, "blocker", code)}</li>)}</ul></div>
              </div>
            ) : null}
            {preview.warningCodes.length > 0 ? (
              <div className="notice notice--warning" role="status">
                <Icon name="alert" size={18} />
                <div><strong>{workflowCopy(locale, "warningsTitle")}</strong><ul>{preview.warningCodes.map((code) => <li key={code}>{codeLabel(locale, "warning", code)}</li>)}</ul></div>
              </div>
            ) : null}

            <div className="member-token-card privacy-workflow__follow-up">
              <strong>{workflowCopy(locale, "externalCopiesTitle")}</strong>
              <p>{workflowCopy(locale, "externalCopiesDescription")}</p>
              <ul>{preview.externalFollowUpCodes.map((code) => <li key={code}>{codeLabel(locale, "external", code)}</li>)}</ul>
            </div>

            <div className="form-actions">
              <span />
              <div className="form-actions__right">
                <button
                  className="button button--danger"
                  data-testid="privacy-action-prepare"
                  type="button"
                  disabled={busy || preview.result === "blocked"}
                  onClick={() => { setConfirmed(false); setConfirmOpen(true); }}
                >
                  <Icon name="alert" size={17} />
                  {workflowCopy(locale, "prepare")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {result ? (
          <div role="status" data-testid="privacy-action-result">
            <div className="privacy-card">
              <Icon name="check" size={18} />
              <div>
                <strong>{workflowCopy(locale, "completedTitle")}</strong>
                <p>{workflowCopy(locale, "completedDescription", { id: result.id.slice(0, 8) })}</p>
              </div>
            </div>
            <dl className="instance-readiness-grid">
              {Object.entries(result.affectedCounts).map(([category, count]) => (
                <div className="readiness-item" key={category}>
                  <dt><small>{categoryLabel(locale, category as PrivacyActionCategoryCode)}</small></dt>
                  <dd><strong>{count}</strong></dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>

      {confirmOpen && preview ? (
        <Modal title={workflowCopy(locale, "confirmTitle")} onClose={() => { setConfirmOpen(false); setConfirmed(false); }}>
          <div className="member-invite-card">
            <div className="notice notice--warning">
              <Icon name="alert" size={18} />
              <div><strong>{workflowCopy(locale, "confirmWarningTitle")}</strong><p>{workflowCopy(locale, "confirmWarningDescription")}</p></div>
            </div>
            <ul className="assignment-list">
              {preview.categories.filter((category) => category.selectedAction).map((category) => (
                <li className="assignment-row" key={category.code}>
                  <strong>{categoryLabel(locale, category.code)}</strong>
                  <small>{actionLabel(locale, category.selectedAction ?? "retain")} · {category.count}</small>
                </li>
              ))}
            </ul>
            <label className="check-row">
              <input
                data-testid="privacy-action-confirm-checkbox"
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>{workflowCopy(locale, "confirmCheckbox")}</span>
            </label>
            <div className="form-actions">
              <span />
              <div className="form-actions__right">
                <button className="button button--secondary" type="button" onClick={() => { setConfirmOpen(false); setConfirmed(false); }}>{workflowCopy(locale, "cancel")}</button>
                <button className="button button--danger" data-testid="privacy-action-execute" type="button" disabled={!confirmed || busy} onClick={() => void execute()}>{workflowCopy(locale, "execute")}</button>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
