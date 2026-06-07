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

export function UnavailablePeriodsPage() {
  const { data, removeUnavailablePeriod } = useAppStore();
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

  const remove = (period: UnavailablePeriod) => {
    if (
      window.confirm(
        "Nichtverfügbarkeit als gelöscht markieren? Die Änderung bleibt im Protokoll erhalten."
      )
    ) {
      removeUnavailablePeriod(period.id);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="page-header__context">Sachliche Abwesenheitsdokumentation</p>
          <h1>Nichtverfügbarkeiten</h1>
        </div>
        <button
          className="button button--primary"
          type="button"
          onClick={() => setEditing("new")}
        >
          <Icon name="plus" size={17} />
          Nichtverfügbarkeit erfassen
        </button>
      </div>

      <PeriodSelector value={selection} onChange={setSelection} />

      <section className="summary-strip summary-strip--four">
        <div><small>Zeiträume</small><strong>{periods.length}</strong></div>
        <div><small>Dienstlich</small><strong>{periods.filter((item) => item.dutyRelated).length}</strong></div>
        <div><small>Betrifft Umgang</small><strong>{periods.filter((item) => item.affectsContact).length}</strong></div>
        <div><small>Betrifft Ferien</small><strong>{periods.filter((item) => item.affectsHolidays).length}</strong></div>
      </section>

      <section className="notice">
        <Icon name="info" />
        <div>
          <strong>Neutrale Dokumentation</strong>
          <p>Dokumentierte Nichtverfügbarkeiten werden gesondert ausgewiesen und nicht automatisch als nicht wahrgenommene Betreuung bewertet.</p>
        </div>
      </section>

      <section className="panel unavailable-panel">
        <div className="panel__header">
          <div>
            <h2>Erfasste Zeiträume</h2>
            <p>Dienstliche und sonstige Abwesenheiten im gewählten Zeitraum</p>
          </div>
        </div>
        <div className="unavailable-list">
          {periods.map((period) => (
            <article className="unavailable-row" key={period.id}>
              <span className={`unavailable-row__type ${period.dutyRelated ? "is-duty" : ""}`}>
                <Icon name="briefcase" size={17} />
                {period.dutyRelated ? "Dienstlich" : "Sonstig"}
              </span>
              <span>
                <strong>{unavailableCategoryLabels[period.category]}</strong>
                <small>
                  {formatDate(period.startDateTime)} {formatTime(period.startDateTime)}
                  {" bis "}
                  {formatDate(period.endDateTime)} {formatTime(period.endDateTime)}
                </small>
              </span>
              <span>
                <strong>
                  {[
                    period.affectsContact ? "Umgang" : "",
                    period.affectsHolidays ? "Ferienplanung" : ""
                  ].filter(Boolean).join(" · ") || "Keine Auswirkung markiert"}
                </strong>
                <small>{period.location || period.notes || "Keine ergänzende Angabe"}</small>
              </span>
              <span className="unavailable-row__actions">
                <button
                  className="icon-button icon-button--bordered"
                  type="button"
                  onClick={() => setEditing(period)}
                  aria-label="Nichtverfügbarkeit bearbeiten"
                >
                  <Icon name="edit" size={16} />
                </button>
                <button
                  className="icon-button icon-button--bordered icon-button--danger"
                  type="button"
                  onClick={() => remove(period)}
                  aria-label="Nichtverfügbarkeit löschen"
                >
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </article>
          ))}
          {periods.length === 0 ? (
            <p className="empty-copy empty-copy--padded">
              Für den gewählten Zeitraum sind keine Nichtverfügbarkeiten dokumentiert.
            </p>
          ) : null}
        </div>
      </section>

      {editing ? (
        <Modal
          title={
            editing === "new"
              ? "Nichtverfügbarkeit erfassen"
              : "Nichtverfügbarkeit bearbeiten"
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
