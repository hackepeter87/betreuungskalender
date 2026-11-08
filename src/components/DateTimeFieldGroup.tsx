import type { InputHTMLAttributes } from "react";
import type { FieldHelpId } from "../config/fieldHelp";
import { FieldHelpButton } from "./FieldHelp";

type DateTimeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  "data-testid"?: string;
};

function RequiredLabel({ children, required }: { children: string; required: boolean }) {
  return (
    <span>
      {children}
      {required ? <span className="required-mark" aria-hidden="true"> *</span> : null}
    </span>
  );
}

export function DateTimeFieldGroup({
  groupLabel,
  dateLabel,
  timeLabel,
  dateInput,
  timeInput,
  helpId
}: {
  groupLabel: string;
  dateLabel: string;
  timeLabel: string;
  dateInput: DateTimeInputProps;
  timeInput: DateTimeInputProps;
  helpId?: FieldHelpId;
}) {
  return (
    <fieldset className="date-time-field-group">
      <legend className="field-label-row">
        <span>{groupLabel}</span>
        {helpId ? <FieldHelpButton fieldId={helpId} /> : null}
      </legend>
      <div className="date-time-field-group__fields">
        <label className="field">
          <RequiredLabel required={Boolean(dateInput.required)}>{dateLabel}</RequiredLabel>
          <input {...dateInput} type="date" />
        </label>
        <label className="field">
          <RequiredLabel required={Boolean(timeInput.required)}>{timeLabel}</RequiredLabel>
          <input {...timeInput} type="time" />
        </label>
      </div>
    </fieldset>
  );
}
