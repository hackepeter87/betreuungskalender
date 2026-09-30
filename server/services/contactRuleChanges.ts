import { createHash } from "node:crypto";
import type {
  ApiContactRule,
  ApiContactRuleChangeApplyRequest,
  ApiContactRuleChangePreview,
  ApiContactRuleChangeRequest,
  ApiContactRuleWritable
} from "../../shared/api.js";
import { omitUndefinedValues } from "../../shared/objects.js";
import { expandContactRule, type ExpandedContactRuleEntry } from "../../shared/contactRuleExpansion.js";
import type { DatabaseExecutor } from "../db/runtime.js";
import {
  detectCareConflicts,
  listCareConflictEntries,
  previewPlannedCareConflicts
} from "./careConflicts.js";
import { retireOpenCareConfirmationRequests } from "./careConfirmations.js";
import { makeId, nowIso } from "./common.js";
import {
  markDomainClosedMonthsChanged,
  recordDomainAudit,
  syncPersistedChildJunction
} from "./domainPersistence.js";
import { getContactRule, syncContactRule, upsertContactRule } from "./contactRules.js";

const MAX_CHANGE_RECORDS = 5_000;

interface ChangeEntryRow {
  id: string;
  contact_rule_occurrence_key: string | null;
  contact_rule_sync_state: "generated" | "manual_override" | null;
  rule_occurrence_date: string | null;
  responsible_party_id: string | null;
  start_datetime: string;
  end_datetime: string;
  status: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ChangePlan {
  preview: ApiContactRuleChangePreview;
  rule: ApiContactRule;
  selected: ChangeEntryRow;
  proposedRule?: ApiContactRuleWritable;
  successorRuleId?: string;
  retireIds: string[];
}

export class ContactRuleChangePreviewChangedError extends Error {
  readonly code = "contact_rule_change_preview_changed";

  constructor() {
    super("The recurring-care change preview is no longer current.");
    this.name = "ContactRuleChangePreviewChangedError";
  }
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function addMonths(date: string, months: number): string {
  const [year = 0, month = 1] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1 + months, 1, 12));
  return value.toISOString().slice(0, 10);
}

function firstDayOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function ruleWindow(
  rule: Pick<ApiContactRuleWritable, "startDate" | "endDate" | "syncHorizonMonths">,
  now: string,
  minimumStart?: string
): { startDate: string; endDate: string } {
  const rollingStart = rule.startDate > firstDayOfMonth(now.slice(0, 10))
    ? rule.startDate
    : firstDayOfMonth(now.slice(0, 10));
  const startDate = minimumStart ?? (rule.endDate ? rule.startDate : rollingStart);
  const endDate = rule.endDate ?? addDays(addMonths(startDate, rule.syncHorizonMonths), -1);
  if (endDate < startDate || endDate >= addMonths(startDate, 36)) {
    throw new Error("invalid_contact_rule_change_window");
  }
  return { startDate, endDate };
}

function writableRule(rule: ApiContactRule): ApiContactRuleWritable {
  return omitUndefinedValues({
    name: rule.name,
    startDate: rule.startDate,
    endDate: rule.endDate,
    timezone: "Europe/Berlin" as const,
    recurrence: rule.recurrence,
    segments: rule.segments,
    syncHorizonMonths: rule.syncHorizonMonths,
    responsiblePartyId: rule.responsiblePartyId,
    childIds: rule.childIds,
    active: rule.active
  });
}

function entryEvidence(row: ChangeEntryRow, childIds: string[] = []): Record<string, unknown> {
  return {
    id: row.id,
    occurrenceKey: row.contact_rule_occurrence_key,
    syncState: row.contact_rule_sync_state,
    status: row.status,
    startDateTime: row.start_datetime,
    endDateTime: row.end_datetime,
    responsiblePartyId: row.responsible_party_id,
    childIds: [...childIds].sort(),
    updatedAt: row.updated_at,
    deleted: Boolean(row.deleted_at)
  };
}

async function loadEntryChildren(
  database: DatabaseExecutor,
  entryIds: string[]
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for (let offset = 0; offset < entryIds.length; offset += 400) {
    const ids = entryIds.slice(offset, offset + 400);
    if (!ids.length) continue;
    const rows = await database.selectFrom("care_entry_children")
      .select(["care_entry_id", "child_id"])
      .where("care_entry_id", "in", ids)
      .where("deleted_at", "is", null)
      .orderBy("care_entry_id")
      .orderBy("child_id")
      .execute();
    for (const row of rows) {
      const childIds = result.get(row.care_entry_id) ?? [];
      childIds.push(row.child_id);
      result.set(row.care_entry_id, childIds);
    }
  }
  return result;
}

async function loadSelectedEntry(
  database: DatabaseExecutor,
  ruleId: string,
  entryId: string
): Promise<ChangeEntryRow> {
  const row = await database.selectFrom("care_entries")
    .select([
      "id", "contact_rule_occurrence_key", "contact_rule_sync_state",
      "rule_occurrence_date", "responsible_party_id", "start_datetime", "end_datetime",
      "status", "updated_at", "deleted_at"
    ])
    .where("id", "=", entryId)
    .where("contact_rule_id", "=", ruleId)
    .where("deleted_at", "is", null)
    .executeTakeFirst() as ChangeEntryRow | undefined;
  if (!row) throw new Error("contact_rule_occurrence_not_found");
  if (!row.rule_occurrence_date) throw new Error("contact_rule_occurrence_not_generated");
  return row;
}

async function loadAffectedEntries(
  database: DatabaseExecutor,
  ruleId: string,
  startDate: string,
  endDate: string
): Promise<ChangeEntryRow[]> {
  const rows = await database.selectFrom("care_entries")
    .select([
      "id", "contact_rule_occurrence_key", "contact_rule_sync_state",
      "rule_occurrence_date", "responsible_party_id", "start_datetime", "end_datetime",
      "status", "updated_at", "deleted_at"
    ])
    .where("contact_rule_id", "=", ruleId)
    .where("start_datetime", "<", `${addDays(endDate, 1)}T00:00`)
    .where("end_datetime", ">", `${startDate}T00:00`)
    .orderBy("start_datetime")
    .orderBy("id")
    .limit(MAX_CHANGE_RECORDS + 1)
    .execute() as ChangeEntryRow[];
  if (rows.length > MAX_CHANGE_RECORDS) throw new Error("contact_rule_change_limit_exceeded");
  return rows;
}

function isProtected(row: ChangeEntryRow): boolean {
  return Boolean(row.deleted_at) || row.status !== "planned" || row.contact_rule_sync_state === "manual_override";
}

function expandedFor(
  rule: ApiContactRuleWritable,
  startDate: string,
  endDate: string
): ExpandedContactRuleEntry[] {
  return expandContactRule(omitUndefinedValues({
    ...rule,
    rangeStart: startDate,
    rangeEnd: endDate
  }));
}

async function conflictEvidence(input: {
  database: DatabaseExecutor;
  desired: ExpandedContactRuleEntry[];
  childIds: string[];
  replaceableIds: Set<string>;
  existingByKey: Map<string, ChangeEntryRow>;
}): Promise<{ conflicts: number; fingerprints: string[] }> {
  const candidates = input.desired.flatMap((occurrence, index) => {
    const existing = input.existingByKey.get(occurrence.occurrenceKey);
    return existing && isProtected(existing) ? [] : [{
      id: `contact-rule-change-preview:${index}`,
      status: "planned" as const,
      startDateTime: occurrence.startDateTime,
      endDateTime: occurrence.endDateTime,
      childIds: input.childIds
    }];
  });
  if (!candidates.length) return { conflicts: 0, fingerprints: [] };
  const startDateTime = candidates.reduce(
    (minimum, entry) => entry.startDateTime < minimum ? entry.startDateTime : minimum,
    candidates[0]?.startDateTime ?? ""
  );
  const endDateTime = candidates.reduce(
    (maximum, entry) => entry.endDateTime > maximum ? entry.endDateTime : maximum,
    candidates[0]?.endDateTime ?? ""
  );
  const external = (await listCareConflictEntries(input.database, {
    childIds: input.childIds,
    endAfter: startDateTime,
    startBefore: endDateTime,
    maxEntries: MAX_CHANGE_RECORDS,
    maxChildLinks: MAX_CHANGE_RECORDS * 4
  })).filter((entry) => !input.replaceableIds.has(entry.id));
  const candidateIds = new Set(candidates.map((entry) => entry.id));
  const conflicts = detectCareConflicts([...external, ...candidates], {
    maxConflicts: MAX_CHANGE_RECORDS
  }).filter((conflict) => conflict.entryIds.some((id) => candidateIds.has(id)));
  return {
    conflicts: conflicts.length,
    fingerprints: [createHash("sha256").update(JSON.stringify({ external, candidates, conflicts })).digest("hex")]
  };
}

async function buildPlan(
  ruleId: string,
  request: ApiContactRuleChangeRequest,
  database: DatabaseExecutor,
  now = nowIso()
): Promise<ChangePlan> {
  const rule = await getContactRule(ruleId, database);
  if (!rule) throw new Error("contact_rule_not_found");
  const selected = await loadSelectedEntry(database, ruleId, request.selectedEntryId);
  if (selected.status !== "planned" || selected.contact_rule_sync_state === "manual_override") {
    throw new Error("contact_rule_occurrence_protected");
  }
  const selectedDate = selected.rule_occurrence_date ?? selected.start_datetime.slice(0, 10);

  if (request.scope === "occurrence") {
    const selectedChildren = await loadEntryChildren(database, [selected.id]);
    const preview = await previewPlannedCareConflicts({
      status: "planned",
      startDateTime: request.proposedEntry.startDateTime,
      endDateTime: request.proposedEntry.endDateTime,
      childIds: request.proposedEntry.childIds
    }, database, selected.id);
    const startDate = request.proposedEntry.startDateTime.slice(0, 10);
    const endDate = request.proposedEntry.endDateTime.slice(0, 10);
    const fingerprint = createHash("sha256").update(JSON.stringify({
      ruleId,
      ruleUpdatedAt: rule.updatedAt,
      request,
      selected: entryEvidence(selected, selectedChildren.get(selected.id)),
      conflictFingerprint: preview.fingerprint
    })).digest("hex");
    return {
      rule,
      selected,
      retireIds: [],
      preview: {
        fingerprint,
        scope: request.scope,
        startDate,
        endDate,
        affected: 1,
        created: 0,
        retired: 0,
        preserved: 0,
        historical: 0,
        conflicts: preview.conflicts.length,
        warnings: preview.conflicts.length ? ["planned_conflicts"] : []
      }
    };
  }

  const proposedRule = request.scope === "following"
    ? { ...request.proposedRule, startDate: selectedDate }
    : request.proposedRule;
  const oldWindow = ruleWindow(writableRule(rule), now, request.scope === "following" ? selectedDate : undefined);
  const newWindow = ruleWindow(proposedRule, now, request.scope === "following" ? selectedDate : undefined);
  const startDate = oldWindow.startDate < newWindow.startDate ? oldWindow.startDate : newWindow.startDate;
  const endDate = oldWindow.endDate > newWindow.endDate ? oldWindow.endDate : newWindow.endDate;
  const existing = await loadAffectedEntries(database, ruleId, startDate, endDate);
  const existingChildren = await loadEntryChildren(database, existing.map((entry) => entry.id));
  const existingByKey = new Map(existing
    .filter((entry) => entry.contact_rule_occurrence_key)
    .sort((left, right) => Number(Boolean(right.deleted_at)) - Number(Boolean(left.deleted_at)))
    .map((entry) => [entry.contact_rule_occurrence_key as string, entry]));
  const desired = expandedFor(proposedRule, newWindow.startDate, newWindow.endDate);
  const desiredKeys = new Set(desired.map((entry) => entry.occurrenceKey));
  let affected = 0;
  let created = 0;
  let preserved = 0;
  let historical = 0;
  const retireIds: string[] = [];

  for (const entry of existing) {
    if (isProtected(entry)) {
      preserved += 1;
      if (entry.status !== "planned") historical += 1;
      continue;
    }
    if (entry.contact_rule_occurrence_key && desiredKeys.has(entry.contact_rule_occurrence_key)) affected += 1;
    else retireIds.push(entry.id);
  }
  for (const occurrence of desired) {
    const existingEntry = existingByKey.get(occurrence.occurrenceKey);
    if (!existingEntry) created += 1;
  }
  const replaceableIds = new Set(existing.filter((entry) => !isProtected(entry)).map((entry) => entry.id));
  const conflictResult = await conflictEvidence({
    database,
    desired,
    childIds: proposedRule.childIds,
    replaceableIds,
    existingByKey
  });
  const successorRuleId = request.scope === "following"
    ? `rule_split_${createHash("sha256").update(`${ruleId}:${selectedDate}`).digest("hex").slice(0, 20)}`
    : undefined;
  const fingerprint = createHash("sha256").update(JSON.stringify({
    ruleId,
    ruleUpdatedAt: rule.updatedAt,
    request: { ...request, proposedRule },
    selected: entryEvidence(selected, existingChildren.get(selected.id)),
    existing: existing.map((entry) => entryEvidence(entry, existingChildren.get(entry.id))),
    desired: desired.map((entry) => ({
      occurrenceKey: entry.occurrenceKey,
      startDateTime: entry.startDateTime,
      endDateTime: entry.endDateTime
    })),
    conflictFingerprints: conflictResult.fingerprints
  })).digest("hex");
  return {
    rule,
    selected,
    proposedRule,
    ...(successorRuleId ? { successorRuleId } : {}),
    retireIds,
    preview: {
      fingerprint,
      scope: request.scope,
      startDate,
      endDate,
      affected,
      created,
      retired: retireIds.length,
      preserved,
      historical,
      conflicts: conflictResult.conflicts,
      warnings: [
        ...(conflictResult.conflicts ? ["planned_conflicts"] : []),
        ...(preserved ? ["protected_occurrences_preserved"] : [])
      ]
    }
  };
}

export async function previewContactRuleChange(
  ruleId: string,
  request: ApiContactRuleChangeRequest,
  database: DatabaseExecutor,
  now?: string
): Promise<ApiContactRuleChangePreview> {
  return (await buildPlan(ruleId, request, database, now)).preview;
}

async function retireEntries(
  database: DatabaseExecutor,
  ids: string[],
  userEmail: string,
  timestamp: string,
  scope: ApiContactRuleChangeRequest["scope"]
): Promise<void> {
  for (const id of ids) {
    const existing = await database.selectFrom("care_entries")
      .select(["start_datetime", "end_datetime"])
      .where("id", "=", id)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!existing) continue;
    await database.updateTable("care_entries").set({
      deleted_at: timestamp,
      updated_by: userEmail,
      updated_at: timestamp
    }).where("id", "=", id).where("deleted_at", "is", null).execute();
    await retireOpenCareConfirmationRequests(database, id, timestamp);
    await markDomainClosedMonthsChanged(
      database,
      userEmail,
      "care_entry",
      id,
      existing.start_datetime.slice(0, 10),
      existing.end_datetime.slice(0, 10),
      timestamp
    );
    await recordDomainAudit(database, {
      userEmail,
      entityType: "care_entry",
      entityId: id,
      action: "deleted",
      metadata: { recurringCareChangeScope: scope }
    });
  }
}

export async function applyContactRuleChange(input: {
  ruleId: string;
  request: ApiContactRuleChangeApplyRequest;
  userEmail: string;
  database: DatabaseExecutor;
  now?: string;
}): Promise<ApiContactRuleChangePreview> {
  const { previewFingerprint, ...changeRequest } = input.request;
  const timestamp = input.now ?? nowIso();
  const plan = await buildPlan(input.ruleId, changeRequest, input.database, timestamp);
  if (plan.preview.fingerprint !== previewFingerprint) throw new ContactRuleChangePreviewChangedError();

  if (changeRequest.scope === "occurrence") {
    const durationMinutes = Math.round(
      (Date.parse(changeRequest.proposedEntry.endDateTime) - Date.parse(changeRequest.proposedEntry.startDateTime)) / 60_000
    );
    await input.database.updateTable("care_entries").set({
      start_datetime: changeRequest.proposedEntry.startDateTime,
      end_datetime: changeRequest.proposedEntry.endDateTime,
      responsible_party_id: changeRequest.proposedEntry.responsiblePartyId ?? null,
      contact_rule_sync_state: "manual_override",
      duration_minutes: durationMinutes,
      updated_by: input.userEmail,
      updated_at: timestamp
    }).where("id", "=", plan.selected.id).where("deleted_at", "is", null).execute();
    await syncPersistedChildJunction(
      input.database,
      { table: "care_entry_children", owner: "care_entry_id" },
      plan.selected.id,
      changeRequest.proposedEntry.childIds,
      timestamp
    );
    await recordDomainAudit(input.database, {
      userEmail: input.userEmail,
      entityType: "care_entry",
      entityId: plan.selected.id,
      action: "updated",
      metadata: { recurringCareChangeScope: "occurrence" }
    });
    const affectedDates = [
      plan.selected.start_datetime.slice(0, 10),
      plan.selected.end_datetime.slice(0, 10),
      changeRequest.proposedEntry.startDateTime.slice(0, 10),
      changeRequest.proposedEntry.endDateTime.slice(0, 10)
    ].sort();
    await markDomainClosedMonthsChanged(
      input.database,
      input.userEmail,
      "care_entry",
      plan.selected.id,
      affectedDates[0] ?? changeRequest.proposedEntry.startDateTime.slice(0, 10),
      affectedDates.at(-1) ?? changeRequest.proposedEntry.endDateTime.slice(0, 10),
      timestamp
    );
    return plan.preview;
  }

  if (!plan.proposedRule) throw new Error("contact_rule_change_missing_proposal");
  if (changeRequest.scope === "series") {
    await upsertContactRule({
      id: input.ruleId,
      rule: omitUndefinedValues({
        ...plan.proposedRule,
        sourceContactPatternId: plan.rule.sourceContactPatternId
      }),
      createdBy: plan.rule.createdBy,
      updatedBy: input.userEmail,
      createdAt: plan.rule.createdAt,
      updatedAt: timestamp,
      database: input.database
    });
    await retireEntries(input.database, plan.retireIds, input.userEmail, timestamp, "series");
    await syncContactRule(input.ruleId, {
      database: input.database,
      userEmail: input.userEmail,
      startDate: plan.preview.startDate,
      endDate: plan.preview.endDate,
      now: timestamp,
      recordAudit: true
    });
    await recordDomainAudit(input.database, {
      userEmail: input.userEmail,
      entityType: "contact_rule",
      entityId: input.ruleId,
      action: "updated",
      metadata: { recurringCareChangeScope: "series" }
    });
    return plan.preview;
  }

  const successorRuleId = plan.successorRuleId ?? makeId("rule");
  const previousEndDate = addDays(plan.selected.rule_occurrence_date ?? plan.selected.start_datetime.slice(0, 10), -1);
  if (previousEndDate >= plan.rule.startDate) {
    await upsertContactRule({
      id: input.ruleId,
      rule: omitUndefinedValues({
        ...writableRule(plan.rule),
        endDate: previousEndDate,
        sourceContactPatternId: plan.rule.sourceContactPatternId
      }),
      createdBy: plan.rule.createdBy,
      updatedBy: input.userEmail,
      createdAt: plan.rule.createdAt,
      updatedAt: timestamp,
      database: input.database
    });
  } else {
    await input.database.updateTable("contact_rules").set({
      active: 0,
      updated_by: input.userEmail,
      updated_at: timestamp
    }).where("id", "=", input.ruleId).execute();
  }
  const replaceable = await loadAffectedEntries(
    input.database,
    input.ruleId,
    plan.preview.startDate,
    plan.preview.endDate
  );
  await retireEntries(
    input.database,
    replaceable.filter((entry) => !isProtected(entry)).map((entry) => entry.id),
    input.userEmail,
    timestamp,
    "following"
  );
  await upsertContactRule({
    id: successorRuleId,
    rule: omitUndefinedValues(plan.proposedRule),
    createdBy: input.userEmail,
    updatedBy: input.userEmail,
    createdAt: timestamp,
    updatedAt: timestamp,
    database: input.database
  });
  await recordDomainAudit(input.database, {
    userEmail: input.userEmail,
    entityType: "contact_rule",
    entityId: successorRuleId,
    action: "created",
    metadata: {
      recurringCareChangeScope: "following",
      predecessorRuleId: input.ruleId,
      splitDate: plan.proposedRule.startDate
    }
  });
  await syncContactRule(successorRuleId, {
    database: input.database,
    userEmail: input.userEmail,
    startDate: plan.proposedRule.startDate,
    endDate: ruleWindow(plan.proposedRule, timestamp, plan.proposedRule.startDate).endDate,
    now: timestamp,
    recordAudit: true
  });
  await recordDomainAudit(input.database, {
    userEmail: input.userEmail,
    entityType: "contact_rule",
    entityId: input.ruleId,
    action: "updated",
    metadata: {
      recurringCareChangeScope: "following",
      successorRuleId,
      splitDate: plan.proposedRule.startDate
    }
  });
  return plan.preview;
}

export function isContactRuleChangePreviewChangedError(error: unknown): boolean {
  return error instanceof ContactRuleChangePreviewChangedError ||
    (error instanceof Error && (error as { code?: string }).code === "contact_rule_change_preview_changed");
}
