import { addMonths, formatMonth, toMonthKey } from "../lib/date";
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
  const currentMonth = toMonthKey(new Date());
  return (
    <div
      className="month-toolbar"
      role="group"
      aria-label={copy(locale, "monthToolbar", "label")}
      data-testid="month-toolbar"
    >
      <button
        className="button button--quiet month-toolbar__today"
        type="button"
        data-testid="month-toolbar-today"
        onClick={() => onChange(currentMonth)}
        disabled={monthKey === currentMonth}
      >
        {copy(locale, "common", "today")}
      </button>
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
          data-testid="month-picker"
          type="month"
          value={monthKey}
          onChange={(event) => onChange(event.target.value)}
          aria-label={copy(locale, "monthToolbar", "choose")}
        />
      </label>
      <button
        className="icon-button icon-button--bordered"
        type="button"
        onClick={() => onChange(addMonths(monthKey, 1))}
        aria-label={copy(locale, "monthToolbar", "next")}
      >
        <Icon name="chevronRight" />
      </button>
    </div>
  );
}
