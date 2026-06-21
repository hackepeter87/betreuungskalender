import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import {
  PeriodSelector,
  periodSelection,
  type PeriodSelection
} from "../components/PeriodSelector";
import { UnavailablePeriodForm } from "../components/UnavailablePeriodForm";
import { unavailablePeriodsForRange } from "../lib/analytics";
import { formatDate, formatTime, toMonthKey } from "../lib/date";
import { unavailableCategoryLabels } from "../lib/labels";
import { useAppStore } from "../store/AppStore";
import type { UnavailablePeriod } from "../types";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";

export function UnavailablePeriodsPage() {
  const { locale, intlLocale } = useI18n();
  const { data, removeUnavailablePeriod, canWrite } = useAppStore();
  const [selection, setSelection] = useState<PeriodSelection>(() =>
    periodSelection("year", toMonthKey(new Date()))
  );
  const [editing, setEditing] = useState<UnavailablePeriod | "new" | null>(null);
  const periods = useMemo(
    () =>
      unavailablePeriodsForRange(
        data.unavailablePeriods,
        selection.startDate,
        selection.endDate
      ).sort((a, b) => a.startDateTime.localeCompare(b.startDateTime)),
    [data.unavailablePeriods, selection.endDate, selection.startDate]
  );

  const remove = async (period: UnavailablePeriod) => {
    if (
      window.confirm(
        copy(locale, "unavailable", "deleteConfirm")
      )
    ) {
      await removeUnavailablePeriod(period.id);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="page-header__context">{copy(locale, "unavailable", "context")}</p>
          <h1>{copy(locale, "unavailable", "title")}</h1>
        </div>
        <button
          className="button button--primary"
          type="button"
          onClick={() => setEditing("new")}
          disabled={!canWrite}
        >
          <Icon name="plus" size={17} />
          {copy(locale, "unavailable", "add")}
        </button>
      </div>

      <PeriodSelector value={selection} onChange={setSelection} />

      <section className="summary-strip summary-strip--four">
        <div><small>{copy(locale, "unavailable", "periods")}</small><strong>{periods.length}</strong></div>
        <div><small>{copy(locale, "unavailable", "dutyRelated")}</small><strong>{periods.filter((item) => item.dutyRelated).length}</strong></div>
        <div><small>{copy(locale, "unavailable", "affectsContact")}</small><strong>{periods.filter((item) => item.affectsContact).length}</strong></div>
        <div><small>{copy(locale, "unavailable", "affectsHolidays")}</small><strong>{periods.filter((item) => item.affectsHolidays).length}</strong></div>
      </section>

      <section className="notice">
        <Icon name="info" />
        <div>
          <strong>{copy(locale, "unavailable", "neutralTitle")}</strong>
          <p>{copy(locale, "unavailable", "neutralDescription")}</p>
        </div>
      </section>

      <section className="panel unavailable-panel">
        <div className="panel__header">
          <div>
            <h2>{copy(locale, "unavailable", "recorded")}</h2>
            <p>{copy(locale, "unavailable", "recordedDescription")}</p>
          </div>
        </div>
        <div className="unavailable-list">
          {periods.map((period) => (
            <article className="unavailable-row" key={period.id}>
              <span className={`unavailable-row__type ${period.dutyRelated ? "is-duty" : ""}`}>
                <Icon name="briefcase" size={17} />
                {period.dutyRelated ? copy(locale, "unavailable", "dutyRelated") : copy(locale, "unavailable", "other")}
              </span>
              <span>
                <strong>{unavailableCategoryLabels[period.category]}</strong>
                <small>
                  {formatDate(period.startDateTime, intlLocale)} {formatTime(period.startDateTime, intlLocale)}
                  {` ${copy(locale, "common", "to")} `}
                  {formatDate(period.endDateTime, intlLocale)} {formatTime(period.endDateTime, intlLocale)}
                </small>
              </span>
              <span>
                <strong>
                  {[
                    period.affectsContact ? copy(locale, "unavailable", "affectsContact") : "",
                    period.affectsHolidays ? copy(locale, "unavailable", "holidayPlanning") : ""
                  ].filter(Boolean).join(" · ") || copy(locale, "unavailable", "noEffect")}
                </strong>
                <small>{period.location || period.notes || copy(locale, "common", "noAdditionalInformation")}</small>
              </span>
              <span className="unavailable-row__actions">
                <button
                  className="icon-button icon-button--bordered"
                  type="button"
                  onClick={() => setEditing(period)}
                  aria-label={copy(locale, "unavailable", "edit")}
                >
                  <Icon name="edit" size={16} />
                </button>
                <button
                  className="icon-button icon-button--bordered icon-button--danger"
                  type="button"
                  onClick={() => void remove(period)}
                  disabled={!canWrite}
                  aria-label={copy(locale, "unavailable", "delete")}
                >
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </article>
          ))}
          {periods.length === 0 ? (
            <p className="empty-copy empty-copy--padded">
              {copy(locale, "unavailable", "empty")}
            </p>
          ) : null}
        </div>
      </section>

      {editing ? (
        <Modal
          title={
            editing === "new"
              ? copy(locale, "unavailable", "createTitle")
              : copy(locale, "unavailable", "editTitle")
          }
          onClose={() => setEditing(null)}
        >
          <UnavailablePeriodForm
            period={editing === "new" ? undefined : editing}
            onDone={() => setEditing(null)}
          />
        </Modal>
      ) : null}
    </div>
  );
}
