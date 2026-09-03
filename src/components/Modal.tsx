import { type ReactNode } from "react";
import { Icon } from "./Icon";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";
import { useDialogFocus } from "../hooks/useDialogFocus";

export function Modal({
  title,
  children,
  onClose,
  size = "medium",
  className
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  size?: "medium" | "large";
  className?: string;
}) {
  const { locale } = useI18n();
  const dialogRef = useDialogFocus<HTMLElement>(onClose);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className={["modal", `modal--${size}`, className].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label={copy(locale, "common", "cancel")}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
      </section>
    </div>
  );
}
