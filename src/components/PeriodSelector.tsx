import { formatDate, rangeForMonth, rangeForQuarter, rangeForYear } from "../lib/date";
import { FieldHelpLabel } from "./FieldHelp";

export type PeriodMode = "month" | "quarter" | "year" | "custom";

export interface PeriodSelection {
  mode: PeriodMode;
  anchorMonth: string;
  startDate: string;
  endDate: string;
}

export function periodSelection(
  mode: PeriodMode,
  anchorMonth: string,
  current?: Pick<PeriodSelection, "startDate" | "endDate">
): PeriodSelection {
  if (mode === "month") return { mode, anchorMonth, ...rangeForMonth(anchorMonth) };
  if (mode === "quarter") return { mode, anchorMonth, ...rangeForQuarter(anchorMonth) };
  if (mode === "year") {
    return { mode, anchorMonth, ...rangeForYear(Number(anchorMonth.slice(0, 4))) };
  }
  return {
    mode,
    anchorMonth,
    startDate: current?.startDate ?? `${anchorMonth}-01`,
    endDate: current?.endDate ?? rangeForMonth(anchorMonth).endDate
  };
}

export function PeriodSelector({
  value,
  onChange
}: {
  value: PeriodSelection;
  onChange: (value: PeriodSelection) => void;
}) {
  const setMode = (mode: PeriodMode) => {
    onChange(periodSelection(mode, value.anchorMonth, value));
  };

  const setAnchorMonth = (anchorMonth: string) => {
    onChange(periodSelection(value.mode, anchorMonth, value));
  };

  return (
    <section className="period-selector no-print" aria-label="Auswertungszeitraum">
      <div className="segmented-control period-selector__modes">
        <button type="button" className={value.mode === "month" ? "is-active" : ""} onClick={() => setMode("month")}>Monat</button>
        <button type="button" className={value.mode === "quarter" ? "is-active" : ""} onClick={() => setMode("quarter")}>Quartal</button>
        <button type="button" className={value.mode === "year" ? "is-active" : ""} onClick={() => setMode("year")}>Jahr</button>
        <button type="button" className={value.mode === "custom" ? "is-active" : ""} onClick={() => setMode("custom")}>Frei</button>
      </div>

      {value.mode !== "custom" ? (
        <label className="field period-selector__anchor">
          <FieldHelpLabel
            fieldId={value.mode === "year" ? "analytics.year" : value.mode === "quarter" ? "analytics.quarter" : "analytics.month"}
          >
            {value.mode === "year" ? "Bezugsjahr" : "Bezugsmonat"}
          </FieldHelpLabel>
          {value.mode === "year" ? (
            <input
              type="number"
              min="2000"
              max="2100"
              value={value.anchorMonth.slice(0, 4)}
              onChange={(event) => setAnchorMonth(`${event.target.value}-01`)}
            />
          ) : (
            <input
              type="month"
              value={value.anchorMonth}
              onChange={(event) => setAnchorMonth(event.target.value)}
            />
          )}
        </label>
      ) : (
        <div className="period-selector__custom">
          <label className="field">
            <FieldHelpLabel fieldId="analytics.startDate">Von</FieldHelpLabel>
            <input
              type="date"
              value={value.startDate}
              onChange={(event) =>
                onChange({ ...value, startDate: event.target.value })
              }
            />
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="analytics.endDate">Bis</FieldHelpLabel>
            <input
              type="date"
              value={value.endDate}
              onChange={(event) => onChange({ ...value, endDate: event.target.value })}
            />
          </label>
        </div>
      )}

      <p className="period-selector__result">
        {formatDate(value.startDate)} bis {formatDate(value.endDate)}
      </p>
    </section>
  );
}
