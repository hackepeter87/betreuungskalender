import { useI18n } from "../i18n/I18nProvider";
import { catalogKey, copy } from "../i18n/catalog";
import { conflictSeverityForEntry } from "../lib/careConflictPresentation";
import type { CareConflict } from "../types";
import { Icon } from "./Icon";

export function CareConflictIndicator({
  conflicts,
  entryId,
  canWrite,
  compact = false
}: {
  conflicts: CareConflict[];
  entryId: string;
  canWrite: boolean;
  compact?: boolean;
}) {
  const { locale } = useI18n();
  const severity = conflictSeverityForEntry(conflicts, entryId);
  if (!severity) return null;

  const label = copy(
    locale,
    "careConflict",
    catalogKey("careConflict", severity === "unresolved_actual" ? "unresolvedActual" : "plannedWarning")
  );
  const guidance = copy(
    locale,
    "careConflict",
    catalogKey("careConflict", canWrite ? "openToReview" : "readOnly")
  );

  return (
    <span
      className={`care-conflict care-conflict--${severity}${compact ? " care-conflict--compact" : ""}`}
      data-testid={`care-conflict-${entryId}`}
      title={`${label}. ${guidance}`}
    >
      <Icon name="alert" size={compact ? 13 : 15} />
      <span>{label}</span>
      {!compact ? <small>{guidance}</small> : null}
    </span>
  );
}
