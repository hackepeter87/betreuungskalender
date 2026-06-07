import { addMonths, formatMonth, toMonthKey } from "../lib/date";
import { FieldHelpButton } from "./FieldHelp";
import { Icon } from "./Icon";

export function MonthToolbar({
  monthKey,
  onChange
}: {
  monthKey: string;
  onChange: (monthKey: string) => void;
}) {
  return (
    <div className="month-toolbar" aria-label="Monatsauswahl">
      <button
        className="icon-button icon-button--bordered"
        type="button"
        onClick={() => onChange(addMonths(monthKey, -1))}
        aria-label="Vorheriger Monat"
      >
        <Icon name="chevronLeft" />
      </button>
      <label className="month-toolbar__picker">
        <span>{formatMonth(monthKey)}</span>
        <input
          type="month"
          value={monthKey}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Monat auswählen"
        />
      </label>
      <FieldHelpButton fieldId="analytics.month" showRequirement={false} />
      <button
        className="icon-button icon-button--bordered"
        type="button"
        onClick={() => onChange(addMonths(monthKey, 1))}
        aria-label="Nächster Monat"
      >
        <Icon name="chevronRight" />
      </button>
      {monthKey !== toMonthKey(new Date()) ? (
        <button className="button button--quiet month-toolbar__today" type="button" onClick={() => onChange(toMonthKey(new Date()))}>
          Heute
        </button>
      ) : null}
    </div>
  );
}
