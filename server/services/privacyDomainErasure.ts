import type {
  PrivacyActionExecuteRequest,
  PrivacyActionPreviewRequest
} from "../../shared/privacyActions.js";
import type { DatabaseExecutor } from "../db/runtime.js";

export interface PrivacyDomainErasureAnalysis {
  blockerCodes: string[];
}

function selected(request: PrivacyActionPreviewRequest, category: string, action: string): boolean {
  return request.actions.some((selection) =>
    selection.category === category && selection.action === action
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function deleted(result: { numDeletedRows: bigint | number }): number {
  return Number(result.numDeletedRows);
}

function updated(result: { numUpdatedRows: bigint | number }): number {
  return Number(result.numUpdatedRows);
}

function hasText(...values: Array<string | null>): boolean {
  return values.some((value) => typeof value === "string" && value.trim().length > 0);
}

async function childRecordAnalysis(
  childId: string,
  database: DatabaseExecutor
): Promise<{ relationshipCount: number; exclusiveCount: number; sharedAmbiguous: boolean }> {
  const [planned, actual, holidays, patterns, rules, unavailable] = await Promise.all([
    database.selectFrom("care_entry_children").select("care_entry_id").where("child_id", "=", childId).execute(),
    database.selectFrom("care_entry_actual_children").select("care_entry_id").where("child_id", "=", childId).execute(),
    database.selectFrom("holiday_period_children").select("holiday_period_id").where("child_id", "=", childId).execute(),
    database.selectFrom("contact_pattern_children").select("contact_pattern_id").where("child_id", "=", childId).execute(),
    database.selectFrom("contact_rule_children").select("contact_rule_id").where("child_id", "=", childId).execute(),
    database.selectFrom("unavailable_period_children").select("unavailable_period_id").where("child_id", "=", childId).execute()
  ]);
  const entryIds = unique([...planned, ...actual].map((row) => row.care_entry_id));
  let exclusiveCount = 0;
  let sharedAmbiguous = false;

  for (const id of entryIds) {
    const [entry, plannedChildren, actualChildren] = await Promise.all([
      database.selectFrom("care_entries").select([
        "cancellation_reason", "confirmation_note", "location", "handover_from", "handover_to",
        "notes", "evidence_reference", "custom_location", "deviation_note"
      ]).where("id", "=", id).executeTakeFirst(),
      database.selectFrom("care_entry_children").select("child_id").where("care_entry_id", "=", id).execute(),
      database.selectFrom("care_entry_actual_children").select("child_id").where("care_entry_id", "=", id).execute()
    ]);
    const otherChildren = unique([...plannedChildren, ...actualChildren]
      .map((row) => row.child_id).filter((candidate) => candidate !== childId));
    if (otherChildren.length === 0) exclusiveCount += 1;
    else if (entry && hasText(
      entry.cancellation_reason, entry.confirmation_note, entry.location,
      entry.handover_from, entry.handover_to, entry.notes, entry.evidence_reference,
      entry.custom_location, entry.deviation_note
    )) sharedAmbiguous = true;
  }

  for (const { holiday_period_id: id } of holidays) {
    const links = await database.selectFrom("holiday_period_children").select("child_id")
      .where("holiday_period_id", "=", id).execute();
    if (links.some((row) => row.child_id !== childId)) sharedAmbiguous = true;
    else exclusiveCount += 1;
  }
  for (const { contact_pattern_id: id } of patterns) {
    const links = await database.selectFrom("contact_pattern_children").select("child_id")
      .where("contact_pattern_id", "=", id).execute();
    if (links.some((row) => row.child_id !== childId)) sharedAmbiguous = true;
    else exclusiveCount += 1;
  }
  for (const { contact_rule_id: id } of rules) {
    const links = await database.selectFrom("contact_rule_children").select("child_id")
      .where("contact_rule_id", "=", id).execute();
    if (links.some((row) => row.child_id !== childId)) sharedAmbiguous = true;
    else exclusiveCount += 1;
  }
  for (const { unavailable_period_id: id } of unavailable) {
    const [period, links] = await Promise.all([
      database.selectFrom("unavailable_periods").select(["location", "notes", "evidence_reference"])
        .where("id", "=", id).executeTakeFirst(),
      database.selectFrom("unavailable_period_children").select("child_id")
        .where("unavailable_period_id", "=", id).execute()
    ]);
    const shared = links.some((row) => row.child_id !== childId);
    if (!shared) exclusiveCount += 1;
    else if (period && hasText(period.location, period.notes, period.evidence_reference)) {
      sharedAmbiguous = true;
    }
  }
  return {
    relationshipCount: entryIds.length + holidays.length + patterns.length + rules.length + unavailable.length,
    exclusiveCount,
    sharedAmbiguous
  };
}

async function carePartyRecordAnalysis(
  carePartyId: string,
  database: DatabaseExecutor
): Promise<{ relationshipCount: number; recordCount: number; shared: boolean }> {
  const [assignments, actorMappings, scopedFeeds, settings, plannedEntries, actualEntries, rules, unavailable] = await Promise.all([
    database.selectFrom("app_user_care_party_assignments").select("id").where("care_party_id", "=", carePartyId).execute(),
    database.selectFrom("data_transfer_actor_care_parties").select("actor_id").where("target_care_party_id", "=", carePartyId).execute(),
    database.selectFrom("calendar_feed_tokens").select("id").where("scope_party_id", "=", carePartyId).execute(),
    database.selectFrom("settings").select("key")
      .where("key", "in", ["primaryCarePartyId", "defaultResponsiblePartyId"])
      .where("value_json", "=", JSON.stringify(carePartyId)).execute(),
    database.selectFrom("care_entries").select(["id", "actual_responsible_party_id"])
      .where("responsible_party_id", "=", carePartyId).execute(),
    database.selectFrom("care_entries").select(["id", "responsible_party_id"])
      .where("actual_responsible_party_id", "=", carePartyId).execute(),
    database.selectFrom("contact_rules").select("id").where("responsible_party_id", "=", carePartyId).execute(),
    database.selectFrom("unavailable_periods").select("id").where("responsible_party_id", "=", carePartyId).execute()
  ]);
  const entryIds = unique([...plannedEntries, ...actualEntries].map((row) => row.id));
  let shared = plannedEntries.some((row) =>
    row.actual_responsible_party_id !== null && row.actual_responsible_party_id !== carePartyId
  ) || actualEntries.some((row) =>
    row.responsible_party_id !== null && row.responsible_party_id !== carePartyId
  );
  for (const id of entryIds) {
    const [plannedChildren, actualChildren] = await Promise.all([
      database.selectFrom("care_entry_children").select("child_id").where("care_entry_id", "=", id).execute(),
      database.selectFrom("care_entry_actual_children").select("child_id").where("care_entry_id", "=", id).execute()
    ]);
    if (plannedChildren.length > 0 || actualChildren.length > 0) shared = true;
  }
  for (const { id } of rules) {
    if ((await database.selectFrom("contact_rule_children").select("child_id")
      .where("contact_rule_id", "=", id).executeTakeFirst())) shared = true;
  }
  for (const { id } of unavailable) {
    if ((await database.selectFrom("unavailable_period_children").select("child_id")
      .where("unavailable_period_id", "=", id).executeTakeFirst())) shared = true;
  }
  return {
    relationshipCount: assignments.length + actorMappings.length + scopedFeeds.length + settings.length,
    recordCount: entryIds.length + rules.length + unavailable.length,
    shared
  };
}

export async function analyzePrivacyDomainErasure(
  request: PrivacyActionPreviewRequest,
  database: DatabaseExecutor
): Promise<PrivacyDomainErasureAnalysis> {
  const blockers = new Set<string>();
  const profileDelete = selected(request, "profile", "delete");
  const relationshipDelete = selected(request, "domain_relationships", "delete");
  const recordDelete = selected(request, "domain_records", "delete");
  const historyAnonymize = selected(request, "historical_attribution", "anonymize");
  if (request.subjectType === "user") return { blockerCodes: [] };

  const audit = await database.selectFrom("audit_log").select("id")
    .where("entity_type", "=", request.subjectType === "child" ? "child" : "care_party")
    .where("entity_id", "=", request.subjectId).executeTakeFirst();
  if (profileDelete && audit && !historyAnonymize) {
    blockers.add("profile_deletion_requires_history_resolution");
  }

  if (request.subjectType === "child") {
    const analysis = await childRecordAnalysis(request.subjectId, database);
    if (profileDelete && analysis.relationshipCount > 0 && !relationshipDelete) {
      blockers.add("profile_deletion_requires_relationship_resolution");
    }
    if (recordDelete && analysis.relationshipCount > 0 && !relationshipDelete) {
      blockers.add("record_deletion_requires_relationship_resolution");
    }
    if (relationshipDelete && analysis.exclusiveCount > 0 && !recordDelete) {
      blockers.add("relationship_deletion_requires_record_resolution");
    }
    if ((relationshipDelete || recordDelete || profileDelete) && analysis.sharedAmbiguous) {
      blockers.add("shared_record_requires_manual_review");
    }
  } else {
    const analysis = await carePartyRecordAnalysis(request.subjectId, database);
    if (profileDelete && analysis.relationshipCount > 0 && !relationshipDelete) {
      blockers.add("profile_deletion_requires_relationship_resolution");
    }
    if (profileDelete && analysis.recordCount > 0 && !recordDelete) {
      blockers.add("profile_deletion_requires_record_resolution");
    }
    if (recordDelete && analysis.shared) blockers.add("shared_record_requires_manual_review");
  }
  return { blockerCodes: [...blockers].sort() };
}

async function deleteCareEntries(ids: string[], database: DatabaseExecutor): Promise<number> {
  if (ids.length === 0) return 0;
  const requestIds = (await database.selectFrom("care_confirmation_requests").select("id")
    .where("care_entry_id", "in", ids).execute()).map((row) => row.id);
  let count = 0;
  if (requestIds.length > 0) {
    count += deleted(await database.deleteFrom("care_confirmation_email_deliveries")
      .where("care_confirmation_request_id", "in", requestIds).executeTakeFirst());
  }
  count += deleted(await database.deleteFrom("care_confirmation_requests")
    .where("care_entry_id", "in", ids).executeTakeFirst());
  count += deleted(await database.deleteFrom("trips").where("care_entry_id", "in", ids).executeTakeFirst());
  count += deleted(await database.deleteFrom("costs").where("care_entry_id", "in", ids).executeTakeFirst());
  count += deleted(await database.deleteFrom("care_entry_actual_children")
    .where("care_entry_id", "in", ids).executeTakeFirst());
  count += deleted(await database.deleteFrom("care_entry_children")
    .where("care_entry_id", "in", ids).executeTakeFirst());
  count += deleted(await database.deleteFrom("care_entries").where("id", "in", ids).executeTakeFirst());
  return count;
}

async function exclusiveChildOwners(
  childId: string,
  database: DatabaseExecutor
): Promise<{
  entries: string[];
  holidays: string[];
  patterns: string[];
  rules: string[];
  unavailable: string[];
}> {
  const [planned, actual, holidays, patterns, rules, unavailable] = await Promise.all([
    database.selectFrom("care_entry_children").select("care_entry_id").where("child_id", "=", childId).execute(),
    database.selectFrom("care_entry_actual_children").select("care_entry_id").where("child_id", "=", childId).execute(),
    database.selectFrom("holiday_period_children").select("holiday_period_id").where("child_id", "=", childId).execute(),
    database.selectFrom("contact_pattern_children").select("contact_pattern_id").where("child_id", "=", childId).execute(),
    database.selectFrom("contact_rule_children").select("contact_rule_id").where("child_id", "=", childId).execute(),
    database.selectFrom("unavailable_period_children").select("unavailable_period_id").where("child_id", "=", childId).execute()
  ]);
  const exclusive = async (
    table: "holiday_period_children" | "contact_pattern_children" | "contact_rule_children" | "unavailable_period_children",
    ownerColumn: "holiday_period_id" | "contact_pattern_id" | "contact_rule_id" | "unavailable_period_id",
    ownerIds: string[]
  ) => {
    const result: string[] = [];
    for (const id of unique(ownerIds)) {
      const rows = await database.selectFrom(table).select("child_id").where(ownerColumn, "=", id).execute();
      if (!rows.some((row) => row.child_id !== childId)) result.push(id);
    }
    return result;
  };
  const entries: string[] = [];
  for (const id of unique([...planned, ...actual].map((row) => row.care_entry_id))) {
    const [plannedChildren, actualChildren] = await Promise.all([
      database.selectFrom("care_entry_children").select("child_id").where("care_entry_id", "=", id).execute(),
      database.selectFrom("care_entry_actual_children").select("child_id").where("care_entry_id", "=", id).execute()
    ]);
    if (![...plannedChildren, ...actualChildren].some((row) => row.child_id !== childId)) entries.push(id);
  }
  return {
    entries,
    holidays: await exclusive("holiday_period_children", "holiday_period_id", holidays.map((row) => row.holiday_period_id)),
    patterns: await exclusive("contact_pattern_children", "contact_pattern_id", patterns.map((row) => row.contact_pattern_id)),
    rules: await exclusive("contact_rule_children", "contact_rule_id", rules.map((row) => row.contact_rule_id)),
    unavailable: await exclusive("unavailable_period_children", "unavailable_period_id", unavailable.map((row) => row.unavailable_period_id))
  };
}

async function deleteChildDomainRecords(
  childId: string,
  database: DatabaseExecutor
): Promise<number> {
  const owners = await exclusiveChildOwners(childId, database);
  let count = await deleteCareEntries(owners.entries, database);
  if (owners.rules.length > 0) {
    count += updated(await database.updateTable("care_entries").set({
      contact_rule_id: null,
      contact_rule_segment_id: null,
      contact_rule_occurrence_key: null,
      contact_rule_sync_state: null
    }).where("contact_rule_id", "in", owners.rules).executeTakeFirst());
    count += deleted(await database.deleteFrom("contact_rule_children")
      .where("contact_rule_id", "in", owners.rules).executeTakeFirst());
    count += deleted(await database.deleteFrom("contact_rules").where("id", "in", owners.rules).executeTakeFirst());
  }
  if (owners.patterns.length > 0) {
    count += updated(await database.updateTable("care_entries").set({
      generated_by_pattern_id: null,
      rule_occurrence_date: null
    }).where("generated_by_pattern_id", "in", owners.patterns).executeTakeFirst());
    count += updated(await database.updateTable("contact_rules").set({ source_contact_pattern_id: null })
      .where("source_contact_pattern_id", "in", owners.patterns).executeTakeFirst());
    count += deleted(await database.deleteFrom("contact_pattern_children")
      .where("contact_pattern_id", "in", owners.patterns).executeTakeFirst());
    count += deleted(await database.deleteFrom("contact_patterns").where("id", "in", owners.patterns).executeTakeFirst());
  }
  if (owners.holidays.length > 0) {
    count += deleted(await database.deleteFrom("holiday_period_children")
      .where("holiday_period_id", "in", owners.holidays).executeTakeFirst());
    count += deleted(await database.deleteFrom("holiday_periods").where("id", "in", owners.holidays).executeTakeFirst());
  }
  if (owners.unavailable.length > 0) {
    count += deleted(await database.deleteFrom("unavailable_period_children")
      .where("unavailable_period_id", "in", owners.unavailable).executeTakeFirst());
    count += deleted(await database.deleteFrom("unavailable_periods")
      .where("id", "in", owners.unavailable).executeTakeFirst());
  }
  return count;
}

async function deleteChildRelationships(childId: string, database: DatabaseExecutor): Promise<number> {
  let count = 0;
  count += deleted(await database.deleteFrom("care_entry_actual_children").where("child_id", "=", childId).executeTakeFirst());
  count += deleted(await database.deleteFrom("care_entry_children").where("child_id", "=", childId).executeTakeFirst());
  count += deleted(await database.deleteFrom("holiday_period_children").where("child_id", "=", childId).executeTakeFirst());
  count += deleted(await database.deleteFrom("contact_pattern_children").where("child_id", "=", childId).executeTakeFirst());
  count += deleted(await database.deleteFrom("contact_rule_children").where("child_id", "=", childId).executeTakeFirst());
  count += deleted(await database.deleteFrom("unavailable_period_children").where("child_id", "=", childId).executeTakeFirst());
  return count;
}

async function deleteCarePartyDomainRecords(
  carePartyId: string,
  database: DatabaseExecutor
): Promise<number> {
  const [plannedEntries, actualEntries, rules, unavailable] = await Promise.all([
    database.selectFrom("care_entries").select("id").where("responsible_party_id", "=", carePartyId).execute(),
    database.selectFrom("care_entries").select("id").where("actual_responsible_party_id", "=", carePartyId).execute(),
    database.selectFrom("contact_rules").select("id").where("responsible_party_id", "=", carePartyId).execute(),
    database.selectFrom("unavailable_periods").select("id").where("responsible_party_id", "=", carePartyId).execute()
  ]);
  const entryIds = unique([...plannedEntries, ...actualEntries].map((row) => row.id));
  const ruleIds = rules.map((row) => row.id);
  const unavailableIds = unavailable.map((row) => row.id);
  let count = await deleteCareEntries(entryIds, database);
  if (ruleIds.length > 0) {
    count += updated(await database.updateTable("care_entries").set({
      contact_rule_id: null,
      contact_rule_segment_id: null,
      contact_rule_occurrence_key: null,
      contact_rule_sync_state: null
    }).where("contact_rule_id", "in", ruleIds).executeTakeFirst());
    count += deleted(await database.deleteFrom("contact_rule_children")
      .where("contact_rule_id", "in", ruleIds).executeTakeFirst());
    count += deleted(await database.deleteFrom("contact_rules").where("id", "in", ruleIds).executeTakeFirst());
  }
  if (unavailableIds.length > 0) {
    count += deleted(await database.deleteFrom("unavailable_period_children")
      .where("unavailable_period_id", "in", unavailableIds).executeTakeFirst());
    count += deleted(await database.deleteFrom("unavailable_periods")
      .where("id", "in", unavailableIds).executeTakeFirst());
  }
  return count;
}

export async function applyPrivacyDomainErasure(
  request: PrivacyActionExecuteRequest,
  actorId: string,
  timestamp: string,
  database: DatabaseExecutor
): Promise<Record<string, number>> {
  const supported = new Set([
    "domain_relationships:delete",
    "domain_records:delete",
    "profile:delete"
  ]);
  const deleteActions = request.actions.filter((selection) => selection.action === "delete");
  if (deleteActions.some(({ category, action }) => !supported.has(`${category}:${action}`))) {
    throw new Error("Unsupported privacy-domain erasure action.");
  }
  const counts: Record<string, number> = {};
  const relationshipDelete = selected(request, "domain_relationships", "delete");
  const recordDelete = selected(request, "domain_records", "delete");
  const profileDelete = selected(request, "profile", "delete");

  if (request.subjectType === "child") {
    if (recordDelete) counts.domain_records = await deleteChildDomainRecords(request.subjectId, database);
    if (relationshipDelete || recordDelete || profileDelete) {
      counts.domain_relationships = await deleteChildRelationships(request.subjectId, database);
    }
    if (profileDelete) {
      counts.profile = deleted(await database.deleteFrom("children")
        .where("id", "=", request.subjectId).where("deleted_at", "is", null).executeTakeFirst());
    }
  } else if (request.subjectType === "care_party") {
    if (recordDelete) counts.domain_records = await deleteCarePartyDomainRecords(request.subjectId, database);
    if (relationshipDelete) {
      counts.domain_relationships = deleted(await database.deleteFrom("app_user_care_party_assignments")
        .where("care_party_id", "=", request.subjectId).executeTakeFirst());
      counts.domain_relationships += deleted(await database.deleteFrom("data_transfer_actor_care_parties")
        .where("target_care_party_id", "=", request.subjectId).executeTakeFirst());
      counts.domain_relationships += deleted(await database.deleteFrom("calendar_feed_tokens")
        .where("scope_party_id", "=", request.subjectId).executeTakeFirst());
      counts.domain_relationships += deleted(await database.deleteFrom("settings")
        .where("key", "in", ["primaryCarePartyId", "defaultResponsiblePartyId"])
        .where("value_json", "=", JSON.stringify(request.subjectId)).executeTakeFirst());
    }
    if (profileDelete) {
      counts.profile = deleted(await database.deleteFrom("care_parties")
        .where("id", "=", request.subjectId).where("deleted_at", "is", null).executeTakeFirst());
    }
  }

  if (recordDelete || relationshipDelete || profileDelete) {
    counts.monthly_closings = updated(await database.updateTable("monthly_closings").set({
      changed_after_close_at: timestamp,
      updated_by: actorId,
      updated_at: timestamp
    }).where("deleted_at", "is", null).executeTakeFirst());
  }
  return counts;
}
