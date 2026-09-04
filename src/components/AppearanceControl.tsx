import { useId } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { setAppearance, useAppearance } from "../lib/appearance";

export function AppearanceControl() {
  const { t } = useI18n();
  const preference = useAppearance();
  const labelId = useId();
  const options = [
    { value: "system", label: t("settings.appearance.system") },
    { value: "light", label: t("settings.appearance.light") },
    { value: "dark", label: t("settings.appearance.dark") }
  ] as const;
  return (
    <div className="field" data-testid="appearance-control">
      <span id={labelId} className="field-label-row">{t("settings.appearance.label")}</span>
      <div className="segmented-control segmented-control--three" role="group" aria-labelledby={labelId}>
        {options.map(({ value, label }) => (
          <button key={value} type="button" aria-pressed={preference === value}
            className={preference === value ? "is-active" : ""}
            onClick={() => setAppearance(value)}>{label}</button>
        ))}
      </div>
    </div>
  );
}
