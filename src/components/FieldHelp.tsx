import { useCallback, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
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
            setOpen(true);
          }}
        >
          <Icon name="info" size={16} />
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

                <dl className="field-help-details">
                  <div>
                    <dt>{copy(locale, "fieldHelp", "why")}</dt>
                    <dd>{help.whyRelevant}</dd>
                  </div>
                  <div>
                    <dt>{copy(locale, "fieldHelp", "usage")}</dt>
                    <dd>{help.usedFor}</dd>
                  </div>
                  <div>
                    <dt>{copy(locale, "fieldHelp", "guidance")}</dt>
                    <dd>{help.inputGuidance}</dd>
                  </div>
                  {help.commonMistakes?.length ? (
                    <div>
                      <dt>{copy(locale, "fieldHelp", "mistakes")}</dt>
                      <dd>
                        <ul>
                          {help.commonMistakes.map((mistake) => (
                            <li key={mistake}>{mistake}</li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  ) : null}
                  {help.examples?.length ? (
                    <div>
                      <dt>{copy(locale, "fieldHelp", "example")}</dt>
                      <dd>{help.examples.join(" · ")}</dd>
                    </div>
                  ) : null}
                  {help.relatedReportSection ? (
                    <div>
                      <dt>{copy(locale, "fieldHelp", "reportLink")}</dt>
                      <dd>{help.relatedReportSection}</dd>
                    </div>
                  ) : null}
                </dl>

                <p className="field-help-dialog__notice">
                  {copy(locale, "fieldHelp", "notice")}
                </p>
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
