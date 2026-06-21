import { useMemo, useState, type FormEvent } from "react";
import { addDays, isWeekendDate, makeId, toDateKey } from "../lib/date";
import {
  costCategoryLabel,
  handoverLabel,
  locationLabel,
  paidByLabel,
  tripPurposeLabel
} from "../lib/labels";
import { useI18n } from "../i18n/I18nProvider";
import { copy } from "../i18n/catalog";
import { useAppStore } from "../store/AppStore";
import type {
  CareEntry,
  CareLocation,
  Cost,
  CostCategory,
  EntryStatus,
  HandoverParty,
  PaidBy,
  Trip,
  TripPurpose
} from "../types";
import { FieldHelpButton, FieldHelpLabel } from "./FieldHelp";
import { Icon } from "./Icon";

interface EntryFormProps {
  entry?: CareEntry;
  initialDate?: string;
  initialAdditionalCare?: boolean;
  onSaved: () => void;
  onCancel: () => void;
}

function dateTimeParts(value: string): { date: string; time: string } {
  if (value.endsWith("Z")) {
    const date = new Date(value);
    return {
      date: toDateKey(date),
      time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
    };
  }
  const [date, time = "00:00"] = value.split("T");
  return { date, time: time.slice(0, 5) };
}

const locationOptions: CareLocation[] = ["commuterApartment", "mainResidence", "mother", "school", "ogs", "other"];
const handoverOptions: HandoverParty[] = ["mother", "father", "school", "ogs", "thirdParty"];

function newTrip(): Trip {
  return {
    id: makeId("trip"),
    purpose: "pickup",
    km: 0,
    ownCar: true,
    reimbursed: false,
    notes: ""
  };
}

function newCost(): Cost {
  return {
    id: makeId("cost"),
    category: "food",
    amount: 0,
    paidBy: "father",
    notes: ""
  };
}

export function EntryForm({
  entry,
  initialDate,
  initialAdditionalCare,
  onSaved,
  onCancel
}: EntryFormProps) {
  const { locale } = useI18n();
  const { data, saveEntry, removeEntry, canWrite, isSaving } = useAppStore();
  const defaultDate = initialDate ?? toDateKey(new Date());
  const initialStart = entry
    ? dateTimeParts(entry.startDateTime)
    : { date: defaultDate, time: "15:00" };
  const initialEnd = entry
    ? dateTimeParts(entry.endDateTime)
    : { date: defaultDate, time: "19:00" };
  const [childIds, setChildIds] = useState<string[]>(entry?.childIds ?? []);
  const [status, setStatus] = useState<EntryStatus>(entry?.status ?? "completed");
  const [additionalCare, setAdditionalCare] = useState(
    entry?.additionalCare ?? initialAdditionalCare ?? false
  );
  const [startDate, setStartDate] = useState(initialStart.date);
  const [startTime, setStartTime] = useState(initialStart.time);
  const [endDate, setEndDate] = useState(initialEnd.date);
  const [endTime, setEndTime] = useState(initialEnd.time);
  const [overnight, setOvernight] = useState(entry?.overnight ?? false);
  const [schoolHandover, setSchoolHandover] = useState(entry?.schoolHandover ?? false);
  const [holiday, setHoliday] = useState(entry?.holiday ?? false);
  const [location, setLocation] = useState<CareLocation>(
    entry?.location ?? data.settings.defaultLocation
  );
  const [customLocation, setCustomLocation] = useState(entry?.customLocation ?? "");
  const [handoverFrom, setHandoverFrom] = useState<HandoverParty>(
    entry?.handoverFrom ?? data.settings.defaultHandoverFrom
  );
  const [handoverTo, setHandoverTo] = useState<HandoverParty>(
    entry?.handoverTo ?? data.settings.defaultHandoverTo
  );
  const [cancellationReason, setCancellationReason] = useState(
    entry?.cancellationReason ?? ""
  );
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [hasEvidence, setHasEvidence] = useState(entry?.hasEvidence ?? false);
  const [evidenceReference, setEvidenceReference] = useState(
    entry?.evidenceReference ?? ""
  );
  const [trips, setTrips] = useState<Trip[]>(
    entry?.trips.filter((trip) => !trip.deletedAt) ?? []
  );
  const [costs, setCosts] = useState<Cost[]>(
    entry?.costs.filter((cost) => !cost.deletedAt) ?? []
  );
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const startDateTime = `${startDate}T${startTime}`;
  const endDateTime = `${endDate}T${endTime}`;
  const selectedNames = useMemo(
    () =>
      data.children
        .filter((child) => childIds.includes(child.id))
        .map((child) => child.name),
    [childIds, data.children]
  );

  const toggleOvernight = (checked: boolean) => {
    setOvernight(checked);
    if (checked && endDate === startDate) {
      setEndDate(addDays(startDate, 1));
      setEndTime("07:30");
    }
  };

  const updateTrip = (id: string, patch: Partial<Trip>) => {
    setTrips((current) =>
      current.map((trip) => (trip.id === id ? { ...trip, ...patch } : trip))
    );
  };

  const updateCost = (id: string, patch: Partial<Cost>) => {
    setCosts((current) =>
      current.map((cost) => (cost.id === id ? { ...cost, ...patch } : cost))
    );
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const nextErrors: Record<string, string> = {};
    if (!childIds.length) {
      nextErrors.children = copy(locale, "entryForm", "childRequired");
    }
    if (new Date(endDateTime) <= new Date(startDateTime)) {
      nextErrors.endDateTime = copy(locale, "entryForm", "endAfterStart");
    }
    if (status === "cancelled" && !cancellationReason.trim()) {
      nextErrors.cancellationReason = copy(locale, "entryForm", "cancellationReasonRequired");
    }
    for (const trip of trips) {
      if (!Number.isFinite(trip.km) || trip.km <= 0) {
        nextErrors[`trip-${trip.id}`] = copy(locale, "entryForm", "kmPositive");
      }
    }
    for (const cost of costs) {
      if (!Number.isFinite(cost.amount) || cost.amount <= 0) {
        nextErrors[`cost-${cost.id}`] = copy(locale, "entryForm", "amountPositive");
      }
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setError(copy(locale, "entryForm", "fixFields"));
      return;
    }

    const saved = await saveEntry({
      id: entry?.id,
      date: startDate,
      startDateTime,
      endDateTime,
      childIds,
      status,
      additionalCare: entry?.generatedByPatternId ? false : additionalCare,
      generatedByPatternId: entry?.generatedByPatternId,
      ruleOccurrenceDate: entry?.ruleOccurrenceDate,
      overnight,
      schoolHandover,
      holiday,
      weekend: [startDate, endDate].some(isWeekendDate),
      location,
      customLocation: location === "other" ? customLocation.trim() : undefined,
      handoverFrom,
      handoverTo,
      cancellationReason:
        status === "cancelled" ? cancellationReason.trim() : undefined,
      notes: notes.trim() || undefined,
      hasEvidence,
      evidenceReference: hasEvidence ? evidenceReference.trim() || undefined : undefined,
      trips: trips.map((trip) => ({
        ...trip,
        reimbursementAmount: trip.reimbursed
          ? trip.reimbursementAmount
          : undefined,
        notes: trip.notes?.trim() || undefined
      })),
      costs: costs.map((cost) => ({
        ...cost,
        notes: cost.notes?.trim() || undefined
      }))
    });
    if (saved) onSaved();
  };

  const handleDelete = async () => {
    if (!entry) return;
    if (window.confirm(copy(locale, "entryForm", "deleteConfirm"))) {
      if (await removeEntry(entry.id)) onSaved();
    }
  };

  return (
    <form className="entry-form" data-testid="entry-form" onSubmit={handleSubmit}>
      {entry?.generatedByPatternId ? (
        <div className="notice">
          <Icon name="info" />
          <div>
            <strong>{copy(locale, "entryForm", "plannedRuleTitle")}</strong>
            <p>{copy(locale, "entryForm", "plannedRuleDescription")}</p>
          </div>
        </div>
      ) : null}

      {data.children.length === 0 ? (
        <div className="notice notice--warning">
          <Icon name="alert" />
          <div>
            <strong>{copy(locale, "entryForm", "noChildTitle")}</strong>
            <p>{copy(locale, "entryForm", "noChildDescription")}</p>
          </div>
        </div>
      ) : null}

      <fieldset className="form-section" aria-describedby={fieldErrors.children ? "children-error" : undefined}>
        <legend className="field-label-row">
          <span>{copy(locale, "entryForm", "children")} <span className="required-mark">*</span></span>
          <FieldHelpButton fieldId="careEntry.children" />
        </legend>
        <div className="child-choice-grid">
          {data.children.map((child) => {
            const checked = childIds.includes(child.id);
            return (
              <label
                className={`choice-card ${checked ? "choice-card--selected" : ""}`}
                key={child.id}
              >
                <input
                  data-testid="entry-child-option"
                  type="checkbox"
                  checked={checked}
                  aria-invalid={Boolean(fieldErrors.children)}
                  onChange={() =>
                    setChildIds((current) => {
                      setFieldErrors((errors) => ({ ...errors, children: "" }));
                      return checked
                        ? current.filter((id) => id !== child.id)
                        : [...current, child.id];
                    })
                  }
                />
                <span className="child-dot" style={{ backgroundColor: child.color }} />
                <span>{child.name}</span>
              </label>
            );
          })}
        </div>
        {fieldErrors.children ? <p className="field-error" id="children-error">{fieldErrors.children}</p> : null}
      </fieldset>

      <fieldset className="form-section">
        <legend className="field-label-row">
          <span>{copy(locale, "entryForm", "statusClassification")}</span>
          <FieldHelpButton fieldId="careEntry.status" />
        </legend>
        <div className="segmented-control segmented-control--three">
          {(
            [
              ["completed", copy(locale, "entryForm", "completed")],
              ["planned", copy(locale, "entryForm", "planned")],
              ["cancelled", copy(locale, "entryForm", "cancelled")]
            ] as Array<[EntryStatus, string]>
          ).map(([value, label]) => (
            <label key={value} className={status === value ? "is-active" : ""}>
              <input
                type="radio"
                name="status"
                value={value}
                checked={status === value}
                onChange={() => setStatus(value)}
              />
              {label}
            </label>
          ))}
        </div>
        {!entry?.generatedByPatternId ? (
          <label className="check-row">
            <input
              type="checkbox"
              checked={additionalCare}
              onChange={(event) => setAdditionalCare(event.target.checked)}
            />
            <FieldHelpLabel fieldId="careEntry.additionalCare">
              {copy(locale, "entryForm", "additionalCare")}
            </FieldHelpLabel>
          </label>
        ) : null}
      </fieldset>

      <details className="form-section form-section--collapsible" open>
        <summary className="form-section__summary">{copy(locale, "entryForm", "period")}</summary>
        <div className="datetime-grid">
          <label className="field">
            <FieldHelpLabel fieldId="careEntry.startDateTime">{copy(locale, "entryForm", "startDate")}</FieldHelpLabel>
            <input data-testid="entry-start-date" type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="careEntry.startDateTime">{copy(locale, "entryForm", "startTime")}</FieldHelpLabel>
            <input data-testid="entry-start-time" type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} />
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="careEntry.endDateTime">{copy(locale, "entryForm", "endDate")}</FieldHelpLabel>
            <input
              type="date"
              data-testid="entry-end-date"
              required
              value={endDate}
              aria-invalid={Boolean(fieldErrors.endDateTime)}
              onChange={(event) => {
                setEndDate(event.target.value);
                setFieldErrors((errors) => ({ ...errors, endDateTime: "" }));
              }}
            />
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="careEntry.endDateTime">{copy(locale, "entryForm", "endTime")}</FieldHelpLabel>
            <input
              type="time"
              data-testid="entry-end-time"
              required
              value={endTime}
              aria-invalid={Boolean(fieldErrors.endDateTime)}
              onChange={(event) => {
                setEndTime(event.target.value);
                setFieldErrors((errors) => ({ ...errors, endDateTime: "" }));
              }}
            />
          </label>
        </div>
        {fieldErrors.endDateTime ? <p className="field-error">{fieldErrors.endDateTime}</p> : null}
        <div className="toggle-row">
          <label className="toggle">
            <input data-testid="entry-overnight" type="checkbox" checked={overnight} onChange={(event) => toggleOvernight(event.target.checked)} />
            <span />
            <FieldHelpLabel fieldId="careEntry.overnight">{copy(locale, "entryForm", "overnight")}</FieldHelpLabel>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={schoolHandover} onChange={(event) => setSchoolHandover(event.target.checked)} />
            <span />
            <FieldHelpLabel fieldId="careEntry.schoolHandover">{copy(locale, "entryForm", "schoolHandover")}</FieldHelpLabel>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={holiday} onChange={(event) => setHoliday(event.target.checked)} />
            <span />
            <FieldHelpLabel fieldId="careEntry.holiday">{copy(locale, "entryForm", "holiday")}</FieldHelpLabel>
          </label>
        </div>
      </details>

      <details className="form-section form-section--collapsible" open>
        <summary className="form-section__summary">{copy(locale, "entryForm", "locationHandover")}</summary>
        <div className="form-grid">
          <label className="field">
            <FieldHelpLabel fieldId="careEntry.location" />
            <select value={location} onChange={(event) => setLocation(event.target.value as CareLocation)}>
              {locationOptions.map((value) => <option key={value} value={value}>{locationLabel(value, locale)}</option>)}
            </select>
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="careEntry.handoverFrom" />
            <select value={handoverFrom} onChange={(event) => setHandoverFrom(event.target.value as HandoverParty)}>
              {handoverOptions.map((value) => <option key={value} value={value}>{handoverLabel(value, locale)}</option>)}
            </select>
          </label>
          <label className="field">
            <FieldHelpLabel fieldId="careEntry.handoverTo" />
            <select value={handoverTo} onChange={(event) => setHandoverTo(event.target.value as HandoverParty)}>
              {handoverOptions.map((value) => <option key={value} value={value}>{handoverLabel(value, locale)}</option>)}
            </select>
          </label>
          {location === "other" ? (
            <label className="field">
              <FieldHelpLabel fieldId="careEntry.customLocation" />
              <input value={customLocation} onChange={(event) => setCustomLocation(event.target.value)} placeholder={copy(locale, "entryForm", "customLocation")} />
            </label>
          ) : null}
        </div>
      </details>

      {status === "cancelled" ? (
        <div className="form-section">
          <label className="field">
            <FieldHelpLabel fieldId="careEntry.cancellationReason" />
            <textarea
              required
              rows={2}
              value={cancellationReason}
              aria-invalid={Boolean(fieldErrors.cancellationReason)}
              onChange={(event) => {
                setCancellationReason(event.target.value);
                setFieldErrors((errors) => ({ ...errors, cancellationReason: "" }));
              }}
            />
            {fieldErrors.cancellationReason ? <span className="field-error">{fieldErrors.cancellationReason}</span> : null}
          </label>
        </div>
      ) : null}

      <details className="form-section form-section--collapsible">
        <summary className="form-section__summary" data-testid="entry-trips-toggle">{copy(locale, "entryForm", "trips")} <span>{trips.length || ""}</span></summary>
        <div className="subsection-heading">
          <div>
            <p>{copy(locale, "entryForm", "tripsDescription")}</p>
          </div>
          <button className="button button--secondary" data-testid="entry-trip-add" type="button" onClick={() => setTrips((current) => [...current, newTrip()])}>
            <Icon name="plus" size={16} />
            {copy(locale, "entryForm", "addTrip")}
          </button>
        </div>
        <div className="line-item-list">
          {trips.map((trip, index) => (
            <div className="line-item" data-testid="entry-trip-item" key={trip.id}>
              <div className="line-item__heading">
                <strong>{copy(locale, "entryForm", "trip", { index: index + 1 })}</strong>
                <button className="icon-button icon-button--danger" type="button" onClick={() => setTrips((current) => current.filter((item) => item.id !== trip.id))} aria-label={copy(locale, "entryForm", "deleteTrip", { index: index + 1 })}>
                  <Icon name="trash" size={16} />
                </button>
              </div>
              <div className="line-item-grid">
                <label className="field">
                  <FieldHelpLabel fieldId="trip.purpose" />
                  <select value={trip.purpose} onChange={(event) => updateTrip(trip.id, { purpose: event.target.value as TripPurpose })}>
                    {(["pickup", "return", "school", "doctor", "leisure", "workplace", "other"] as TripPurpose[]).map((value) => <option key={value} value={value}>{tripPurposeLabel(value, locale)}</option>)}
                  </select>
                </label>
                <label className="field">
                  <FieldHelpLabel fieldId="trip.km" />
                  <input
                    className={trip.km <= 0 ? "input--warning" : ""}
                    type="number"
                    data-testid="entry-trip-km"
                    min="0.1"
                    step="0.1"
                    inputMode="decimal"
                    value={trip.km || ""}
                    aria-invalid={Boolean(fieldErrors[`trip-${trip.id}`])}
                    onChange={(event) => {
                      updateTrip(trip.id, { km: Number(event.target.value) });
                      setFieldErrors((errors) => ({ ...errors, [`trip-${trip.id}`]: "" }));
                    }}
                    placeholder={locale === "en" ? "0.0" : "0,0"}
                  />
                  {fieldErrors[`trip-${trip.id}`] ? <span className="field-error">{fieldErrors[`trip-${trip.id}`]}</span> : null}
                </label>
                <label className="check-row line-item__check">
                  <input type="checkbox" checked={trip.ownCar} onChange={(event) => updateTrip(trip.id, { ownCar: event.target.checked })} />
                  <FieldHelpLabel fieldId="trip.ownCar" />
                </label>
                <label className="check-row line-item__check">
                  <input type="checkbox" checked={trip.reimbursed} onChange={(event) => updateTrip(trip.id, { reimbursed: event.target.checked })} />
                  <FieldHelpLabel fieldId="trip.reimbursed" />
                </label>
                {trip.reimbursed ? (
                  <label className="field">
                    <FieldHelpLabel fieldId="trip.reimbursementAmount" />
                    <input type="number" min="0" step="0.01" value={trip.reimbursementAmount ?? ""} onChange={(event) => updateTrip(trip.id, { reimbursementAmount: Number(event.target.value) })} />
                  </label>
                ) : null}
                <label className="field line-item__note">
                  <FieldHelpLabel fieldId="trip.notes" />
                  <input value={trip.notes ?? ""} onChange={(event) => updateTrip(trip.id, { notes: event.target.value })} />
                </label>
              </div>
            </div>
          ))}
          {trips.length === 0 ? <p className="empty-copy">{copy(locale, "entryForm", "noTrips")}</p> : null}
        </div>
      </details>

      <details className="form-section form-section--collapsible">
        <summary className="form-section__summary" data-testid="entry-costs-toggle">{copy(locale, "entryForm", "costs")} <span>{costs.length || ""}</span></summary>
        <div className="subsection-heading">
          <div>
            <p>{copy(locale, "entryForm", "costsDescription")}</p>
          </div>
          <button className="button button--secondary" data-testid="entry-cost-add" type="button" onClick={() => setCosts((current) => [...current, newCost()])}>
            <Icon name="plus" size={16} />
            {copy(locale, "entryForm", "addCost")}
          </button>
        </div>
        <div className="line-item-list">
          {costs.map((cost, index) => (
            <div className="line-item" data-testid="entry-cost-item" key={cost.id}>
              <div className="line-item__heading">
                <strong>{copy(locale, "entryForm", "cost", { index: index + 1 })}</strong>
                <button className="icon-button icon-button--danger" type="button" onClick={() => setCosts((current) => current.filter((item) => item.id !== cost.id))} aria-label={copy(locale, "entryForm", "deleteCost", { index: index + 1 })}>
                  <Icon name="trash" size={16} />
                </button>
              </div>
              <div className="line-item-grid">
                <label className="field">
                  <FieldHelpLabel fieldId="cost.category" />
                  <select value={cost.category} onChange={(event) => updateCost(cost.id, { category: event.target.value as CostCategory })}>
                    {(["food", "leisure", "school", "clothing", "travel", "other"] as CostCategory[]).map((value) => <option key={value} value={value}>{costCategoryLabel(value, locale)}</option>)}
                  </select>
                </label>
                <label className="field">
                  <FieldHelpLabel fieldId="cost.amount">{copy(locale, "entryForm", "amountEur")}</FieldHelpLabel>
                  <input
                    className={cost.amount <= 0 ? "input--warning" : ""}
                    type="number"
                    data-testid="entry-cost-amount"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    value={cost.amount || ""}
                    aria-invalid={Boolean(fieldErrors[`cost-${cost.id}`])}
                    onChange={(event) => {
                      updateCost(cost.id, { amount: Number(event.target.value) });
                      setFieldErrors((errors) => ({ ...errors, [`cost-${cost.id}`]: "" }));
                    }}
                    placeholder={locale === "en" ? "0.00" : "0,00"}
                  />
                  {fieldErrors[`cost-${cost.id}`] ? <span className="field-error">{fieldErrors[`cost-${cost.id}`]}</span> : null}
                </label>
                <label className="field">
                  <FieldHelpLabel fieldId="cost.paidBy" />
                  <select value={cost.paidBy} onChange={(event) => updateCost(cost.id, { paidBy: event.target.value as PaidBy })}>
                    {(["father", "mother", "both", "thirdParty"] as PaidBy[]).map((value) => <option key={value} value={value}>{paidByLabel(value, locale)}</option>)}
                  </select>
                </label>
                <label className="field line-item__note">
                  <FieldHelpLabel fieldId="cost.notes" />
                  <input value={cost.notes ?? ""} onChange={(event) => updateCost(cost.id, { notes: event.target.value })} />
                </label>
              </div>
            </div>
          ))}
          {costs.length === 0 ? <p className="empty-copy">{copy(locale, "entryForm", "noCosts")}</p> : null}
        </div>
      </details>

      <details className="form-section form-section--collapsible">
        <summary className="form-section__summary" data-testid="entry-notes-toggle">{copy(locale, "entryForm", "notesEvidence")}</summary>
        <label className="field">
          <FieldHelpLabel fieldId="careEntry.notes">{copy(locale, "entryForm", "notesEvidence")}</FieldHelpLabel>
          <textarea
            rows={3}
            data-testid="entry-notes"
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={copy(locale, "entryForm", "notesPlaceholder")}
          />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={hasEvidence} onChange={(event) => setHasEvidence(event.target.checked)} />
          <FieldHelpLabel fieldId="careEntry.hasEvidence">
            {copy(locale, "entryForm", "evidenceAvailable")}
          </FieldHelpLabel>
        </label>
        {hasEvidence ? (
          <label className="field">
            <FieldHelpLabel fieldId="careEntry.evidenceReference" />
            <input value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} placeholder={copy(locale, "entryForm", "evidenceReferencePlaceholder")} />
          </label>
        ) : null}
      </details>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <footer className="form-actions">
        {entry ? (
          <button className="button button--danger-quiet" type="button" onClick={() => void handleDelete()} disabled={!canWrite || isSaving}>
            <Icon name="trash" size={17} />
            {copy(locale, "common", "delete")}
          </button>
        ) : <span />}
        <div className="form-actions__right">
          <button className="button button--secondary" type="button" onClick={onCancel}>{copy(locale, "common", "cancel")}</button>
          <button className="button button--primary" data-testid="entry-submit" type="submit" disabled={data.children.length === 0 || !canWrite || isSaving}>
            <Icon name="check" size={17} />
            {entry ? copy(locale, "entryForm", "saveChanges") : copy(locale, "entryForm", "saveEntry")}
          </button>
        </div>
      </footer>

      {selectedNames.length ? <p className="form-summary">{copy(locale, "entryForm", "entryFor", { names: selectedNames.join(locale === "en" ? " and " : " und ") })}</p> : null}
    </form>
  );
}
