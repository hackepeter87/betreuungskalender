import { Icon } from "./Icon";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";

export function MobileExportNotice() {
  const { locale } = useI18n();
  return (
    <div className="mobile-export-notice">
      <Icon name="info" size={17} />
      <p>
        {copy(locale, "mobileExport", "notice")}
      </p>
    </div>
  );
}
