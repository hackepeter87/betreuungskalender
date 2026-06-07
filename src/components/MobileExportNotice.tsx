import { Icon } from "./Icon";

export function MobileExportNotice() {
  return (
    <div className="mobile-export-notice">
      <Icon name="info" size={17} />
      <p>
        Auf iPhone und iPad öffnet Safari Dateien je nach Format zunächst in einer
        Vorschau. Nutze anschließend „Teilen“ und „In Dateien sichern“.
      </p>
    </div>
  );
}
