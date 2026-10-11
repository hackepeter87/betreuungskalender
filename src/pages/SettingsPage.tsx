import { useEffect, useState, type FormEvent } from "react";
import { CHILD_COLORS, childColor } from "../data/defaults";
import { Icon } from "../components/Icon";
import { AppearanceControl } from "../components/AppearanceControl";
import { FieldHelpButton, FieldHelpLabel } from "../components/FieldHelp";
import { Modal } from "../components/Modal";
import { ExternalCalendarManager } from "../components/ExternalCalendarManager";
import { PrivacyActionWorkflow } from "../components/PrivacyActionWorkflow";
import { useHelpPreferences } from "../context/HelpPreferences";
import { useI18n } from "../i18n/I18nProvider";
import { catalogKey, copy } from "../i18n/catalog";
import { localeMetadata, supportedLocales } from "../i18n/resources";
import { actorDisplayName } from "../lib/actors";
import { ApiError, api } from "../lib/api";
import { formatDateTime } from "../lib/date";
import { handoverLabel, locationLabel } from "../lib/labels";
import { useAppStore } from "../store/AppStore";
import {
  type ApiMemberAccessCapabilityCode,
  type ApiMemberAccessGlobalDataCode,
  type ApiMemberAccessPreview,
  type ApiMemberCareDataScope,
  type ApiWorkspaceRole,
  carePartyKinds,
  type ApiCalendarFeedScope,
  type ApiCalendarFeedStatus,
  type ApiCarePartyKind,
  type ApiInvitation,
  type ApiInstanceReadiness,
  type ApiMember,
  type ApiSession
} from "../../shared/api";
import type { CareLocation, CareParty, Child, HandoverParty, NotificationEventType, NotificationPreference } from "../types";
import { omitUndefinedValues } from "../../shared/objects";

function ChildForm({ child, onDone }: { child?: Child; onDone: () => void }) {
  const { saveChild, canWrite, isSaving } = useAppStore();
  const { locale } = useI18n();
  const [name, setName] = useState(child?.name ?? "");
  const [birthMonth, setBirthMonth] = useState(child?.birthMonth ?? 1);
  const [birthYear, setBirthYear] = useState(child?.birthYear ?? new Date().getFullYear() - 8);
  const [color, setColor] = useState(child?.color ?? childColor(0));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (await saveChild(omitUndefinedValues({ id: child?.id, name, birthMonth, birthYear, color }))) {
      onDone();
    }
  };

  return (
    <form className="child-form" data-testid="child-form" onSubmit={submit}>
      <label className="field">
        <FieldHelpLabel fieldId="child.name" />
        <input data-testid="child-name" autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder={copy(locale, "settings", "childNamePlaceholder")} />
      </label>
      <div className="form-grid">
        <label className="field">
          <FieldHelpLabel fieldId="child.birthMonth" />
          <select value={birthMonth} onChange={(event) => setBirthMonth(Number(event.target.value))}>
            {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{String(index + 1).padStart(2, "0")}</option>)}
          </select>
        </label>
        <label className="field">
          <FieldHelpLabel fieldId="child.birthYear" />
          <input type="number" min="1990" max={new Date().getFullYear()} required value={birthYear} onChange={(event) => setBirthYear(Number(event.target.value))} />
        </label>
      </div>
      <fieldset className="color-field">
        <legend className="field-label-row">
          <span>{copy(locale, "settings", "calendarColor")}</span>
          <FieldHelpButton fieldId="child.color" />
        </legend>
        <div>
          {CHILD_COLORS.map((option) => (
            <label key={option} className={color === option ? "is-selected" : ""}>
              <input data-testid={`child-color-option-${option.slice(1)}`} type="radio" name="color" value={option} checked={color === option} onChange={() => setColor(option)} />
              <span style={{ backgroundColor: option }} />
            </label>
          ))}
        </div>
      </fieldset>
      <footer className="form-actions">
        <span />
        <div className="form-actions__right">
          <button className="button button--secondary" type="button" onClick={onDone}>{copy(locale, "settings", "cancel")}</button>
          <button className="button button--primary" data-testid="child-submit" type="submit" disabled={!canWrite || isSaving}>{child ? copy(locale, "settings", "saveChild") : copy(locale, "settings", "addChild")}</button>
        </div>
      </footer>
    </form>
  );
}

function carePartyKindLabel(kind: ApiCarePartyKind, locale: "de" | "en") {
  return copy(locale, "settings", catalogKey("settings", `carePartyKind_${kind}`));
}

function notificationEventLabel(eventType: NotificationEventType, locale: "de" | "en") {
  return eventType === "care_confirmation_due"
    ? copy(locale, "notifications", "careConfirmationDue")
    : copy(locale, "notifications", "careConfirmationReminder");
}

function yesNo(value: boolean, locale: "de" | "en") {
  return copy(locale, "common", catalogKey("common", value ? "yes" : "no"));
}

function NotificationPreferencesSection() {
  const { locale } = useI18n();
  const {
    notificationPreferences,
    updateNotificationPreferences,
    registerPushSubscription,
    session,
    isSaving
  } = useAppStore();
  const preferences = notificationPreferences?.preferences ?? [];
  const showEmailPreferences = Boolean(notificationPreferences?.emailAvailable);
  const canManageNotifications = session.permissions
    ? session.permissions.includes("notifications:manage-own")
    : true;

  const patchPreference = (eventType: NotificationEventType, patch: Partial<NotificationPreference>) => {
    const next = preferences.map((preference) =>
      preference.eventType === eventType
        ? { ...preference, ...patch, inAppEnabled: true }
        : preference
    );
    void updateNotificationPreferences(next);
  };

  return (
    <section className="panel settings-section" data-testid="notification-preferences">
      <div className="panel__header">
        <div>
          <h2>{copy(locale, "notifications", "title")}</h2>
          <p>{copy(locale, "notifications", "description")}</p>
        </div>
        <button className="button button--secondary" type="button" disabled={!canManageNotifications || isSaving || !notificationPreferences?.pushAvailable} onClick={() => void registerPushSubscription()}>
          <Icon name="bell" size={17} />
          {copy(locale, "notifications", "enablePush")}
        </button>
      </div>
      <div className="notification-rules">
        <p><strong>{copy(locale, "notifications", "whenTitle")}</strong>{copy(locale, "notifications", "whenDescription")}</p>
        <p><strong>{copy(locale, "notifications", "editableTitle")}</strong>{copy(locale, "notifications", catalogKey("notifications", showEmailPreferences ? "editableDescriptionWithEmail" : "editableDescription"))}</p>
      </div>
      <div className={`notification-preferences-table${showEmailPreferences ? " notification-preferences-table--email" : ""}`}>
        <div className="notification-preferences-row notification-preferences-row--head">
          <span>{copy(locale, "notifications", "event")}</span>
          <span>{copy(locale, "notifications", "inApp")}</span>
          <span className="notification-preferences-row__channel">
            {copy(locale, "notifications", "push")}
            <FieldHelpButton fieldId="settings.notificationChannels" showRequirement={false} />
          </span>
          {showEmailPreferences ? <span>{copy(locale, "notifications", "email")}</span> : null}
        </div>
        {preferences.map((preference) => (
          <div className="notification-preferences-row" key={preference.eventType}>
            <strong>{notificationEventLabel(preference.eventType, locale)}</strong>
            <span className="status-pill status-pill--ok">{copy(locale, "common", "yes")}</span>
            <label className="toggle toggle--compact">
              <input
                type="checkbox"
                aria-label={`${notificationEventLabel(preference.eventType, locale)}: ${copy(locale, "notifications", "push")}`}
                checked={preference.pushEnabled}
                disabled={!canManageNotifications || isSaving}
                onChange={(event) => patchPreference(preference.eventType, { pushEnabled: event.target.checked })}
              />
              <span />
            </label>
            {showEmailPreferences ? (
              <label className="toggle toggle--compact">
                <input
                  type="checkbox"
                  aria-label={`${notificationEventLabel(preference.eventType, locale)}: ${copy(locale, "notifications", "email")}`}
                  checked={preference.emailEnabled}
                  disabled={!canManageNotifications || isSaving || !notificationPreferences?.emailRecipientAvailable}
                  onChange={(event) => patchPreference(preference.eventType, { emailEnabled: event.target.checked })}
                />
                <span />
              </label>
            ) : null}
          </div>
        ))}
      </div>
      <p className="settings-note">
        {notificationPreferences?.pushAvailable
          ? copy(locale, "notifications", "pushActive", { count: notificationPreferences.activePushSubscriptions })
          : copy(locale, "notifications", "pushUnavailable")}
      </p>
      {showEmailPreferences && !notificationPreferences?.emailRecipientAvailable ? (
        <p className="settings-note" role="status">
          {copy(locale, "notifications", "emailRecipientUnavailable")}
        </p>
      ) : null}
    </section>
  );
}

const memberRoles: ApiWorkspaceRole[] = ["admin", "editor", "scheduler", "viewer"];

function memberRoleLabel(role: ApiWorkspaceRole, locale: "de" | "en") {
  return copy(locale, "settings", catalogKey("settings", `memberRole_${role}`));
}

function memberRoleDescription(role: ApiWorkspaceRole, locale: "de" | "en") {
  return copy(locale, "settings", catalogKey("settings", `memberRoleDescription_${role}`));
}

function memberCapabilityLabel(code: ApiMemberAccessCapabilityCode, locale: "de" | "en") {
  return copy(locale, "settings", catalogKey("settings", `memberCapability_${code}`));
}

function memberGlobalDataLabel(code: ApiMemberAccessGlobalDataCode, locale: "de" | "en") {
  return copy(locale, "settings", catalogKey("settings", `memberGlobalData_${code}`));
}

function memberScopeSummary(
  scope: ApiMemberCareDataScope | undefined,
  parties: Array<{ id: string; name: string }>,
  locale: "de" | "en"
) {
  if (!scope || scope.type === "all") return copy(locale, "settings", "memberScopeAllSummary");
  if (!scope.carePartyIds.length) return copy(locale, "settings", "memberScopeNoneSummary");
  const names = scope.carePartyIds
    .map((id) => parties.find((party) => party.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  return names.length
    ? copy(locale, "settings", "memberScopeSelectedSummary", { names: names.join(", ") })
    : copy(locale, "settings", "memberScopeNoneSummary");
}

function MemberScopeFields({
  prefix,
  role,
  scope,
  parties,
  disabled,
  onChange
}: {
  prefix: string;
  role: ApiWorkspaceRole;
  scope: ApiMemberCareDataScope;
  parties: Array<{ id: string; name: string }>;
  disabled: boolean;
  onChange: (scope: ApiMemberCareDataScope) => void;
}) {
  const { locale } = useI18n();
  const selectedIds = scope.type === "selected" ? scope.carePartyIds : [];
  const scopeDisabled = disabled || role === "admin";
  return (
    <fieldset className="member-access-scope">
      <legend>{copy(locale, "settings", "memberScopeTitle")}</legend>
      <p>{copy(locale, "settings", "memberScopeDescription")}</p>
      <div className="member-access-scope__modes">
        <label className="check-row">
          <input type="radio" name={`${prefix}-scope`} checked={scope.type === "all"} disabled={scopeDisabled} onChange={() => onChange({ type: "all" })} />
          <span><strong>{copy(locale, "settings", "memberScopeAll")}</strong><small>{copy(locale, "settings", "memberScopeAllDescription")}</small></span>
        </label>
        <label className="check-row">
          <input type="radio" name={`${prefix}-scope`} checked={scope.type === "selected"} disabled={scopeDisabled} onChange={() => onChange({ type: "selected", carePartyIds: selectedIds })} />
          <span><strong>{copy(locale, "settings", "memberScopeSelected")}</strong><small>{copy(locale, "settings", "memberScopeSelectedDescription")}</small></span>
        </label>
      </div>
      {scope.type === "selected" && role !== "admin" ? (
        <div className="member-access-scope__parties">
          {parties.map((party) => (
            <label className="check-row" key={party.id}>
              <input
                type="checkbox"
                checked={selectedIds.includes(party.id)}
                disabled={disabled}
                onChange={() => onChange({
                  type: "selected",
                  carePartyIds: selectedIds.includes(party.id)
                    ? selectedIds.filter((id) => id !== party.id)
                    : [...selectedIds, party.id]
                })}
              />
              {party.name}
            </label>
          ))}
          {!selectedIds.length ? <p className="member-access-scope__empty" role="status"><Icon name="lock" size={16} />{copy(locale, "settings", "memberScopeNoneSummary")}</p> : null}
        </div>
      ) : null}
    </fieldset>
  );
}

function MemberAccessReview({ preview }: { preview: ApiMemberAccessPreview }) {
  const { locale } = useI18n();
  const groups = ["view", "edit", "administer", "denied"] as const;
  const narrowed = preview.changes.lostCapabilities.length > 0 || preview.changes.lostCarePartyIds.length > 0;
  const expanded = preview.changes.gainedCapabilities.length > 0 || preview.changes.gainedCarePartyIds.length > 0;
  return (
    <div className="member-access-review" data-testid="member-access-review">
      <div className="member-access-review__summary">
        <div><span>{copy(locale, "settings", "memberRole")}</span><strong>{memberRoleLabel(preview.after.role, locale)}</strong><small>{memberRoleDescription(preview.after.role, locale)}</small></div>
        <div><span>{copy(locale, "settings", "memberScopeTitle")}</span><strong>{memberScopeSummary(preview.after.careDataScope, preview.careParties, locale)}</strong></div>
      </div>
      {expanded ? <p className="member-access-change"><Icon name="plus" size={16} /><strong>{copy(locale, "settings", "memberAccessExpanded")}</strong></p> : null}
      {narrowed ? <div className="member-access-change member-access-change--warning"><Icon name="alert" size={16} /><span><strong>{copy(locale, "settings", "memberAccessNarrowed")}</strong>{preview.changes.lostCapabilities.map((code) => <small key={code}>{copy(locale, "settings", "memberAccessWillLose")}: {memberCapabilityLabel(code, locale)}</small>)}</span></div> : null}
      {!expanded && !narrowed ? <p className="member-access-hint">{copy(locale, "settings", "memberAccessUnchanged")}</p> : null}
      <div className="member-access-capabilities">
        {groups.map((group) => <section key={group}><h3>{copy(locale, "settings", catalogKey("settings", `memberCapabilityGroup_${group}`))}</h3>{preview.after.capabilities[group].length ? <ul>{preview.after.capabilities[group].map((code) => <li key={code}>{memberCapabilityLabel(code, locale)}</li>)}</ul> : <p>{copy(locale, "common", "none")}</p>}</section>)}
      </div>
      <section className="member-access-global"><h3>{copy(locale, "settings", "memberGlobalDataTitle")}</h3><p>{copy(locale, "settings", "memberGlobalDataDescription")}</p>{preview.after.globalData.length ? <ul>{preview.after.globalData.map((code) => <li key={code}>{memberGlobalDataLabel(code, locale)}</li>)}</ul> : <p>{copy(locale, "common", "none")}</p>}</section>
    </div>
  );
}

function invitationStatus(invitation: ApiInvitation, locale: "de" | "en") {
  if (invitation.acceptedAt) return copy(locale, "settings", "invitationAccepted");
  if (invitation.revokedAt) return copy(locale, "settings", "invitationRevoked");
  if (Date.parse(invitation.expiresAt) <= Date.now()) return copy(locale, "settings", "invitationExpired");
  return copy(locale, "settings", "invitationPending");
}

function MemberInvitationManager() {
  const { locale, intlLocale } = useI18n();
  const { data, session } = useAppStore();
  const [members, setMembers] = useState<ApiMember[]>([]);
  const [invitations, setInvitations] = useState<ApiInvitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ApiWorkspaceRole>("editor");
  const [inviteScope, setInviteScope] = useState<ApiMemberCareDataScope>({ type: "all" });
  const [expiresDays, setExpiresDays] = useState(7);
  const [sendEmailOverride, setSendEmailOverride] = useState<boolean>();
  const [emailDeliveryAvailable, setEmailDeliveryAvailable] = useState(false);
  const [createdInvitationUrl, setCreatedInvitationUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ownerForbidden, setOwnerForbidden] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<ApiMember | null>(null);
  const [memberRole, setMemberRole] = useState<ApiWorkspaceRole>("viewer");
  const [memberScope, setMemberScope] = useState<ApiMemberCareDataScope>({ type: "all" });
  const [review, setReview] = useState<{
    preview: ApiMemberAccessPreview;
    kind: "member" | "invitation";
    expiresAt?: string;
    emailHint?: string;
    sendEmail?: boolean;
  } | null>(null);
  const hasInviteEmail = Boolean(inviteEmail.trim());
  const sendEmail = emailDeliveryAvailable && hasInviteEmail && (sendEmailOverride ?? true);

  const loadOwnerData = async () => {
    if (!session.isOwner) return;
    try {
      const [nextMembers, nextInvitations, capabilities] = await Promise.all([
        api.listMembers(),
        api.listInvitations(),
        api.invitationCapabilities().catch(() => ({ emailDeliveryAvailable: false }))
      ]);
      setMembers(nextMembers);
      setInvitations(nextInvitations);
      setEmailDeliveryAvailable(capabilities.emailDeliveryAvailable);
      setOwnerForbidden(false);
      setError(null);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 403) {
        setOwnerForbidden(true);
        return;
      }
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  useEffect(() => {
    void loadOwnerData();
  }, [session.isOwner, session.user?.id]);

  if (!session.authenticated || !session.isOwner) return null;

  const previewInvitation = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    setCreatedInvitationUrl(null);
    try {
      const safeExpiresDays = Number.isFinite(expiresDays) ? Math.min(30, Math.max(1, expiresDays)) : 7;
      const expiresAt = new Date(Date.now() + safeExpiresDays * 86_400_000).toISOString();
      const preview = await api.previewInvitationAccess({ role: inviteRole, careDataScope: inviteScope });
      setReview({
        preview,
        kind: "invitation",
        expiresAt,
        ...(inviteEmail.trim() ? { emailHint: inviteEmail.trim() } : {}),
        sendEmail
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const previewMember = async () => {
    if (!editingMember) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const preview = await api.previewMemberAccess(editingMember.id, { role: memberRole, careDataScope: memberScope });
      setReview({ preview, kind: "member" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const applyReview = async () => {
    if (!review) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      if (review.kind === "member" && editingMember) {
        const updated = await api.updateMemberAccess(editingMember.id, {
          role: review.preview.after.role,
          careDataScope: review.preview.after.careDataScope,
          previewFingerprint: review.preview.fingerprint
        });
        setMembers((items) => items.map((item) => item.id === updated.member.id ? updated.member : item));
        setMessage(copy(locale, "settings", "memberAccessUpdated"));
        setEditingMember(null);
      } else if (review.kind === "invitation" && review.expiresAt) {
        const created = await api.createInvitation(omitUndefinedValues({
          role: review.preview.after.role,
          careDataScope: review.preview.after.careDataScope,
          previewFingerprint: review.preview.fingerprint,
          expiresAt: review.expiresAt,
          emailHint: review.emailHint,
          sendEmail: review.sendEmail
        }));
        setInvitations((items) => [created.invitation, ...items]);
        setCreatedInvitationUrl(created.invitationUrl);
        setInviteEmail("");
        setInviteScope({ type: "all" });
        setSendEmailOverride(undefined);
        setMessage(created.emailDelivery?.status === "sent"
          ? copy(locale, "settings", "invitationEmailSent")
          : created.emailDelivery?.status === "failed"
            ? created.emailDelivery.message ?? copy(locale, "settings", "invitationEmailFailed")
            : copy(locale, "settings", "invitationCreated"));
      }
      setReview(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const openMember = (member: ApiMember) => {
    setEditingMember(member);
    setMemberRole(member.effectiveRole);
    setMemberScope(member.careDataScope ?? { type: "all" });
    setReview(null);
    setError(null);
  };

  const removeMember = async (member: ApiMember) => {
    if (!window.confirm(copy(locale, "settings", "memberRemoveConfirm", { name: member.displayName }))) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const updated = await api.removeMember(member.id);
      setMembers((items) => items.map((item) => item.id === updated.id ? updated : item));
      setMessage(copy(locale, "settings", "memberRemoved"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const revokeInvitation = async (invitation: ApiInvitation) => {
    if (!window.confirm(copy(locale, "settings", "invitationRevokeConfirm"))) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const revoked = await api.revokeInvitation(invitation.id);
      setInvitations((items) => items.map((item) => item.id === revoked.id ? revoked : item));
      setMessage(copy(locale, "settings", "invitationRevokedDone"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const copyInvitationLink = async () => {
    if (!createdInvitationUrl) return;
    await navigator.clipboard.writeText(createdInvitationUrl);
    setMessage(copy(locale, "settings", "invitationLinkCopied"));
  };

  const currentUserId = session.user?.id;
  const parties = data.careParties.map(({ id, name }) => ({ id, name }));
  const showOwnerControls = Boolean(session.isOwner && !ownerForbidden);

  return (
    <section className="panel settings-section" data-testid="member-invitations">
      <div className="panel__header panel__header--compact">
        <div>
          <h2>{copy(locale, "settings", "members")}</h2>
          <p>{copy(locale, "settings", "membersDescription")}</p>
        </div>
      </div>

      {showOwnerControls ? (
        <>
          <div className={`member-management-grid${createdInvitationUrl ? "" : " member-management-grid--single"}`}>
            <form className="member-invite-card" data-testid="invitation-create-form" onSubmit={(event) => void previewInvitation(event)}>
              <div>
                <strong>{copy(locale, "settings", "invitationCreate")}</strong>
                <small>{copy(locale, "settings", "invitationCreateDescription")}</small>
              </div>
              <label className="field">
                <span>{copy(locale, "settings", "invitationEmailHint")}</span>
                <input
                  data-testid="invitation-email-hint"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="name@example.invalid"
                />
              </label>
              <div className="member-invite-card__row">
                <label className="field">
                  <span>{copy(locale, "settings", "memberRole")}</span>
                  <select data-testid="invitation-role" value={inviteRole} onChange={(event) => {
                    const role = event.target.value as ApiWorkspaceRole;
                    setInviteRole(role);
                    if (role === "admin") setInviteScope({ type: "all" });
                  }}>
                    {memberRoles.map((role) => (
                      <option key={role} value={role}>{memberRoleLabel(role, locale)}</option>
                    ))}
                  </select>
                  <small>{memberRoleDescription(inviteRole, locale)}</small>
                </label>
                <label className="field">
                  <span>{copy(locale, "settings", "invitationExpiresDays")}</span>
                  <input data-testid="invitation-expires-days" type="number" min="1" max="30" value={expiresDays} onChange={(event) => setExpiresDays(Number(event.target.value))} />
                </label>
              </div>
              <MemberScopeFields prefix="invitation" role={inviteRole} scope={inviteScope} parties={parties} disabled={busy} onChange={setInviteScope} />
              {emailDeliveryAvailable ? <label className="toggle-card toggle-card--compact">
                <input
                  data-testid="invitation-send-email"
                  type="checkbox"
                  checked={sendEmail}
                  onChange={(event) => setSendEmailOverride(event.target.checked)}
                  disabled={!hasInviteEmail}
                />
                <span>
                  <strong>{copy(locale, "settings", "invitationSendEmail")}</strong>
                  <small>{copy(locale, "settings", "invitationSendEmailDescription")}</small>
                </span>
              </label> : (
                <small>{copy(locale, "settings", "invitationSendEmailDescription")}</small>
              )}
              <button className="button button--primary" type="submit" disabled={busy}>
                <Icon name="check" size={17} />
                {copy(locale, "settings", "invitationReviewAction")}
              </button>
            </form>

            {createdInvitationUrl ? (
              <div className="member-token-card" data-testid="created-invitation-link">
                <strong>{copy(locale, "settings", "invitationLinkTitle")}</strong>
                <small>{copy(locale, "settings", "invitationLinkDescription")}</small>
                <textarea data-testid="invitation-created-link" readOnly value={createdInvitationUrl} />
                <button className="button button--secondary" type="button" onClick={() => void copyInvitationLink()}>
                  <Icon name="copy" size={17} />
                  {copy(locale, "settings", "invitationLinkCopy")}
                </button>
              </div>
            ) : null}
          </div>

          <div className="member-list" data-testid="member-list">
            {members.map((member) => (
              <div className="member-row" data-testid={`member-row-${member.id}`} key={member.id}>
                <div className="member-row__identity">
                  <span className="child-avatar child-avatar--neutral">
                    <Icon name="user" size={18} />
                  </span>
                  <span>
                    <strong>{member.displayName}</strong>
                    <small>{member.email ?? member.id}</small>
                    <small>
                      {member.owner ? copy(locale, "settings", "memberOwner") : copy(locale, "settings", "memberLastSeen", {
                        date: member.lastSeenAt ? formatDateTime(member.lastSeenAt, intlLocale) : copy(locale, "common", "none")
                      })}
                    </small>
                  </span>
                </div>
                <div className="member-row__access">
                  <strong>{memberRoleLabel(member.effectiveRole, locale)}</strong>
                  <small>{memberScopeSummary(member.owner ? { type: "all" } : member.careDataScope, parties, locale)}</small>
                </div>
                <div className="member-row__actions">
                  {member.membershipRole ? <span className="status-pill status-pill--ok">{copy(locale, "settings", "memberAppRole")}</span> : <span className="status-pill">{copy(locale, "settings", "memberClaimRole")}</span>}
                  {!member.owner && member.id !== currentUserId ? <button className="button button--secondary" type="button" disabled={busy} onClick={() => openMember(member)}><Icon name="settings" size={17} />{copy(locale, "settings", "memberManageAccess")}</button> : null}
                  <button
                    className="button button--danger-quiet"
                    data-testid="member-remove-role"
                    type="button"
                    disabled={busy || member.owner || member.id === currentUserId || !member.membershipRole}
                    onClick={() => void removeMember(member)}
                  >
                    <Icon name="trash" size={17} />
                    {copy(locale, "settings", "memberRemove")}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="invitation-list" data-testid="invitation-list">
            <h3>{copy(locale, "settings", "pendingInvitations")}</h3>
            {invitations.length ? invitations.map((invitation) => {
              const active = !invitation.acceptedAt && !invitation.revokedAt && Date.parse(invitation.expiresAt) > Date.now();
              return (
                <div className="invitation-row" data-testid={`invitation-row-${invitation.id}`} key={invitation.id}>
                  <span>
                    <strong>{invitation.emailHint || memberRoleLabel(invitation.role, locale)}</strong>
                    <small>
                      {memberRoleLabel(invitation.role, locale)} · {memberScopeSummary(invitation.careDataScope, parties, locale)} · {copy(locale, "settings", "invitationExpiresAt", {
                        date: formatDateTime(invitation.expiresAt, intlLocale)
                      })}
                    </small>
                  </span>
                  <span className={active ? "status-pill status-pill--ok" : "status-pill"}>{invitationStatus(invitation, locale)}</span>
                  <button className="button button--danger-quiet" data-testid="invitation-revoke" type="button" disabled={busy || !active} onClick={() => void revokeInvitation(invitation)}>
                    <Icon name="trash" size={17} />
                    {copy(locale, "settings", "invitationRevoke")}
                  </button>
                </div>
              );
            }) : <p className="empty-copy empty-copy--padded">{copy(locale, "settings", "invitationsEmpty")}</p>}
          </div>
        </>
      ) : null}

      {message ? <p className="inline-message" role="status">{message}</p> : null}
      {error && !editingMember && !review ? <p className="form-error" role="alert">{error}</p> : null}
      {editingMember && !review ? <Modal title={copy(locale, "settings", "memberAccessDialogTitle", { name: editingMember.displayName })} size="large" className="member-access-dialog" onClose={() => setEditingMember(null)}>
        <form className="member-access-dialog__body" onSubmit={(event) => { event.preventDefault(); void previewMember(); }}>
          <fieldset className="member-access-roles"><legend>{copy(locale, "settings", "memberRole")}</legend>{memberRoles.map((role) => <label className="member-access-role check-row" key={role}><input type="radio" name="member-role" checked={memberRole === role} disabled={busy} onChange={() => { setMemberRole(role); if (role === "admin") setMemberScope({ type: "all" }); }} /><span><strong>{memberRoleLabel(role, locale)}</strong><small>{memberRoleDescription(role, locale)}</small></span></label>)}</fieldset>
          <MemberScopeFields prefix={`member-${editingMember.id}`} role={memberRole} scope={memberScope} parties={parties} disabled={busy} onChange={setMemberScope} />
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <footer className="form-actions"><span /><div className="form-actions__right"><button className="button button--secondary" type="button" onClick={() => setEditingMember(null)}>{copy(locale, "common", "cancel")}</button><button className="button button--primary" type="submit" disabled={busy}>{copy(locale, "settings", "memberReviewAction")}</button></div></footer>
        </form>
      </Modal> : null}
      {review ? <Modal title={review.kind === "member" && editingMember ? copy(locale, "settings", "memberAccessDialogTitle", { name: editingMember.displayName }) : copy(locale, "settings", "invitationReviewTitle")} size="large" className="member-access-dialog" onClose={() => { setReview(null); if (review.kind === "member") setEditingMember(null); }}>
        <div className="member-access-dialog__body"><MemberAccessReview preview={review.preview} />{error ? <p className="form-error" role="alert">{error}</p> : null}<footer className="form-actions"><span /><div className="form-actions__right"><button className="button button--secondary" type="button" onClick={() => setReview(null)}>{copy(locale, "settings", "memberReviewBack")}</button><button className="button button--primary" type="button" disabled={busy} onClick={() => void applyReview()}>{review.kind === "member" ? copy(locale, "settings", "memberSaveAccess") : copy(locale, "settings", "invitationCreateAction")}</button></div></footer></div>
      </Modal> : null}
    </section>
  );
}

function CarePartyForm({ party, onDone }: { party?: CareParty; onDone: () => void }) {
  const { saveCareParty, canWrite, isSaving } = useAppStore();
  const { locale } = useI18n();
  const [name, setName] = useState(party?.name ?? "");
  const [kind, setKind] = useState<ApiCarePartyKind>(party?.kind ?? "other");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (await saveCareParty(omitUndefinedValues({ id: party?.id, name: name.trim(), kind }))) {
      onDone();
    }
  };

  return (
    <form className="child-form" data-testid="care-party-form" onSubmit={submit}>
      <label className="field">
        <FieldHelpLabel fieldId="settings.carePartyName">
          {copy(locale, "settings", "carePartyName")}
        </FieldHelpLabel>
        <input
          data-testid="care-party-name"
          autoFocus
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={copy(locale, "settings", "carePartyNamePlaceholder")}
        />
      </label>
      <label className="field">
        <FieldHelpLabel fieldId="settings.carePartyKind">
          {copy(locale, "settings", "carePartyKind")}
        </FieldHelpLabel>
        <select
          data-testid="care-party-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as ApiCarePartyKind)}
        >
          {carePartyKinds.map((option) => (
            <option key={option} value={option}>
              {carePartyKindLabel(option, locale)}
            </option>
          ))}
        </select>
      </label>
      <footer className="form-actions">
        <span />
        <div className="form-actions__right">
          <button className="button button--secondary" type="button" onClick={onDone}>
            {copy(locale, "settings", "cancel")}
          </button>
          <button className="button button--primary" data-testid="care-party-submit" type="submit" disabled={!canWrite || isSaving}>
            {party ? copy(locale, "settings", "saveCareParty") : copy(locale, "settings", "addCareParty")}
          </button>
        </div>
      </footer>
    </form>
  );
}

function CalendarFeedManager() {
  const { locale, intlLocale } = useI18n();
  const { canWrite, data } = useAppStore();
  const [selectedScope, setSelectedScope] = useState<ApiCalendarFeedScope>("all");
  const [status, setStatus] = useState<ApiCalendarFeedStatus>({ active: false, scope: "all" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scopeOptions: Array<{ scope: ApiCalendarFeedScope; label: string }> = [
    { scope: "all", label: copy(locale, "calendarFeed", "scopeAll") },
    ...data.careParties.map((party) => ({
      scope: `party:${party.id}` as ApiCalendarFeedScope,
      label: copy(locale, "calendarFeed", "scopeParty", { name: party.name })
    }))
  ];

  const loadStatus = async () => {
    try {
      setStatus(await api.getCalendarFeed(selectedScope));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  useEffect(() => {
    void loadStatus();
  }, [selectedScope]);

  const rotate = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const next = await api.rotateCalendarFeed(selectedScope);
      setStatus(next);
      setMessage(copy(locale, "calendarFeed", "generated"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!window.confirm(copy(locale, "calendarFeed", "revokeConfirm"))) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await api.revokeCalendarFeed(selectedScope);
      setStatus({ active: false, scope: selectedScope });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async () => {
    if (!status.feedUrl) return;
    await navigator.clipboard.writeText(status.feedUrl);
    setMessage(copy(locale, "calendarFeed", "copied"));
  };

  return (
    <section className="panel settings-section settings-section--calendar-feed" data-testid="calendar-feed-manager">
      <div className="panel__header panel__header--compact">
        <div>
          <h2>{copy(locale, "calendarFeed", "title")}</h2>
          <p>{copy(locale, "calendarFeed", "description")}</p>
        </div>
      </div>
      <div className="calendar-feed-content" data-testid="calendar-feed-content">
        <div className="calendar-feed-status">
          <span className={`status-pill ${status.active ? "status-pill--ok" : ""}`}>
            {status.active && status.createdAt
              ? copy(locale, "calendarFeed", "active", {
                  date: formatDateTime(status.createdAt, intlLocale)
                })
              : copy(locale, "calendarFeed", "inactive")}
          </span>
          <small>
            {status.lastUsedAt
              ? copy(locale, "calendarFeed", "lastUsed", {
                  date: formatDateTime(status.lastUsedAt, intlLocale)
                })
              : copy(locale, "calendarFeed", "neverUsed")}
          </small>
        </div>
        <label className="field calendar-feed-scope-field">
          <FieldHelpLabel fieldId="calendarFeed.scope">
            {copy(locale, "calendarFeed", "scopeLabel")}
          </FieldHelpLabel>
          <select
            data-testid="calendar-feed-scope"
            value={selectedScope}
            onChange={(event) => {
              setSelectedScope(event.target.value as ApiCalendarFeedScope);
              setMessage(null);
            }}
          >
            {scopeOptions.map((option) => (
              <option key={option.scope} value={option.scope}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {status.feedUrl ? (
          <div className="calendar-feed-url">
            <input readOnly value={status.feedUrl} data-testid="calendar-feed-url" />
            <button className="button button--secondary" type="button" onClick={() => void copyUrl()}>
              <Icon name="copy" size={17} />
              {copy(locale, "calendarFeed", "copy")}
            </button>
          </div>
        ) : status.active ? (
          <p className="empty-copy">{copy(locale, "calendarFeed", "notAvailable")}</p>
        ) : null}
        <p className="settings-note">{copy(locale, "calendarFeed", "scope")}</p>
        <div className="data-actions">
          <button className="button button--primary" type="button" data-testid="calendar-feed-rotate" disabled={!canWrite || busy} onClick={() => void rotate()}>
            <Icon name="calendar" size={17} />
            {status.active ? copy(locale, "calendarFeed", "rotate") : copy(locale, "calendarFeed", "generate")}
          </button>
          <button className="button button--danger-quiet" type="button" data-testid="calendar-feed-revoke" disabled={!canWrite || busy || !status.active} onClick={() => void revoke()}>
            <Icon name="trash" size={17} />
            {copy(locale, "calendarFeed", "revoke")}
          </button>
        </div>
        {message ? <p className="inline-message" role="status">{message}</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}

function InstanceReadinessSection() {
  const { locale, intlLocale } = useI18n();
  const { session } = useAppStore();
  const [readiness, setReadiness] = useState<ApiInstanceReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canInspectInstance = session.permissions
    ? session.permissions.includes("instance:inspect")
    : true;

  useEffect(() => {
    if (!canInspectInstance) return;
    let cancelled = false;
    api.getInstanceReadiness()
      .then((next) => {
        if (cancelled) return;
        setReadiness(next);
        setError(null);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : copy(locale, "settings", "loadInstanceReadinessFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [canInspectInstance, locale]);

  if (!canInspectInstance) return null;

  const featureLabels = readiness
    ? [
        readiness.features.nativeOidc ? copy(locale, "settings", "nativeOidc") : null,
        readiness.features.trustedProxy ? copy(locale, "settings", "trustedProxy") : null,
        readiness.features.pushConfigured ? copy(locale, "settings", "pushConfigured") : null,
        readiness.features.demoDatasetsEnabled ? copy(locale, "settings", "demoDatasets") : null,
        readiness.features.recoveryAdminEnabled ? copy(locale, "settings", "recoveryAdmin") : null
      ].filter(Boolean)
    : [];

  return (
    <section className="panel settings-section" data-testid="instance-readiness">
      <div className="panel__header panel__header--compact">
        <div>
          <h2>{copy(locale, "settings", "instanceReadiness")}</h2>
          <p>{copy(locale, "settings", "instanceReadinessDescription")}</p>
        </div>
      </div>
      {readiness ? (
        <div className="instance-readiness-grid">
          <div className="readiness-item">
            <small>{copy(locale, "settings", "appVersion")}</small>
            <strong>{readiness.version}</strong>
          </div>
          <div className="readiness-item">
            <small>{copy(locale, "settings", "authMode")}</small>
            <strong>{readiness.authMode}</strong>
          </div>
          <div className="readiness-item">
            <small>{copy(locale, "settings", "runtimeEnvironment")}</small>
            <strong>{readiness.environment}</strong>
          </div>
          <div className="readiness-item">
            <small>{copy(locale, "settings", "requireAuth")}</small>
            <strong>{yesNo(readiness.requireAuth, locale)}</strong>
          </div>
          <div className="readiness-item readiness-item--wide">
            <small>{copy(locale, "settings", "databaseStatus")}</small>
            <strong>{readiness.database.reachable && readiness.database.upToDate ? copy(locale, "settings", "databaseReady") : copy(locale, "settings", "databaseNeedsAttention")}</strong>
            <span>{copy(locale, "settings", "migrations")}: {readiness.database.migrationsApplied} / {readiness.database.latestAvailableMigration ?? "-"}</span>
          </div>
          <div className="readiness-item readiness-item--wide">
            <small>{copy(locale, "settings", "setupState")}</small>
            <strong>{readiness.setup.complete ? copy(locale, "settings", "setupComplete") : copy(locale, "settings", "setupIncomplete")}</strong>
            <span>
              {copy(locale, "settings", "setupCounts", {
                children: readiness.setup.children,
                careParties: readiness.setup.careParties,
                appUsers: readiness.setup.appUsers
              })}
            </span>
          </div>
          <div className="readiness-item readiness-item--wide">
            <small>{copy(locale, "settings", "enabledFeatures")}</small>
            <div className="readiness-pills">
              {featureLabels.length ? featureLabels.map((label) => (
                <span className="status-pill status-pill--ok" key={label}>{label}</span>
              )) : <span className="status-pill">{copy(locale, "settings", "notConfigured")}</span>}
            </div>
          </div>
          <div className="readiness-item">
            <small>{copy(locale, "settings", "serverTime")}</small>
            <strong>{formatDateTime(readiness.serverTime, intlLocale)}</strong>
            <span>{readiness.timezone}</span>
          </div>
          <div className="readiness-item">
            <small>{copy(locale, "settings", "instanceId")}</small>
            <strong>{readiness.instanceId}</strong>
          </div>
        </div>
      ) : (
        <p className="empty-copy empty-copy--padded">{error ?? "..."}</p>
      )}
      {error && readiness ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}

export function SettingsPage() {
  const { locale, intlLocale, setLocale, t } = useI18n();
  const { helpIconsVisible, setHelpIconsVisible } = useHelpPreferences();
  const {
    data,
    removeChild,
    removeCareParty,
    updateSettings,
    loadDemo,
    loadEdgeCaseDemo,
    clearAll,
    session,
    canWrite,
    isSaving,
    actorLabels
  } = useAppStore();
  const hasPermission = (permission: NonNullable<ApiSession["permissions"]>[number]) =>
    session.permissions?.includes(permission) ?? true;
  const canManagePlanning = hasPermission("planning:manage");
  const canManageChildren = hasPermission("children:manage");
  const canManageSettings = hasPermission("settings:manage");
  const canViewPlanning = hasPermission("planning:view");
  const canManageFeeds = hasPermission("feeds:manage-own");
  const canManageNotifications = hasPermission("notifications:manage-own");
  const [editingChild, setEditingChild] = useState<Child | "new" | null>(null);
  const [editingCareParty, setEditingCareParty] = useState<CareParty | "new" | null>(null);

  const deleteChild = async (child: Child) => {
    const affected = data.entries.filter((entry) => !entry.deletedAt && entry.childIds.includes(child.id)).length;
    const message = affected
      ? copy(locale, "settings", "childDeleteAffected", { name: child.name, count: affected })
      : copy(locale, "settings", "childDelete", { name: child.name });
    if (window.confirm(message)) await removeChild(child.id);
  };

  const deleteCareParty = async (party: CareParty) => {
    const affectedEntries = data.entries.filter((entry) => !entry.deletedAt && entry.responsiblePartyId === party.id).length;
    const affectedRules = data.contactRules.filter((rule) => rule.responsiblePartyId === party.id).length;
    const affected = affectedEntries + affectedRules;
    const message = affected
      ? copy(locale, "settings", "carePartyDeleteBlocked", { name: party.name, count: affected })
      : copy(locale, "settings", "carePartyDelete", { name: party.name });
    if (window.confirm(message)) await removeCareParty(party.id);
  };

  const loadExamples = async () => {
    if (data.children.length || data.entries.some((entry) => !entry.deletedAt)) {
      if (!window.confirm(copy(locale, "settings", "demoReplaceConfirm"))) return;
    }
    await loadDemo();
  };

  const loadEdgeCases = async () => {
    if (data.children.length || data.entries.some((entry) => !entry.deletedAt)) {
      if (!window.confirm(copy(locale, "settings", "edgeCaseDemoReplaceConfirm"))) return;
    }
    await loadEdgeCaseDemo();
  };

  const clearData = async () => {
    if (window.confirm(copy(locale, "settings", "clearDataConfirm"))) {
      await clearAll();
    }
  };

  return (
    <div className="page page--settings" data-testid="page-settings">
      <div className="page-header">
        <div>
          <p className="page-header__context">{t("settings.context")}</p>
          <h1>{t("settings.title")}</h1>
        </div>
      </div>

      <section className="panel settings-section">
        <div className="panel__header panel__header--compact">
          <div>
            <h2>{t("settings.language.title")}</h2>
            <p>{t("settings.language.description")}</p>
          </div>
        </div>
        <div className="settings-form-grid">
          <label className="field">
            <FieldHelpLabel fieldId="settings.language">
              {t("settings.language.label")}
            </FieldHelpLabel>
            <select
              data-testid="settings-language"
              value={locale}
              onChange={(event) =>
                setLocale(event.target.value as (typeof supportedLocales)[number])
              }
            >
              {supportedLocales.map((supportedLocale) => (
                <option key={supportedLocale} value={supportedLocale}>
                  {localeMetadata[supportedLocale].label}
                </option>
              ))}
            </select>
            <small>{t("settings.language.fallback")}</small>
          </label>
          <AppearanceControl />
        </div>
      </section>

      <section className="panel settings-section" data-testid="settings-help-visibility">
        <div className="panel__header panel__header--compact">
          <div>
            <h2>{copy(locale, "settings", "inlineHelpTitle")}</h2>
            <p>{copy(locale, "settings", "inlineHelpDescription")}</p>
          </div>
        </div>
        <div className="settings-toggle-row">
          <span>
            <strong>{copy(locale, "settings", "inlineHelpToggle")}</strong>
            <small>{copy(locale, "settings", "inlineHelpToggleDescription")}</small>
          </span>
          <label
            aria-label={copy(locale, "settings", "inlineHelpToggle")}
            className="toggle toggle--compact"
            data-testid="settings-help-icons-switch"
          >
            <input
              data-testid="settings-help-icons-toggle"
              type="checkbox"
              checked={helpIconsVisible}
              onChange={(event) => setHelpIconsVisible(event.target.checked)}
            />
            <span />
          </label>
        </div>
      </section>

      {canManageNotifications ? <NotificationPreferencesSection /> : null}

      <InstanceReadinessSection />

      <MemberInvitationManager />

      <PrivacyActionWorkflow children={data.children} careParties={data.careParties} />

      {canManagePlanning ? <section className="panel settings-section">
        <div className="panel__header">
          <div>
            <h2>{copy(locale, "settings", "careParties")}</h2>
            <p>{copy(locale, "settings", "carePartiesDescription")}</p>
          </div>
          <button className="button button--primary" data-testid="settings-add-care-party" type="button" onClick={() => setEditingCareParty("new")} disabled={!canWrite || isSaving}>
            <Icon name="plus" size={17} />
            {copy(locale, "settings", "addCareParty")}
          </button>
        </div>
        <div className="child-settings-list" data-testid="care-party-list">
          {data.careParties.map((party) => (
            <div className="child-settings-row" key={party.id}>
              <span className="child-avatar child-avatar--neutral">
                <Icon name="user" size={20} />
              </span>
              <span>
                <strong>{party.name}</strong>
                <small>{carePartyKindLabel(party.kind, locale)}</small>
                <small>
                  {copy(locale, "common", "updatedBy", {
                    actor: actorDisplayName(actorLabels, party.updatedBy),
                    date: formatDateTime(party.updatedAt, intlLocale)
                  })}
                </small>
              </span>
              <span className="child-settings-row__actions">
                <button className="icon-button icon-button--bordered" type="button" onClick={() => setEditingCareParty(party)} aria-label={copy(locale, "settings", "editCarePartyAria", { name: party.name })}><Icon name="edit" size={17} /></button>
                <button className="icon-button icon-button--bordered icon-button--danger" type="button" onClick={() => void deleteCareParty(party)} disabled={!canWrite || isSaving} aria-label={copy(locale, "settings", "deleteCarePartyAria", { name: party.name })}><Icon name="trash" size={17} /></button>
              </span>
            </div>
          ))}
          {data.careParties.length === 0 ? <p className="empty-copy empty-copy--padded">{copy(locale, "settings", "noCareParties")}</p> : null}
        </div>
      </section> : null}

      {canManageChildren ? <section className="panel settings-section">
        <div className="panel__header">
          <div>
            <h2>{copy(locale, "settings", "children")}</h2>
            <p>{copy(locale, "settings", "childrenDescription")}</p>
          </div>
          <button className="button button--primary" data-testid="settings-add-child" type="button" onClick={() => setEditingChild("new")} disabled={!canWrite || isSaving}>
            <Icon name="plus" size={17} />
            {copy(locale, "settings", "addChild")}
          </button>
        </div>
        <div className="child-settings-list">
          {data.children.map((child) => (
            <div className="child-settings-row" key={child.id}>
              <span className="child-avatar" style={{ backgroundColor: `${child.color}18`, color: child.color }}>
                {child.name.slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{child.name}</strong>
                {child.birthMonth !== null && child.birthYear !== null
                  ? <small>{copy(locale, "settings", "born", { month: String(child.birthMonth).padStart(2, "0"), year: child.birthYear })}</small>
                  : null}
                <small>
                  {copy(locale, "common", "updatedBy", {
                    actor: actorDisplayName(actorLabels, child.updatedBy),
                    date: formatDateTime(child.updatedAt, intlLocale)
                  })}
                </small>
              </span>
              <span className="child-settings-row__actions">
                <button className="icon-button icon-button--bordered" type="button" onClick={() => setEditingChild(child)} aria-label={copy(locale, "settings", "editChildAria", { name: child.name })}><Icon name="edit" size={17} /></button>
                <button className="icon-button icon-button--bordered icon-button--danger" type="button" onClick={() => void deleteChild(child)} disabled={!canWrite || isSaving} aria-label={copy(locale, "settings", "deleteChildAria", { name: child.name })}><Icon name="trash" size={17} /></button>
              </span>
            </div>
          ))}
          {data.children.length === 0 ? <p className="empty-copy empty-copy--padded">{copy(locale, "settings", "noChildren")}</p> : null}
        </div>
      </section> : null}

      {canManageSettings ? <section className="panel settings-section settings-section--defaults">
        <div className="panel__header panel__header--compact">
          <div>
            <h2>{copy(locale, "settings", "defaults")}</h2>
            <p>{copy(locale, "settings", "defaultsDescription")}</p>
          </div>
        </div>
        <div className="settings-form-grid" data-testid="settings-defaults-grid">
          <label className="field">
            <FieldHelpLabel fieldId="settings.kilometerRate">{copy(locale, "settings", "kilometerRate")}</FieldHelpLabel>
            <input
              type="number"
              min="0"
              step="0.01"
              value={data.settings.kilometerRate}
              disabled={!canWrite || isSaving}
              onChange={(event) =>
                void updateSettings({ kilometerRate: Number(event.target.value) })
              }
            />
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="settings.primaryCareParty">
              {copy(locale, "settings", "primaryCareParty")}
            </FieldHelpLabel>
            <select
              data-testid="settings-primary-care-party"
              value={data.settings.primaryCarePartyId ?? data.settings.defaultResponsiblePartyId ?? ""}
              disabled={!canWrite || isSaving || !data.careParties.length}
              onChange={(event) =>
                void updateSettings(event.target.value
                  ? { primaryCarePartyId: event.target.value }
                  : {})
              }
            >
              {data.careParties.length ? null : (
                <option value="">{copy(locale, "settings", "noCareParties")}</option>
              )}
              {data.careParties.map((party) => (
                <option key={party.id} value={party.id}>
                  {party.name}
                </option>
              ))}
            </select>
            <small>{copy(locale, "settings", "primaryCarePartyDescription")}</small>
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="settings.defaultResponsibleParty">
              {copy(locale, "settings", "defaultResponsibleParty")}
            </FieldHelpLabel>
            <select
              data-testid="settings-default-responsible-party"
              value={data.settings.defaultResponsiblePartyId ?? ""}
              disabled={!canWrite || isSaving || !data.careParties.length}
              onChange={(event) =>
                void updateSettings(event.target.value
                  ? { defaultResponsiblePartyId: event.target.value }
                  : {})
              }
            >
              {data.careParties.length ? null : (
                <option value="">{copy(locale, "settings", "noCareParties")}</option>
              )}
              {data.careParties.map((party) => (
                <option key={party.id} value={party.id}>
                  {party.name}
                </option>
              ))}
            </select>
            <small>{copy(locale, "settings", "defaultResponsiblePartyDescription")}</small>
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="settings.defaultLocation" />
            <select value={data.settings.defaultLocation} disabled={!canWrite || isSaving} onChange={(event) => void updateSettings({ defaultLocation: event.target.value as CareLocation })}>
              {(["commuterApartment", "mainResidence", "mother", "school", "ogs", "other"] as const).map((value) => <option key={value} value={value}>{locationLabel(value, locale)}</option>)}
            </select>
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="settings.defaultHandoverFrom">
              {copy(locale, "settings", "defaultHandoverFrom")}
            </FieldHelpLabel>
            <select value={data.settings.defaultHandoverFrom} disabled={!canWrite || isSaving} onChange={(event) => void updateSettings({ defaultHandoverFrom: event.target.value as HandoverParty })}>
              {(["mother", "father", "school", "ogs", "thirdParty"] as const).map((value) => <option key={value} value={value}>{handoverLabel(value, locale)}</option>)}
            </select>
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="settings.defaultHandoverTo">
              {copy(locale, "settings", "defaultHandoverTo")}
            </FieldHelpLabel>
            <select value={data.settings.defaultHandoverTo} disabled={!canWrite || isSaving} onChange={(event) => void updateSettings({ defaultHandoverTo: event.target.value as HandoverParty })}>
              {(["mother", "father", "school", "ogs", "thirdParty"] as const).map((value) => <option key={value} value={value}>{handoverLabel(value, locale)}</option>)}
            </select>
          </label>
        </div>
      </section> : null}

      {hasPermission("admin:destructive") ? (
        <section className="panel settings-section">
          <div className="panel__header panel__header--compact">
          <div>
            <h2>{copy(locale, "settings", "demoData")}</h2>
            <p>{copy(locale, "settings", "demoDataDescription")}</p>
          </div>
        </div>
        <div className="data-actions">
          <button className="button button--secondary" type="button" onClick={() => void loadExamples()} disabled={!canWrite || isSaving}>{copy(locale, "settings", "loadDemo")}</button>
          {session.demoDatasetsEnabled && hasPermission("admin:destructive") ? (
            <button className="button button--secondary" data-testid="settings-load-edge-case-demo" type="button" onClick={() => void loadEdgeCases()} disabled={!canWrite || isSaving}>{copy(locale, "settings", "loadEdgeCaseDemo")}</button>
          ) : null}
          <button className="button button--danger-quiet" type="button" onClick={() => void clearData()} disabled={!canWrite || isSaving}><Icon name="trash" size={17} />{copy(locale, "settings", "clearData")}</button>
        </div>
        </section>
      ) : null}

      {canViewPlanning ? <ExternalCalendarManager /> : null}

      {canManageFeeds ? <CalendarFeedManager /> : null}

      {canManageChildren && editingChild ? (
        <Modal title={editingChild === "new" ? copy(locale, "settings", "addChild") : copy(locale, "settings", "editChild")} onClose={() => setEditingChild(null)}>
          <ChildForm {...(editingChild === "new" ? {} : { child: editingChild })} onDone={() => setEditingChild(null)} />
        </Modal>
      ) : null}
      {canManagePlanning && editingCareParty ? (
        <Modal title={editingCareParty === "new" ? copy(locale, "settings", "addCareParty") : copy(locale, "settings", "editCareParty")} onClose={() => setEditingCareParty(null)}>
          <CarePartyForm {...(editingCareParty === "new" ? {} : { party: editingCareParty })} onDone={() => setEditingCareParty(null)} />
        </Modal>
      ) : null}
    </div>
  );
}
