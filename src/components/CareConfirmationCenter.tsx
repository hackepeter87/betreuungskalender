import { useMemo, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";
import { formatDate } from "../lib/date";
import { useAppStore } from "../store/AppStore";
import type { CareEntry } from "../types";
import { Icon } from "./Icon";

interface PartialConfirmationDraft {
  actualChildIds: string[];
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  actualResponsiblePartyId: string;
}

function dateTimeParts(value: string) {
  const [date, time = "00:00"] = value.slice(0, 16).split("T");
  return { date, time };
}

function defaultPartialDraft(entry: CareEntry): PartialConfirmationDraft {
  const start = dateTimeParts(entry.actualStartDateTime ?? entry.startDateTime);
  const end = dateTimeParts(entry.actualEndDateTime ?? entry.endDateTime);
  return {
    actualChildIds: entry.actualChildIds?.length ? entry.actualChildIds : entry.childIds,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    actualResponsiblePartyId: entry.actualResponsiblePartyId ?? entry.responsiblePartyId ?? ""
  };
}

export function CareConfirmationCenter({
  limit,
  compact = false,
  onOpenEntry
}: {
  limit?: number;
  compact?: boolean;
  onOpenEntry: (entry: CareEntry) => void;
}) {
  const { locale, intlLocale } = useI18n();
  const {
    data,
    canWrite,
    isSaving,
    openConfirmations,
    answerCareConfirmation,
    remindCareConfirmationLater
  } = useAppStore();
  const [confirmationNotes, setConfirmationNotes] = useState<Record<string, string>>({});
  const [partialDrafts, setPartialDrafts] = useState<Record<string, PartialConfirmationDraft>>({});
  const visibleConfirmations = useMemo(
    () => openConfirmations.slice(0, limit ?? openConfirmations.length),
    [limit, openConfirmations]
  );

  if (!openConfirmations.length) {
    return (
      <div className={`confirmation-empty${compact ? " confirmation-empty--compact" : ""}`} data-testid="notification-center-empty">
        <Icon name="check" size={18} />
        <span>{copy(locale, "confirmation", "empty")}</span>
      </div>
    );
  }

  return (
    <div className={`confirmation-list${compact ? " confirmation-list--compact" : ""}`} data-testid="notification-center-list">
      {visibleConfirmations.map((request) => {
        const entry = data.entries.find((item) => item.id === request.careEntryId) ?? request.entry;
        const note = confirmationNotes[request.id] ?? "";
        const partialDraft = partialDrafts[request.id] ?? defaultPartialDraft(entry);
        const updatePartialDraft = (patch: Partial<PartialConfirmationDraft>) =>
          setPartialDrafts((current) => ({
            ...current,
            [request.id]: { ...partialDraft, ...patch }
          }));
        const reminderInfo = request.nextReminderAt
          ? formatDate(request.nextReminderAt.slice(0, 10), intlLocale)
          : request.reminderCount > 0
            ? String(request.reminderCount)
            : "";

        return (
          <article className={`confirmation-card${compact ? " confirmation-card--compact" : ""}`} key={request.id} data-testid="confirmation-card">
            <div className="confirmation-card__head">
              <button
                className="button button--quiet confirmation-card__link"
                type="button"
                onClick={() => onOpenEntry(entry)}
              >
                <Icon name="calendar" size={16} />
                {copy(locale, "confirmation", "dueYesterday")}
              </button>
              <small>{formatDate(entry.endDateTime.slice(0, 10), intlLocale)}</small>
            </div>
            {reminderInfo ? (
              <small className="confirmation-card__meta">
                {request.nextReminderAt
                  ? copy(locale, "confirmation", "nextReminder", { date: reminderInfo })
                  : copy(locale, "confirmation", "reminderCount", { count: reminderInfo })}
              </small>
            ) : null}
            <textarea
              rows={compact ? 1 : 2}
              value={note}
              placeholder={copy(locale, "confirmation", "notePlaceholder")}
              onChange={(event) => setConfirmationNotes((current) => ({ ...current, [request.id]: event.target.value }))}
            />
            <details className="confirmation-card__partial">
              <summary>{copy(locale, "confirmation", "partialDetails")}</summary>
              <fieldset className="inline-fieldset">
                <legend>{copy(locale, "confirmation", "actualChildren")}</legend>
                <div className="child-choice-grid">
                  {entry.childIds.map((childId) => {
                    const child = data.children.find((item) => item.id === childId);
                    const checked = partialDraft.actualChildIds.includes(childId);
                    return (
                      <label className={`choice-card ${checked ? "choice-card--selected" : ""}`} key={childId}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            updatePartialDraft({
                              actualChildIds: checked
                                ? partialDraft.actualChildIds.filter((id) => id !== childId)
                                : [...partialDraft.actualChildIds, childId]
                            })
                          }
                        />
                        {child ? <span className="child-dot" style={{ backgroundColor: child.color }} /> : null}
                        {child?.name ?? childId}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <div className="form-grid form-grid--two">
                <label className="field">
                  <span>{copy(locale, "confirmation", "actualStart")}</span>
                  <input type="date" value={partialDraft.startDate} onChange={(event) => updatePartialDraft({ startDate: event.target.value })} />
                </label>
                <label className="field">
                  <span>{copy(locale, "confirmation", "actualStartTime")}</span>
                  <input type="time" value={partialDraft.startTime} onChange={(event) => updatePartialDraft({ startTime: event.target.value })} />
                </label>
                <label className="field">
                  <span>{copy(locale, "confirmation", "actualEnd")}</span>
                  <input type="date" value={partialDraft.endDate} onChange={(event) => updatePartialDraft({ endDate: event.target.value })} />
                </label>
                <label className="field">
                  <span>{copy(locale, "confirmation", "actualEndTime")}</span>
                  <input type="time" value={partialDraft.endTime} onChange={(event) => updatePartialDraft({ endTime: event.target.value })} />
                </label>
              </div>
              {data.careParties.length ? (
                <label className="field">
                  <span>{copy(locale, "confirmation", "actualCareParty")}</span>
                  <select value={partialDraft.actualResponsiblePartyId} onChange={(event) => updatePartialDraft({ actualResponsiblePartyId: event.target.value })}>
                    {data.careParties.map((party) => (
                      <option key={party.id} value={party.id}>{party.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </details>
            <div className="confirmation-actions">
              <button className="button button--primary" type="button" disabled={!canWrite || isSaving} onClick={() => void answerCareConfirmation(request.id, "completed", note)}>
                {copy(locale, "confirmation", "completed")}
              </button>
              <button
                className="button button--secondary"
                type="button"
                disabled={!canWrite || isSaving || partialDraft.actualChildIds.length === 0}
                onClick={() => void answerCareConfirmation(request.id, "partial", {
                  note,
                  actualChildIds: partialDraft.actualChildIds,
                  actualStartDateTime: `${partialDraft.startDate}T${partialDraft.startTime}`,
                  actualEndDateTime: `${partialDraft.endDate}T${partialDraft.endTime}`,
                  actualResponsiblePartyId: partialDraft.actualResponsiblePartyId || undefined
                })}
              >
                {copy(locale, "confirmation", "partial")}
              </button>
              <button className="button button--danger-quiet" type="button" disabled={!canWrite || isSaving} onClick={() => void answerCareConfirmation(request.id, "cancelled", note || copy(locale, "confirmation", "cancelled"))}>
                {copy(locale, "confirmation", "cancelled")}
              </button>
              <button className="button button--quiet" type="button" disabled={!canWrite || isSaving} onClick={() => void remindCareConfirmationLater(request.id)}>
                {copy(locale, "confirmation", "remindLater")}
              </button>
            </div>
          </article>
        );
      })}
      {limit && openConfirmations.length > limit ? (
        <p className="confirmation-center__more">
          {copy(locale, "confirmation", "moreOpen", { count: openConfirmations.length - limit })}
        </p>
      ) : null}
    </div>
  );
}
