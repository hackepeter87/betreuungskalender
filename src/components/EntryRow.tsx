import { formatDate, formatTime } from "../lib/date";
import { locationLabels, statusLabels } from "../lib/labels";
import type { CareEntry, Child } from "../types";
import { Icon } from "./Icon";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";

export function EntryRow({
  entry,
  children,
  onClick
}: {
  entry: CareEntry;
  children: Child[];
  onClick: () => void;
}) {
  const { locale, intlLocale } = useI18n();
  const childMap = new Map(children.map((child) => [child.id, child]));
  const selectedChildren = entry.childIds
    .map((id) => childMap.get(id))
    .filter((child): child is Child => Boolean(child));
  const activeTrips = entry.trips.filter((trip) => !trip.deletedAt);

  return (
    <button className="entry-row" type="button" onClick={onClick}>
      <span className={`status-rail status-rail--${entry.status}`} />
      <span className="entry-row__date">
        <strong>{formatDate(entry.startDateTime, intlLocale)}</strong>
        <small>{formatTime(entry.startDateTime, intlLocale)}–{formatTime(entry.endDateTime, intlLocale)}</small>
      </span>
      <span className="entry-row__children">
        <span className="child-dots">
          {selectedChildren.map((child) => (
            <span key={child.id} className="child-dot" style={{ backgroundColor: child.color }} />
          ))}
        </span>
        <span>
          <strong>{selectedChildren.map((child) => child.name).join(locale === "en" ? " and " : " und ") || copy(locale, "common", "unknownChild")}</strong>
          <small>{locationLabels[entry.location]}</small>
        </span>
      </span>
      <span className="entry-row__flags">
        {entry.overnight ? <span><Icon name="moon" size={15} /> {copy(locale, "agenda", "overnight")}</span> : null}
        {entry.schoolHandover ? <span><Icon name="check" size={15} /> {copy(locale, "app", "school")}</span> : null}
        {entry.additionalCare ? <span><Icon name="plus" size={15} /> {copy(locale, "agenda", "additionalCare")}</span> : null}
        {activeTrips.length ? <span><Icon name="car" size={15} /> {activeTrips.reduce((sum, trip) => sum + trip.km, 0).toFixed(1)} km</span> : null}
      </span>
      <span className={`status-label status-label--${entry.status}`}>{statusLabels[entry.status]}</span>
      <Icon name="chevronRight" size={17} className="entry-row__chevron" />
    </button>
  );
}
