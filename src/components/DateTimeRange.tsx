import { formatDateTimeRange } from "../../shared/temporal";
import { useI18n } from "../i18n/I18nProvider";

export function DateTimeRange({
  startDateTime,
  endDateTime,
  className = ""
}: {
  startDateTime: string;
  endDateTime: string;
  className?: string;
}) {
  const { intlLocale } = useI18n();
  const range = formatDateTimeRange(startDateTime, endDateTime, intlLocale);
  const label = range.sameDay ? `${range.start} · ${range.end}` : `${range.start} – ${range.end}`;

  return (
    <span className={`date-time-range ${className}`.trim()} aria-label={label}>
      <span className="date-time-range__part">{range.start}</span>
      <span className="date-time-range__separator" aria-hidden="true">{range.sameDay ? " · " : " – "}</span>
      <span className="date-time-range__part">{range.end}</span>
    </span>
  );
}
