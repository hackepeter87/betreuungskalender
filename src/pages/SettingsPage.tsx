import { useEffect, useState, type FormEvent } from "react";
import { CHILD_COLORS } from "../data/defaults";
import { Icon } from "../components/Icon";
import { FieldHelpButton, FieldHelpLabel } from "../components/FieldHelp";
import { Modal } from "../components/Modal";
import { ExternalCalendarManager } from "../components/ExternalCalendarManager";
import { useHelpPreferences } from "../context/HelpPreferences";
import { useI18n } from "../i18n/I18nProvider";
import { copy, type CatalogKey } from "../i18n/catalog";
import { localeMetadata, supportedLocales } from "../i18n/resources";
import { actorDisplayName } from "../lib/actors";
import { ApiError, api } from "../lib/api";
import { formatDateTime } from "../lib/date";
import { handoverLabel, locationLabel } from "../lib/labels";
import { useAppStore } from "../store/AppStore";
import {
  type ApiAuthRole,
  carePartyKinds,
  type ApiAppUser,
  type ApiCalendarFeedScope,
  type ApiCalendarFeedStatus,
  type ApiCarePartyKind,
  type ApiInvitation,
  type ApiInstanceReadiness,
  type ApiMember,
  type ApiUserCarePartyAssignment
} from "../../shared/api";
import type { CareLocation, CareParty, Child, HandoverParty, NotificationEventType, NotificationPreference } from "../types";

function ChildForm({ child, onDone }: { child?: Child; onDone: () => void }) {
  const { saveChild, canWrite, isSaving } = useAppStore();
  const { locale } = useI18n();
  const [name, setName] = useState(child?.name ?? "");
  const [birthMonth, setBirthMonth] = useState(child?.birthMonth ?? 1);
  const [birthYear, setBirthYear] = useState(child?.birthYear ?? new Date().getFullYear() - 8);
  const [color, setColor] = useState(child?.color ?? CHILD_COLORS[0]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (await saveChild({ id: child?.id, name, birthMonth, birthYear, color })) {
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
  return copy(locale, "settings", `carePartyKind_${kind}` as CatalogKey<"settings">);
}

function notificationEventLabel(eventType: NotificationEventType, locale: "de" | "en") {
  return eventType === "care_confirmation_due"
    ? copy(locale, "notifications", "careConfirmationDue")
    : copy(locale, "notifications", "careConfirmationReminder");
}

function yesNo(value: boolean, locale: "de" | "en") {
  return copy(locale, "common", value ? "yes" : "no");
}

function NotificationPreferencesSection() {
  const { locale } = useI18n();
  const {
    notificationPreferences,
    updateNotificationPreferences,
    registerPushSubscription,
    canWrite,
    isSaving
  } = useAppStore();
  const preferences = notificationPreferences?.preferences ?? [];

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
        <button className="button button--secondary" type="button" disabled={!canWrite || isSaving || !notificationPreferences?.pushAvailable} onClick={() => void registerPushSubscription()}>
          <Icon name="bell" size={17} />
          {copy(locale, "notifications", "enablePush")}
        </button>
      </div>
      <div className="notification-rules">
        <p><strong>{copy(locale, "notifications", "whenTitle")}</strong>{copy(locale, "notifications", "whenDescription")}</p>
        <p><strong>{copy(locale, "notifications", "editableTitle")}</strong>{copy(locale, "notifications", "editableDescription")}</p>
      </div>
      <div className="notification-preferences-table">
        <div className="notification-preferences-row notification-preferences-row--head">
          <span>{copy(locale, "notifications", "event")}</span>
          <span>{copy(locale, "notifications", "inApp")}</span>
          <span className="notification-preferences-row__channel">
            {copy(locale, "notifications", "push")}
            <FieldHelpButton fieldId="settings.notificationChannels" showRequirement={false} />
          </span>
        </div>
        {preferences.map((preference) => (
          <div className="notification-preferences-row" key={preference.eventType}>
            <strong>{notificationEventLabel(preference.eventType, locale)}</strong>
            <span className="status-pill status-pill--ok">{copy(locale, "common", "yes")}</span>
            <label className="toggle toggle--compact">
              <input
                type="checkbox"
                checked={preference.pushEnabled}
                disabled={!canWrite || isSaving}
                onChange={(event) => patchPreference(preference.eventType, { pushEnabled: event.target.checked })}
              />
              <span />
            </label>
          </div>
        ))}
      </div>
      <p className="settings-note">
        {notificationPreferences?.pushAvailable
          ? copy(locale, "notifications", "pushActive", { count: notificationPreferences.activePushSubscriptions })
          : copy(locale, "notifications", "pushUnavailable")}
      </p>
    </section>
  );
}

function FirstRunOwnerBootstrapSection() {
  const { locale } = useI18n();
  const { session, reload } = useAppStore();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!session.authenticated || !session.setup?.required) return null;

  const bootstrap = async () => {
    if (!window.confirm(copy(locale, "settings", "ownerBootstrapConfirm"))) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.bootstrapInstallationOwner();
      setMessage(copy(locale, "settings", "ownerBootstrapDone"));
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel settings-section" data-testid="owner-bootstrap">
      <div className="panel__header">
        <div>
          <h2>{copy(locale, "settings", "ownerBootstrap")}</h2>
          <p>{copy(locale, "settings", "ownerBootstrapDescription")}</p>
        </div>
        <button className="button button--primary" type="button" data-testid="owner-bootstrap-confirm" disabled={busy} onClick={() => void bootstrap()}>
          <Icon name="check" size={17} />
          {copy(locale, "settings", "ownerBootstrapAction")}
        </button>
      </div>
      <p className="settings-note">{copy(locale, "settings", "ownerBootstrapNote")}</p>
      {message ? <p className="inline-message" role="status">{message}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}

const memberRoles: ApiAuthRole[] = ["admin", "parent", "readonly"];

function memberRoleLabel(role: ApiAuthRole, locale: "de" | "en") {
  return copy(locale, "settings", `memberRole_${role}` as CatalogKey<"settings">);
}

function invitationStatus(invitation: ApiInvitation, locale: "de" | "en") {
  if (invitation.acceptedAt) return copy(locale, "settings", "invitationAccepted");
  if (invitation.revokedAt) return copy(locale, "settings", "invitationRevoked");
  if (Date.parse(invitation.expiresAt) <= Date.now()) return copy(locale, "settings", "invitationExpired");
  return copy(locale, "settings", "invitationPending");
}

function MemberInvitationManager() {
  const { locale, intlLocale } = useI18n();
  const { session, reload } = useAppStore();
  const [members, setMembers] = useState<ApiMember[]>([]);
  const [invitations, setInvitations] = useState<ApiInvitation[]>([]);
  const [acceptToken, setAcceptToken] = useState(() =>
    new URLSearchParams(window.location.search).get("invitation") ?? ""
  );
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ApiAuthRole>("parent");
  const [expiresDays, setExpiresDays] = useState(7);
  const [sendEmail, setSendEmail] = useState(false);
  const [emailDeliveryAvailable, setEmailDeliveryAvailable] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ownerForbidden, setOwnerForbidden] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOwnerData = async () => {
    if (session.user?.role !== "admin") return;
    try {
      const [nextMembers, nextInvitations, capabilities] = await Promise.all([
        api.listMembers(),
        api.listInvitations(),
        api.invitationCapabilities()
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
  }, [session.user?.role, session.user?.id]);

  if (!session.authenticated) return null;

  const acceptInvitation = async (event: FormEvent) => {
    event.preventDefault();
    if (!acceptToken.trim()) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await api.acceptInvitation(acceptToken.trim());
      setAcceptToken("");
      setMessage(copy(locale, "settings", "invitationAcceptDone"));
      await reload();
      await loadOwnerData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const createInvitation = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    setCreatedToken(null);
    try {
      const safeExpiresDays = Number.isFinite(expiresDays) ? Math.min(30, Math.max(1, expiresDays)) : 7;
      const expiresAt = new Date(Date.now() + safeExpiresDays * 86_400_000).toISOString();
      const created = await api.createInvitation({
        role: inviteRole,
        expiresAt,
        emailHint: inviteEmail.trim() || undefined,
        sendEmail
      });
      setInvitations((items) => [created.invitation, ...items]);
      setCreatedToken(created.token);
      setInviteEmail("");
      setSendEmail(false);
      if (created.emailDelivery?.status === "sent") {
        setMessage(copy(locale, "settings", "invitationEmailSent"));
      } else if (created.emailDelivery?.status === "failed") {
        setMessage(created.emailDelivery.message ?? copy(locale, "settings", "invitationEmailFailed"));
      } else {
        setMessage(copy(locale, "settings", "invitationCreated"));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (member: ApiMember, role: ApiAuthRole) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const updated = await api.updateMemberRole(member.id, role);
      setMembers((items) => items.map((item) => item.id === updated.id ? updated : item));
      setMessage(copy(locale, "settings", "memberRoleUpdated"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
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

  const copyToken = async () => {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    setMessage(copy(locale, "settings", "invitationTokenCopied"));
  };

  const currentUserId = session.user?.id;
  const showOwnerControls = session.user?.role === "admin" && !ownerForbidden;

  return (
    <section className="panel settings-section" data-testid="member-invitations">
      <div className="panel__header panel__header--compact">
        <div>
          <h2>{copy(locale, "settings", "members")}</h2>
          <p>{copy(locale, "settings", "membersDescription")}</p>
        </div>
      </div>

      <form className="member-invite-accept" data-testid="invitation-accept-form" onSubmit={(event) => void acceptInvitation(event)}>
        <label className="field">
          <span>{copy(locale, "settings", "invitationAccept")}</span>
          <input
            data-testid="invitation-accept-token"
            value={acceptToken}
            onChange={(event) => setAcceptToken(event.target.value)}
            placeholder={copy(locale, "settings", "invitationTokenPlaceholder")}
            autoComplete="off"
          />
        </label>
        <button className="button button--secondary" type="submit" disabled={busy || !acceptToken.trim()}>
          <Icon name="check" size={17} />
          {copy(locale, "settings", "invitationAcceptAction")}
        </button>
      </form>

      {showOwnerControls ? (
        <>
          <div className="member-management-grid">
            <form className="member-invite-card" data-testid="invitation-create-form" onSubmit={(event) => void createInvitation(event)}>
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
                  onChange={(event) => {
                    setInviteEmail(event.target.value);
                    setSendEmail(Boolean(event.target.value.trim()) && emailDeliveryAvailable);
                  }}
                  placeholder="name@example.invalid"
                />
              </label>
              <div className="member-invite-card__row">
                <label className="field">
                  <span>{copy(locale, "settings", "memberRole")}</span>
                  <select data-testid="invitation-role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as ApiAuthRole)}>
                    {memberRoles.map((role) => (
                      <option key={role} value={role}>{memberRoleLabel(role, locale)}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{copy(locale, "settings", "invitationExpiresDays")}</span>
                  <input data-testid="invitation-expires-days" type="number" min="1" max="30" value={expiresDays} onChange={(event) => setExpiresDays(Number(event.target.value))} />
                </label>
              </div>
              {emailDeliveryAvailable ? <label className="toggle-card toggle-card--compact">
                <input
                  data-testid="invitation-send-email"
                  type="checkbox"
                  checked={sendEmail}
                  onChange={(event) => setSendEmail(event.target.checked)}
                  disabled={!inviteEmail.trim()}
                />
                <span>
                  <strong>{copy(locale, "settings", "invitationSendEmail")}</strong>
                  <small>{copy(locale, "settings", "invitationSendEmailDescription")}</small>
                </span>
              </label> : (
                <small>{copy(locale, "settings", "invitationSendEmailDescription")}</small>
              )}
              <button className="button button--primary" type="submit" disabled={busy}>
                <Icon name="plus" size={17} />
                {copy(locale, "settings", "invitationCreateAction")}
              </button>
            </form>

            {createdToken ? (
              <div className="member-token-card" data-testid="created-invitation-token">
                <strong>{copy(locale, "settings", "invitationTokenTitle")}</strong>
                <small>{copy(locale, "settings", "invitationTokenDescription")}</small>
                <textarea data-testid="invitation-created-token" readOnly value={createdToken} />
                <button className="button button--secondary" type="button" onClick={() => void copyToken()}>
                  <Icon name="copy" size={17} />
                  {copy(locale, "settings", "invitationTokenCopy")}
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
                <label className="field field--compact">
                  <span>{copy(locale, "settings", "memberRole")}</span>
                  <select
                    data-testid="member-role-select"
                    value={member.effectiveRole}
                    disabled={busy || member.owner || member.id === currentUserId}
                    onChange={(event) => void changeRole(member, event.target.value as ApiAuthRole)}
                  >
                    {memberRoles.map((role) => (
                      <option key={role} value={role}>{memberRoleLabel(role, locale)}</option>
                    ))}
                  </select>
                </label>
                <div className="member-row__actions">
                  {member.membershipRole ? <span className="status-pill status-pill--ok">{copy(locale, "settings", "memberAppRole")}</span> : <span className="status-pill">{copy(locale, "settings", "memberClaimRole")}</span>}
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
                      {memberRoleLabel(invitation.role, locale)} · {copy(locale, "settings", "invitationExpiresAt", {
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
      {error ? <p className="form-error" role="alert">{error}</p> : null}
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
    if (await saveCareParty({ id: party?.id, name: name.trim(), kind })) {
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
    </section>
  );
}

function UserCarePartyAssignmentManager() {
  const { locale } = useI18n();
  const { data, session, canWrite } = useAppStore();
  const [users, setUsers] = useState<ApiAppUser[]>([]);
  const [assignments, setAssignments] = useState<ApiUserCarePartyAssignment[]>([]);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (session.user?.role !== "admin") return;
    try {
      const [nextUsers, nextAssignments] = await Promise.all([
        api.listAppUsers(),
        api.listUserCarePartyAssignments()
      ]);
      setUsers(nextUsers);
      setAssignments(nextAssignments);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  useEffect(() => {
    void load();
  }, [session.user?.role]);

  if (session.user?.role !== "admin") return null;

  const assignmentFor = (userId: string) =>
    assignments.find((assignment) => assignment.userId === userId)?.carePartyIds ?? [];

  const toggle = async (userId: string, carePartyId: string) => {
    const current = assignmentFor(userId);
    const next = current.includes(carePartyId)
      ? current.filter((id) => id !== carePartyId)
      : [...current, carePartyId];
    setBusyUserId(userId);
    setError(null);
    try {
      const saved = await api.updateUserCarePartyAssignment(userId, next);
      setAssignments((items) => [
        ...items.filter((item) => item.userId !== userId),
        saved
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <section className="panel settings-section" data-testid="user-care-party-assignments">
      <div className="panel__header panel__header--compact">
        <div>
          <h2>{copy(locale, "settings", "userAssignments")}</h2>
          <p>{copy(locale, "settings", "userAssignmentsDescription")}</p>
        </div>
      </div>
      {users.length && data.careParties.length ? (
        <div className="assignment-list">
          {users.map((user) => {
            const selected = assignmentFor(user.id);
            return (
              <div className="assignment-row" key={user.id}>
                <div>
                  <strong>{user.displayName}</strong>
                  <small>{user.email ?? user.role}</small>
                </div>
                <div className="assignment-row__choices">
                  {data.careParties.map((party) => (
                    <label className="check-row" key={party.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(party.id)}
                        disabled={!canWrite || busyUserId === user.id}
                        onChange={() => void toggle(user.id, party.id)}
                      />
                      {party.name}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="empty-copy empty-copy--padded">{copy(locale, "settings", "userAssignmentsEmpty")}</p>
      )}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}

function InstanceReadinessSection() {
  const { locale, intlLocale } = useI18n();
  const { session } = useAppStore();
  const [readiness, setReadiness] = useState<ApiInstanceReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.user?.role !== "admin") return;
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
  }, [locale, session.user?.role]);

  if (session.user?.role !== "admin") return null;

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
          <div className="readiness-item readiness-item--wide">
            <small>{copy(locale, "settings", "serverTime")}</small>
            <strong>{formatDateTime(readiness.serverTime, intlLocale)}</strong>
            <span>{readiness.timezone}</span>
          </div>
          <div className="readiness-item readiness-item--wide">
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
    isSaving
  } = useAppStore();
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
    <div className="page page--narrow" data-testid="page-settings">
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

      <FirstRunOwnerBootstrapSection />

      <NotificationPreferencesSection />

      <InstanceReadinessSection />

      <MemberInvitationManager />

      <UserCarePartyAssignmentManager />

      <section className="panel settings-section">
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
                    actor: actorDisplayName(data, party.updatedBy),
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
      </section>

      <section className="panel settings-section">
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
                <small>{copy(locale, "settings", "born", { month: String(child.birthMonth).padStart(2, "0"), year: child.birthYear })}</small>
                <small>
                  {copy(locale, "common", "updatedBy", {
                    actor: actorDisplayName(data, child.updatedBy),
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
      </section>

      <section className="panel settings-section">
        <div className="panel__header panel__header--compact">
          <div>
            <h2>{copy(locale, "settings", "defaults")}</h2>
            <p>{copy(locale, "settings", "defaultsDescription")}</p>
          </div>
        </div>
        <div className="settings-form-grid">
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
                void updateSettings({
                  primaryCarePartyId: event.target.value || undefined
                })
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
                void updateSettings({
                  defaultResponsiblePartyId: event.target.value || undefined
                })
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
      </section>

      <section className="panel settings-section">
        <div className="panel__header panel__header--compact">
          <div>
            <h2>{copy(locale, "settings", "demoData")}</h2>
            <p>{copy(locale, "settings", "demoDataDescription")}</p>
          </div>
        </div>
        <div className="data-actions">
          <button className="button button--secondary" type="button" onClick={() => void loadExamples()} disabled={!canWrite || isSaving}>{copy(locale, "settings", "loadDemo")}</button>
          {session.demoDatasetsEnabled && session.user?.role === "admin" ? (
            <button className="button button--secondary" data-testid="settings-load-edge-case-demo" type="button" onClick={() => void loadEdgeCases()} disabled={!canWrite || isSaving}>{copy(locale, "settings", "loadEdgeCaseDemo")}</button>
          ) : null}
          <button className="button button--danger-quiet" type="button" onClick={() => void clearData()} disabled={!canWrite || isSaving}><Icon name="trash" size={17} />{copy(locale, "settings", "clearData")}</button>
        </div>
      </section>

      <ExternalCalendarManager />

      <CalendarFeedManager />

      {editingChild ? (
        <Modal title={editingChild === "new" ? copy(locale, "settings", "addChild") : copy(locale, "settings", "editChild")} onClose={() => setEditingChild(null)}>
          <ChildForm child={editingChild === "new" ? undefined : editingChild} onDone={() => setEditingChild(null)} />
        </Modal>
      ) : null}
      {editingCareParty ? (
        <Modal title={editingCareParty === "new" ? copy(locale, "settings", "addCareParty") : copy(locale, "settings", "editCareParty")} onClose={() => setEditingCareParty(null)}>
          <CarePartyForm party={editingCareParty === "new" ? undefined : editingCareParty} onDone={() => setEditingCareParty(null)} />
        </Modal>
      ) : null}
    </div>
  );
}
