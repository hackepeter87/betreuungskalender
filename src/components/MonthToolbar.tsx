import { addMonths, formatMonth, toMonthKey } from "../lib/date";
import { FieldHelpButton } from "./FieldHelp";
import { Icon } from "./Icon";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";

export function MonthToolbar({
  monthKey,
  onChange
}: {
  monthKey: string;
  onChange: (monthKey: string) => void;
}) {
  const { locale, intlLocale } = useI18n();
  return (
    <div className="month-toolbar" aria-label={copy(locale, "monthToolbar", "label")}>
      <button
        className="icon-button icon-button--bordered"
        type="button"
        onClick={() => onChange(addMonths(monthKey, -1))}
        aria-label={copy(locale, "monthToolbar", "previous")}
      >
        <Icon name="chevronLeft" />
      </button>
      <label className="month-toolbar__picker">
        <span>{formatMonth(monthKey, intlLocale)}</span>
        <input
          type="month"
          value={monthKey}
          onChange={(event) => onChange(event.target.value)}
          aria-label={copy(locale, "monthToolbar", "choose")}
        />
      </label>
      <FieldHelpButton fieldId="analytics.month" showRequirement={false} />
      <button
        className="icon-button icon-button--bordered"
        type="button"
        onClick={() => onChange(addMonths(monthKey, 1))}
        aria-label={copy(locale, "monthToolbar", "next")}
      >
        <Icon name="chevronRight" />
      </button>
      {monthKey !== toMonthKey(new Date()) ? (
        <button className="button button--quiet month-toolbar__today" type="button" onClick={() => onChange(toMonthKey(new Date()))}>
          {copy(locale, "common", "today")}
        </button>
      ) : null}
    </div>
  );
}
