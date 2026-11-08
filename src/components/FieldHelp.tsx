import { useCallback, useId, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  getFieldHelp,
  requirementLevelLabels,
  type FieldHelpId
} from "../config/fieldHelp";
import { useHelpPreferences } from "../context/HelpPreferences";
import { Icon } from "./Icon";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";
import { useDialogFocus } from "../hooks/useDialogFocus";

function stopLabelToggle(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

export function FieldHelpButton({
  fieldId,
  showRequirement = false,
  alwaysVisible = false
}: {
  fieldId: FieldHelpId;
  showRequirement?: boolean;
  alwaysVisible?: boolean;
}) {
  const { locale } = useI18n();
  const { helpIconsVisible } = useHelpPreferences();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>();
  const titleId = useId();
  const help = getFieldHelp(fieldId);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeHelp = useCallback(() => setOpen(false), []);
  const dialogRef = useDialogFocus<HTMLElement>(closeHelp, open, triggerRef);

  if (!alwaysVisible && !helpIconsVisible) return null;

  return (
    <>
      <span className="field-help-trigger">
        {showRequirement ? (
          <span
            className={`requirement-badge requirement-badge--${help.requirementLevel}`}
          >
            {requirementLevelLabels[help.requirementLevel]}
          </span>
        ) : null}
        <button
          ref={triggerRef}
          className="field-help-button"
          type="button"
          aria-label={copy(locale, "fieldHelp", "helpFor", { label: help.label })}
          aria-haspopup="dialog"
          aria-expanded={open}
          onMouseDown={stopLabelToggle}
          onClick={(event) => {
            stopLabelToggle(event);
            event.currentTarget.focus();
            if (window.innerWidth >= 768) {
              const rect = event.currentTarget.getBoundingClientRect();
              const width = Math.min(420, window.innerWidth - 24);
              const estimatedHeight = 300;
              const top = rect.bottom + 8 + estimatedHeight <= window.innerHeight
                ? rect.bottom + 8
                : Math.max(12, rect.top - estimatedHeight - 8);
              setPosition({
                left: Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width)),
                top,
                maxHeight: window.innerHeight - top - 12,
                width
              });
            } else {
              setPosition(undefined);
            }
            setOpen(true);
          }}
        >
          <span className="field-help-button__visual"><Icon name="info" size={16} /></span>
        </button>
      </span>

      {open
        ? createPortal(
            <div
              className="field-help-backdrop"
              role="presentation"
              onMouseDown={closeHelp}
            >
              <section
                ref={dialogRef}
                className="field-help-dialog"
                style={position}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header className="field-help-dialog__header">
                  <div>
                    <span
                      className={`requirement-badge requirement-badge--${help.requirementLevel}`}
                    >
                      {requirementLevelLabels[help.requirementLevel]}
                    </span>
                    <h2 id={titleId}>{help.label}</h2>
                  </div>
                  <button
                    className="icon-button icon-button--bordered"
                    type="button"
                    onClick={closeHelp}
                    aria-label={copy(locale, "fieldHelp", "close")}
                    autoFocus
                  >
                    <Icon name="close" size={18} />
                  </button>
                </header>

                <p className="field-help-dialog__summary">{help.shortHelp}</p>

                {help.inputGuidance !== help.shortHelp ? (
                  <p className="field-help-dialog__guidance">{help.inputGuidance}</p>
                ) : null}
                {help.commonMistakes?.length ? (
                  <ul className="field-help-dialog__points">
                    {help.commonMistakes.map((mistake) => <li key={mistake}>{mistake}</li>)}
                  </ul>
                ) : null}
                {help.examples?.length ? (
                  <p className="field-help-dialog__example">
                    <strong>{copy(locale, "fieldHelp", "example")}:</strong> {help.examples.join(" · ")}
                  </p>
                ) : null}
              </section>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

export function FieldHelpLabel({
  fieldId,
  children
}: {
  fieldId: FieldHelpId;
  children?: ReactNode;
}) {
  const help = getFieldHelp(fieldId);
  return (
    <span className="field-label-row">
      <span>
        {children ?? help.label}
        {help.requirementLevel === "required" ? (
          <>
            <span className="required-mark" aria-hidden="true"> *</span>
            <span className="sr-only"> {requirementLevelLabels.required}</span>
          </>
        ) : null}
      </span>
      <FieldHelpButton fieldId={fieldId} />
    </span>
  );
}
