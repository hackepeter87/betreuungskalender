import { createHash, randomUUID } from "node:crypto";
import type {
  PrivacyActionCategoryCode,
  PrivacyActionCategoryPreview,
  PrivacyActionKind,
  PrivacyActionExecuteRequest,
  PrivacyActionPreviewRequest,
  PrivacyActionPreviewResponse,
  PrivacyActionResultResponse,
  PrivacyActionSelection,
  PrivacySubjectType
} from "../../shared/privacyActions.js";
import type { DatabaseExecutor } from "../db/runtime.js";
import type { PersistenceRuntime } from "../db/runtime.js";
import { installationOwnerId } from "./memberManagement.js";
import {
  analyzePrivacyDomainErasure,
  applyPrivacyDomainErasure
} from "./privacyDomainErasure.js";
import { detachedAuthenticationSubjectPrefix } from "./users.js";

interface InventoryCategory {
  code: PrivacyActionCategoryCode;
  availableActions: PrivacyActionKind[];
  references: string[];
  requiresManualReview?: boolean;
}

export class PrivacyActionError extends Error {
  constructor(
    public readonly code:
      | "privacy_action_invalid"
      | "privacy_action_not_found"
      | "privacy_action_preview_changed"
      | "privacy_subject_not_found",
    public readonly statusCode: 400 | 404 | 409
  ) {
    super(code);
  }
}

const externalFollowUpCodes = ["backups", "exports", "identity_provider", "logs"];

const subjectTypes = new Set<PrivacySubjectType>(["user", "care_party", "child"]);
const actionKinds = new Set<PrivacyActionKind>(["revoke", "detach", "anonymize", "delete"]);
const categoryCodes = new Set<PrivacyActionCategoryCode>([
  "access", "authentication_identity", "profile", "domain_relationships",
  "domain_records", "historical_attribution", "transfer_state", "runtime_channels"
]);

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

export function parsePrivacyActionPreviewRequest(value: unknown): PrivacyActionPreviewRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PrivacyActionError("privacy_action_invalid", 400);
  }
  const input = value as Record<string, unknown>;
  if (!subjectTypes.has(input.subjectType as PrivacySubjectType) || !boundedIdentifier(input.subjectId)) {
    throw new PrivacyActionError("privacy_action_invalid", 400);
  }
  if (!Array.isArray(input.actions) || input.actions.length === 0 || input.actions.length > categoryCodes.size) {
    throw new PrivacyActionError("privacy_action_invalid", 400);
  }
  const actions: PrivacyActionSelection[] = [];
  const seen = new Set<PrivacyActionCategoryCode>();
  for (const value of input.actions) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new PrivacyActionError("privacy_action_invalid", 400);
    }
    const selection = value as Record<string, unknown>;
    const category = selection.category as PrivacyActionCategoryCode;
    const action = selection.action as PrivacyActionKind;
    if (!categoryCodes.has(category) || !actionKinds.has(action) || seen.has(category)) {
      throw new PrivacyActionError("privacy_action_invalid", 400);
    }
    seen.add(category);
    actions.push({ category, action });
  }
  actions.sort((left, right) => left.category.localeCompare(right.category) || left.action.localeCompare(right.action));
  return { subjectType: input.subjectType as PrivacySubjectType, subjectId: input.subjectId, actions };
}

export function parsePrivacyActionExecuteRequest(value: unknown): PrivacyActionExecuteRequest {
  const request = parsePrivacyActionPreviewRequest(value);
  const fingerprintValue = (value as Record<string, unknown>).fingerprint;
  if (typeof fingerprintValue !== "string" || !/^[a-f0-9]{64}$/.test(fingerprintValue)) {
    throw new PrivacyActionError("privacy_action_invalid", 400);
  }
  return { ...request, fingerprint: fingerprintValue };
}

function ref(id: string, ...state: Array<string | number | null>): string {
  return [id, ...state].join(":");
}

async function userInventory(userId: string, database: DatabaseExecutor): Promise<InventoryCategory[]> {
  const user = await database.selectFrom("app_users")
    .select(["id", "external_subject", "updated_at", "deleted_at"])
    .where("id", "=", userId).where("deleted_at", "is", null).executeTakeFirst();
  if (!user) throw new PrivacyActionError("privacy_subject_not_found", 404);
  const [
    memberships, assignments, feeds, pushes, confirmations, sessions,
    preferences, invitations, actorAudit, profileAudit, transfers
  ] = await Promise.all([
    database.selectFrom("app_memberships").select(["id", "updated_at", "deleted_at"]).where("user_id", "=", userId).execute(),
    database.selectFrom("app_user_care_party_assignments").select(["id", "updated_at", "deleted_at"]).where("user_id", "=", userId).execute(),
    database.selectFrom("calendar_feed_tokens").select(["id", "revoked_at", "last_used_at"]).where("user_id", "=", userId).execute(),
    database.selectFrom("push_subscriptions").select(["id", "updated_at", "deleted_at"]).where("user_id", "=", userId).execute(),
    database.selectFrom("care_confirmation_requests").select(["id", "updated_at", "deleted_at", "answered_at"]).where("user_id", "=", userId).execute(),
    database.selectFrom("native_oidc_sessions").select(["id", "last_seen_at", "expires_at", "revoked_at"]).where("external_subject", "=", user.external_subject).execute(),
    database.selectFrom("notification_preferences").select(["event_type", "updated_at"]).where("user_id", "=", userId).execute(),
    database.selectFrom("app_invitations").select(["id", "updated_at", "revoked_at", "accepted_at"]).where("accepted_user_id", "=", userId).execute(),
    database.selectFrom("audit_log").select(["id", "updated_at", "deleted_at"]).where("user_email", "=", userId).execute(),
    database.selectFrom("audit_log").select(["id", "updated_at", "deleted_at"])
      .where("entity_id", "=", userId)
      .where("entity_type", "in", ["app_member", "user_care_party_assignment"]).execute(),
    database.selectFrom("data_transfer_actors").select(["id", "updated_at"]).where("mapped_user_id", "=", userId).execute()
  ]);
  const audit = [...new Map([...actorAudit, ...profileAudit].map((row) => [row.id, row])).values()];
  return [
    { code: "authentication_identity", availableActions: ["detach", "anonymize"], references: [ref(user.id, user.updated_at)] },
    { code: "access", availableActions: ["revoke"], references: memberships.map((row) => ref(row.id, row.updated_at, row.deleted_at)) },
    { code: "domain_relationships", availableActions: ["delete"], references: assignments.map((row) => ref(row.id, row.updated_at, row.deleted_at)) },
    {
      code: "runtime_channels", availableActions: ["revoke", "delete"], references: [
        ...feeds.map((row) => ref(row.id, row.revoked_at, row.last_used_at)),
        ...pushes.map((row) => ref(row.id, row.updated_at, row.deleted_at)),
        ...confirmations.map((row) => ref(row.id, row.updated_at, row.deleted_at, row.answered_at)),
        ...sessions.map((row) => ref(row.id, row.last_seen_at, row.expires_at, row.revoked_at)),
        ...preferences.map((row) => ref(row.event_type, row.updated_at)),
        ...invitations.map((row) => ref(row.id, row.updated_at, row.revoked_at, row.accepted_at))
      ]
    },
    {
      code: "historical_attribution", availableActions: ["anonymize"],
      references: audit.map((row) => ref(String(row.id), row.updated_at, row.deleted_at)),
      requiresManualReview: audit.length > 0
    },
    { code: "transfer_state", availableActions: ["anonymize", "delete"], references: transfers.map((row) => ref(row.id, row.updated_at)) }
  ];
}

async function childInventory(childId: string, database: DatabaseExecutor): Promise<InventoryCategory[]> {
  const profile = await database.selectFrom("children").select(["id", "updated_at"])
    .where("id", "=", childId).where("deleted_at", "is", null).executeTakeFirst();
  if (!profile) throw new PrivacyActionError("privacy_subject_not_found", 404);
  const [entries, actualEntries, holidays, patterns, rules, unavailable, audit] = await Promise.all([
    database.selectFrom("care_entry_children").select(["care_entry_id", "updated_at", "deleted_at"]).where("child_id", "=", childId).execute(),
    database.selectFrom("care_entry_actual_children").select(["care_entry_id", "updated_at", "deleted_at"]).where("child_id", "=", childId).execute(),
    database.selectFrom("holiday_period_children").select(["holiday_period_id", "updated_at", "deleted_at"]).where("child_id", "=", childId).execute(),
    database.selectFrom("contact_pattern_children").select(["contact_pattern_id", "updated_at", "deleted_at"]).where("child_id", "=", childId).execute(),
    database.selectFrom("contact_rule_children").select(["contact_rule_id", "updated_at", "deleted_at"]).where("child_id", "=", childId).execute(),
    database.selectFrom("unavailable_period_children").select(["unavailable_period_id", "updated_at", "deleted_at"]).where("child_id", "=", childId).execute(),
    database.selectFrom("audit_log").select(["id", "updated_at", "deleted_at"])
      .where("entity_type", "=", "child").where("entity_id", "=", childId).execute()
  ]);
  const relationships = [
    ...entries.map((row) => ref(`entry:${row.care_entry_id}`, row.updated_at, row.deleted_at)),
    ...actualEntries.map((row) => ref(`actual:${row.care_entry_id}`, row.updated_at, row.deleted_at)),
    ...holidays.map((row) => ref(`holiday:${row.holiday_period_id}`, row.updated_at, row.deleted_at)),
    ...patterns.map((row) => ref(`pattern:${row.contact_pattern_id}`, row.updated_at, row.deleted_at)),
    ...rules.map((row) => ref(`rule:${row.contact_rule_id}`, row.updated_at, row.deleted_at)),
    ...unavailable.map((row) => ref(`unavailable:${row.unavailable_period_id}`, row.updated_at, row.deleted_at))
  ];
  const entryIds = [...new Set([...entries, ...actualEntries].map((row) => row.care_entry_id))];
  const holidayIds = [...new Set(holidays.map((row) => row.holiday_period_id))];
  const patternIds = [...new Set(patterns.map((row) => row.contact_pattern_id))];
  const ruleIds = [...new Set(rules.map((row) => row.contact_rule_id))];
  const unavailableIds = [...new Set(unavailable.map((row) => row.unavailable_period_id))];
  const [entryRecords, holidayRecords, patternRecords, ruleRecords, unavailableRecords] = await Promise.all([
    entryIds.length > 0
      ? database.selectFrom("care_entries").select(["id", "updated_at", "deleted_at"]).where("id", "in", entryIds).execute()
      : [],
    holidayIds.length > 0
      ? database.selectFrom("holiday_periods").select(["id", "updated_at", "deleted_at"]).where("id", "in", holidayIds).execute()
      : [],
    patternIds.length > 0
      ? database.selectFrom("contact_patterns").select(["id", "updated_at", "deleted_at"]).where("id", "in", patternIds).execute()
      : [],
    ruleIds.length > 0
      ? database.selectFrom("contact_rules").select(["id", "updated_at", "deleted_at"]).where("id", "in", ruleIds).execute()
      : [],
    unavailableIds.length > 0
      ? database.selectFrom("unavailable_periods").select(["id", "updated_at", "deleted_at"]).where("id", "in", unavailableIds).execute()
      : []
  ]);
  const domainRecords = [
    ...entryRecords.map((row) => ref(`entry:${row.id}`, row.updated_at, row.deleted_at)),
    ...holidayRecords.map((row) => ref(`holiday:${row.id}`, row.updated_at, row.deleted_at)),
    ...patternRecords.map((row) => ref(`pattern:${row.id}`, row.updated_at, row.deleted_at)),
    ...ruleRecords.map((row) => ref(`rule:${row.id}`, row.updated_at, row.deleted_at)),
    ...unavailableRecords.map((row) => ref(`unavailable:${row.id}`, row.updated_at, row.deleted_at))
  ];
  return [
    { code: "profile", availableActions: ["anonymize", "delete"], references: [ref(profile.id, profile.updated_at)] },
    {
      code: "historical_attribution", availableActions: ["anonymize"],
      references: audit.map((row) => ref(String(row.id), row.updated_at, row.deleted_at))
    },
    { code: "domain_relationships", availableActions: ["delete"], references: relationships },
    {
      code: "domain_records", availableActions: ["delete"],
      references: domainRecords,
      requiresManualReview: relationships.length > 0
    }
  ];
}

async function carePartyInventory(carePartyId: string, database: DatabaseExecutor): Promise<InventoryCategory[]> {
  const profile = await database.selectFrom("care_parties").select(["id", "updated_at"])
    .where("id", "=", carePartyId).where("deleted_at", "is", null).executeTakeFirst();
  if (!profile) throw new PrivacyActionError("privacy_subject_not_found", 404);
  const [
    assignments, transferAssignments, scopedFeeds, settings,
    entries, actualEntries, rules, unavailable, audit
  ] = await Promise.all([
    database.selectFrom("app_user_care_party_assignments").select(["id", "updated_at", "deleted_at"]).where("care_party_id", "=", carePartyId).execute(),
    database.selectFrom("data_transfer_actor_care_parties").select(["actor_id", "updated_at"])
      .where("target_care_party_id", "=", carePartyId).execute(),
    database.selectFrom("calendar_feed_tokens").select(["id", "revoked_at", "last_used_at"])
      .where("scope_party_id", "=", carePartyId).execute(),
    database.selectFrom("settings").select(["key", "updated_at", "deleted_at"])
      .where("key", "in", ["primaryCarePartyId", "defaultResponsiblePartyId"])
      .where("value_json", "=", JSON.stringify(carePartyId)).execute(),
    database.selectFrom("care_entries").select(["id", "updated_at", "deleted_at"]).where("responsible_party_id", "=", carePartyId).execute(),
    database.selectFrom("care_entries").select(["id", "updated_at", "deleted_at"]).where("actual_responsible_party_id", "=", carePartyId).execute(),
    database.selectFrom("contact_rules").select(["id", "updated_at", "deleted_at"]).where("responsible_party_id", "=", carePartyId).execute(),
    database.selectFrom("unavailable_periods").select(["id", "updated_at", "deleted_at"]).where("responsible_party_id", "=", carePartyId).execute(),
    database.selectFrom("audit_log").select(["id", "updated_at", "deleted_at"])
      .where("entity_type", "=", "care_party").where("entity_id", "=", carePartyId).execute()
  ]);
  const domainRecords = [
    ...new Map([...entries, ...actualEntries].map((row) => [
      row.id,
      ref(`entry:${row.id}`, row.updated_at, row.deleted_at)
    ])).values(),
    ...rules.map((row) => ref(`rule:${row.id}`, row.updated_at, row.deleted_at)),
    ...unavailable.map((row) => ref(`unavailable:${row.id}`, row.updated_at, row.deleted_at))
  ];
  return [
    { code: "profile", availableActions: ["anonymize", "delete"], references: [ref(profile.id, profile.updated_at)] },
    {
      code: "historical_attribution", availableActions: ["anonymize"],
      references: audit.map((row) => ref(String(row.id), row.updated_at, row.deleted_at))
    },
    {
      code: "domain_relationships",
      availableActions: ["delete"],
      references: [
        ...assignments.map((row) => ref(row.id, row.updated_at, row.deleted_at)),
        ...transferAssignments.map((row) => ref(`transfer:${row.actor_id}`, row.updated_at)),
        ...scopedFeeds.map((row) => ref(`feed:${row.id}`, row.revoked_at, row.last_used_at)),
        ...settings.map((row) => ref(`setting:${row.key}`, row.updated_at, row.deleted_at))
      ]
    },
    { code: "domain_records", availableActions: ["delete"], references: domainRecords, requiresManualReview: domainRecords.length > 0 }
  ];
}

async function inventory(request: PrivacyActionPreviewRequest, database: DatabaseExecutor): Promise<InventoryCategory[]> {
  if (request.subjectType === "user") return userInventory(request.subjectId, database);
  if (request.subjectType === "child") return childInventory(request.subjectId, database);
  return carePartyInventory(request.subjectId, database);
}

export async function previewPrivacyAction(
  request: PrivacyActionPreviewRequest,
  actorId: string,
  database: DatabaseExecutor
): Promise<PrivacyActionPreviewResponse> {
  const categories = await inventory(request, database);
  const selections = new Map(request.actions.map((selection) => [selection.category, selection.action]));
  const blockerCodes = new Set<string>();
  const warningCodes = new Set<string>();
  const ownerId = request.subjectType === "user" ? await installationOwnerId(database) : undefined;
  if (request.subjectType === "user" && (request.subjectId === actorId || request.subjectId === ownerId)) {
    blockerCodes.add("current_owner_protected");
  }
  const categoryResponse: PrivacyActionCategoryPreview[] = categories.map((category) => {
    const selectedAction = selections.get(category.code);
    if (selectedAction && !category.availableActions.includes(selectedAction)) blockerCodes.add("unsupported_action");
    if (category.requiresManualReview && selectedAction) warningCodes.add("shared_records_require_review");
    return {
      code: category.code,
      count: category.references.length,
      availableActions: category.availableActions,
      ...(selectedAction ? { selectedAction } : {}),
      status: category.requiresManualReview && selectedAction ? "manual_review" : selectedAction ? "ready" : "warning"
    };
  });
  for (const selection of request.actions) {
    if (!categories.some((category) => category.code === selection.category)) blockerCodes.add("unsupported_action");
  }
  const identityAction = selections.get("authentication_identity");
  if (request.subjectType === "user" && identityAction && !blockerCodes.has("current_owner_protected")) {
    const requiredSelections: Array<[PrivacyActionCategoryCode, PrivacyActionKind[]]> = [
      ["access", ["revoke"]],
      ["runtime_channels", ["revoke", "delete"]]
    ];
    if ((categories.find(({ code }) => code === "domain_relationships")?.references.length ?? 0) > 0) {
      requiredSelections.push(["domain_relationships", ["delete"]]);
    }
    for (const [category, actions] of requiredSelections) {
      const selected = selections.get(category);
      if (!selected || !actions.includes(selected)) blockerCodes.add("identity_detachment_requires_full_revocation");
    }
    if (
      (categories.find(({ code }) => code === "historical_attribution")?.references.length ?? 0) > 0 &&
      selections.get("historical_attribution") !== "anonymize"
    ) {
      blockerCodes.add("identity_anonymization_requires_history_resolution");
    }
    if (
      (categories.find(({ code }) => code === "transfer_state")?.references.length ?? 0) > 0 &&
      !["anonymize", "delete"].includes(selections.get("transfer_state") ?? "")
    ) {
      blockerCodes.add("identity_detachment_requires_transfer_resolution");
    }
  }
  if (
    request.subjectType !== "user" &&
    selections.get("profile") === "anonymize" &&
    (categories.find(({ code }) => code === "historical_attribution")?.references.length ?? 0) > 0 &&
    selections.get("historical_attribution") !== "anonymize"
  ) {
    blockerCodes.add("profile_anonymization_requires_history_resolution");
  }
  for (const code of (await analyzePrivacyDomainErasure(request, database)).blockerCodes) {
    blockerCodes.add(code);
  }
  if (blockerCodes.size > 0) for (const category of categoryResponse) category.status = "blocked";
  const canonicalState = categories.map((category) => ({ code: category.code, references: [...category.references].sort() }));
  const result = blockerCodes.size > 0 ? "blocked" : warningCodes.size > 0 ? "warnings" : "ready";
  return {
    fingerprint: fingerprint({ request, canonicalState }),
    result,
    subject: { type: request.subjectType, id: request.subjectId },
    categories: categoryResponse,
    warningCodes: [...warningCodes].sort(),
    blockerCodes: [...blockerCodes].sort(),
    externalFollowUpCodes
  };
}

export async function privacyActionPreviewMatches(
  request: PrivacyActionPreviewRequest,
  actorId: string,
  expectedFingerprint: string,
  database: DatabaseExecutor
): Promise<boolean> {
  return (await previewPrivacyAction(request, actorId, database)).fingerprint === expectedFingerprint;
}

function changed(result: { numUpdatedRows: bigint | number }): number {
  return Number(result.numUpdatedRows);
}

function neutralSuffix(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 10);
}

async function clearDirectAuditSnapshots(
  entityTypes: string[],
  entityId: string,
  timestamp: string,
  database: DatabaseExecutor
): Promise<number> {
  let count = 0;
  for (const entityType of entityTypes) {
    count += changed(await database.updateTable("audit_log").set({
      old_value: null,
      new_value: null,
      metadata_json: null,
      updated_at: timestamp
    }).where("entity_type", "=", entityType).where("entity_id", "=", entityId).executeTakeFirst());
  }
  return count;
}

function resultFromRow(row: {
  id: string;
  status: string;
  subject_type: string;
  action_codes_json: string;
  affected_counts_json: string;
  started_at: string;
  completed_at: string | null;
  error_code: string | null;
}): PrivacyActionResultResponse {
  const actionCodes = JSON.parse(row.action_codes_json) as unknown;
  const affectedCounts = JSON.parse(row.affected_counts_json) as unknown;
  return {
    id: row.id,
    status: row.status === "failed" ? "failed" : "completed",
    subjectType: row.subject_type as PrivacySubjectType,
    actionCodes: Array.isArray(actionCodes) ? actionCodes.filter((value): value is string => typeof value === "string") : [],
    affectedCounts: affectedCounts && typeof affectedCounts === "object" && !Array.isArray(affectedCounts)
      ? Object.fromEntries(Object.entries(affectedCounts).filter((entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isInteger(entry[1]) && entry[1] >= 0))
      : {},
    startedAt: row.started_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    externalFollowUpCodes
  };
}

async function completedResultByFingerprint(
  fingerprintValue: string,
  actorId: string,
  database: DatabaseExecutor
): Promise<PrivacyActionResultResponse | undefined> {
  const row = await database.selectFrom("privacy_action_runs")
    .select([
      "id", "status", "subject_type", "action_codes_json", "affected_counts_json",
      "started_at", "completed_at", "error_code"
    ])
    .where("preview_fingerprint", "=", fingerprintValue)
    .where("actor_user_id", "=", actorId)
    .where("status", "=", "completed")
    .executeTakeFirst();
  return row ? resultFromRow(row) : undefined;
}

async function applyUserActions(
  request: PrivacyActionExecuteRequest,
  actorId: string,
  actionId: string,
  timestamp: string,
  database: DatabaseExecutor
): Promise<Record<string, number>> {
  if (request.subjectType !== "user") throw new PrivacyActionError("privacy_action_invalid", 400);
  const selected = new Map(request.actions.map((selection) => [selection.category, selection.action]));
  const supported = new Set([
    "access:revoke",
    "authentication_identity:detach",
    "authentication_identity:anonymize",
    "domain_relationships:delete",
    "historical_attribution:anonymize",
    "runtime_channels:delete",
    "runtime_channels:revoke",
    "transfer_state:anonymize",
    "transfer_state:delete"
  ]);
  if (request.actions.some(({ category, action }) => !supported.has(`${category}:${action}`))) {
    throw new PrivacyActionError("privacy_action_invalid", 400);
  }
  const user = await database.selectFrom("app_users")
    .select(["id", "external_subject"])
    .where("id", "=", request.subjectId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!user) throw new PrivacyActionError("privacy_subject_not_found", 404);
  const counts: Record<string, number> = {};
  if (selected.get("access") === "revoke") {
    counts.access = changed(await database.updateTable("app_memberships")
      .set({ deleted_at: timestamp, updated_by: actorId, updated_at: timestamp })
      .where("user_id", "=", user.id).where("deleted_at", "is", null).executeTakeFirst());
  }
  if (selected.get("domain_relationships") === "delete") {
    counts.domain_relationships = changed(await database.updateTable("app_user_care_party_assignments")
      .set({ deleted_at: timestamp, updated_by: actorId, updated_at: timestamp })
      .where("user_id", "=", user.id).where("deleted_at", "is", null).executeTakeFirst());
  }
  if (selected.has("runtime_channels")) {
    let total = 0;
    total += changed(await database.updateTable("calendar_feed_tokens")
      .set({ revoked_at: timestamp }).where("user_id", "=", user.id).where("revoked_at", "is", null).executeTakeFirst());
    total += changed(await database.updateTable("push_subscriptions")
      .set({ deleted_at: timestamp, updated_at: timestamp }).where("user_id", "=", user.id).where("deleted_at", "is", null).executeTakeFirst());
    total += changed(await database.updateTable("native_oidc_sessions")
      .set({ revoked_at: timestamp }).where("external_subject", "=", user.external_subject).where("revoked_at", "is", null).executeTakeFirst());
    const requestIds = database.selectFrom("care_confirmation_requests").select("id").where("user_id", "=", user.id);
    total += changed(await database.updateTable("care_confirmation_email_deliveries")
      .set({ status: "failed", error_code: "subject_revoked", next_attempt_at: null, updated_at: timestamp })
      .where("care_confirmation_request_id", "in", requestIds).where("status", "=", "pending").executeTakeFirst());
    total += changed(await database.updateTable("care_confirmation_requests")
      .set({ deleted_at: timestamp, updated_at: timestamp }).where("user_id", "=", user.id).where("deleted_at", "is", null).executeTakeFirst());
    total += changed(await database.updateTable("notification_preferences")
      .set({ deleted_at: timestamp, updated_at: timestamp }).where("user_id", "=", user.id).where("deleted_at", "is", null).executeTakeFirst());
    total += changed(await database.updateTable("app_invitations")
      .set({ accepted_user_id: null, revoked_at: timestamp, updated_by: actorId, updated_at: timestamp })
      .where("accepted_user_id", "=", user.id).executeTakeFirst());
    counts.runtime_channels = total;
  }
  if (selected.get("historical_attribution") === "anonymize") {
    counts.historical_attribution = await clearDirectAuditSnapshots(
      ["app_member", "user_care_party_assignment"],
      user.id,
      timestamp,
      database
    );
  }
  if (selected.get("transfer_state") === "anonymize") {
    const actors = await database.selectFrom("data_transfer_actors")
      .select("id").where("mapped_user_id", "=", user.id).execute();
    const actorIds = actors.map(({ id }) => id);
    let total = 0;
    if (actorIds.length > 0) {
      total += changed(await database.updateTable("app_invitations").set({
        email_hint: null,
        data_transfer_actor_id: null,
        revoked_at: timestamp,
        updated_by: actorId,
        updated_at: timestamp
      }).where("data_transfer_actor_id", "in", actorIds).executeTakeFirst());
      total += Number((await database.deleteFrom("data_transfer_actor_care_parties")
        .where("actor_id", "in", actorIds).executeTakeFirst()).numDeletedRows);
      for (const { id } of actors) {
        total += changed(await database.updateTable("data_transfer_actors").set({
          source_ref: `anonymized:${neutralSuffix(id)}`,
          display_name: `Anonymized historical actor ${neutralSuffix(id)}`,
          email_hint: null,
          suggested_role: null,
          mapped_user_id: null,
          invitation_id: null,
          updated_by: actorId,
          updated_at: timestamp
        }).where("id", "=", id).executeTakeFirst());
      }
    }
    counts.transfer_state = total;
  }
  if (selected.get("transfer_state") === "delete") {
    const actors = await database.selectFrom("data_transfer_actors")
      .select("id").where("mapped_user_id", "=", user.id).execute();
    const actorIds = actors.map(({ id }) => id);
    let total = 0;
    if (actorIds.length > 0) {
      total += changed(await database.updateTable("app_invitations").set({
        email_hint: null,
        data_transfer_actor_id: null,
        revoked_at: timestamp,
        updated_by: actorId,
        updated_at: timestamp
      }).where("data_transfer_actor_id", "in", actorIds).executeTakeFirst());
      total += Number((await database.deleteFrom("data_transfer_actor_care_parties")
        .where("actor_id", "in", actorIds).executeTakeFirst()).numDeletedRows);
      total += Number((await database.deleteFrom("data_transfer_actors")
        .where("id", "in", actorIds).executeTakeFirst()).numDeletedRows);
    }
    counts.transfer_state = total;
  }
  const identityAction = selected.get("authentication_identity");
  if (identityAction === "detach" || identityAction === "anonymize") {
    const alreadyDetached = user.external_subject.startsWith(detachedAuthenticationSubjectPrefix);
    counts.authentication_identity = changed(await database.updateTable("app_users").set({
      external_subject: alreadyDetached
        ? user.external_subject
        : `${detachedAuthenticationSubjectPrefix}${neutralSuffix(user.id)}`,
      email: null,
      display_name: identityAction === "anonymize"
        ? `Anonymized workspace member ${neutralSuffix(user.id)}`
        : `Former workspace member ${actionId.slice(0, 8)}`,
      role: "readonly",
      groups_json: "[]",
      updated_at: timestamp
    }).where("id", "=", user.id).executeTakeFirst());
  }
  return counts;
}

async function applyProfileAnonymization(
  request: PrivacyActionExecuteRequest,
  actorId: string,
  timestamp: string,
  database: DatabaseExecutor
): Promise<Record<string, number>> {
  const selected = new Map(request.actions.map((selection) => [selection.category, selection.action]));
  const supported = new Set(["profile:anonymize", "historical_attribution:anonymize"]);
  if (request.actions.some(({ category, action }) => !supported.has(`${category}:${action}`))) {
    throw new PrivacyActionError("privacy_action_invalid", 400);
  }
  const counts: Record<string, number> = {};
  if (request.subjectType === "child") {
    if (selected.get("profile") === "anonymize") {
      counts.profile = changed(await database.updateTable("children").set({
        name: `Anonymized child ${neutralSuffix(request.subjectId)}`,
        birth_month: null,
        birth_year: null,
        updated_by: actorId,
        updated_at: timestamp
      }).where("id", "=", request.subjectId).where("deleted_at", "is", null).executeTakeFirst());
    }
    if (selected.get("historical_attribution") === "anonymize") {
      counts.historical_attribution = await clearDirectAuditSnapshots(
        ["child"], request.subjectId, timestamp, database
      );
    }
    return counts;
  }
  if (request.subjectType === "care_party") {
    if (selected.get("profile") === "anonymize") {
      counts.profile = changed(await database.updateTable("care_parties").set({
        name: `Anonymized care party ${neutralSuffix(request.subjectId)}`,
        updated_by: actorId,
        updated_at: timestamp
      }).where("id", "=", request.subjectId).where("deleted_at", "is", null).executeTakeFirst());
    }
    if (selected.get("historical_attribution") === "anonymize") {
      counts.historical_attribution = await clearDirectAuditSnapshots(
        ["care_party"], request.subjectId, timestamp, database
      );
    }
    return counts;
  }
  throw new PrivacyActionError("privacy_action_invalid", 400);
}

export async function executePrivacyAction(
  request: PrivacyActionExecuteRequest,
  actorId: string,
  persistence: PersistenceRuntime,
  timestamp = new Date().toISOString()
): Promise<PrivacyActionResultResponse> {
  const existing = await completedResultByFingerprint(request.fingerprint, actorId, persistence.query);
  if (existing) return existing;
  try {
    return await persistence.transaction(async (database) => {
      const repeated = await completedResultByFingerprint(request.fingerprint, actorId, database);
      if (repeated) return repeated;
      const previewRequest: PrivacyActionPreviewRequest = {
        subjectType: request.subjectType,
        subjectId: request.subjectId,
        actions: request.actions
      };
      const preview = await previewPrivacyAction(previewRequest, actorId, database);
      if (preview.fingerprint !== request.fingerprint) {
        throw new PrivacyActionError("privacy_action_preview_changed", 409);
      }
      if (preview.result === "blocked") throw new PrivacyActionError("privacy_action_invalid", 400);
      const actionId = randomUUID();
      const actionCodes = request.actions.map(({ category, action }) => `${category}:${action}`).sort();
      await database.insertInto("privacy_action_runs").values({
        id: actionId,
        preview_fingerprint: request.fingerprint,
        actor_user_id: actorId,
        subject_type: request.subjectType,
        action_codes_json: JSON.stringify(actionCodes),
        affected_counts_json: "{}",
        status: "pending",
        error_code: null,
        started_at: timestamp,
        completed_at: null,
        created_at: timestamp,
        updated_at: timestamp
      }).execute();
      let affectedCounts: Record<string, number>;
      if (request.subjectType === "user") {
        affectedCounts = await applyUserActions(request, actorId, actionId, timestamp, database);
      } else {
        affectedCounts = {};
        const anonymizationActions = request.actions.filter((selection) =>
          selection.action === "anonymize"
        );
        if (anonymizationActions.length > 0) {
          Object.assign(affectedCounts, await applyProfileAnonymization(
            { ...request, actions: anonymizationActions }, actorId, timestamp, database
          ));
        }
        if (request.actions.some((selection) => selection.action === "delete")) {
          const deletionCounts = await applyPrivacyDomainErasure(
            request, actorId, timestamp, database
          );
          for (const [category, count] of Object.entries(deletionCounts)) {
            affectedCounts[category] = (affectedCounts[category] ?? 0) + count;
          }
        }
      }
      await database.updateTable("privacy_action_runs").set({
        affected_counts_json: JSON.stringify(affectedCounts),
        status: "completed",
        completed_at: timestamp,
        updated_at: timestamp
      }).where("id", "=", actionId).execute();
      const result = await completedResultByFingerprint(request.fingerprint, actorId, database);
      if (!result) throw new Error("Privacy action result was not stored.");
      return result;
    });
  } catch (error) {
    const repeated = await completedResultByFingerprint(request.fingerprint, actorId, persistence.query);
    if (repeated) return repeated;
    throw error;
  }
}

export async function getPrivacyActionResult(
  actionId: string,
  database: DatabaseExecutor
): Promise<PrivacyActionResultResponse> {
  if (!boundedIdentifier(actionId)) throw new PrivacyActionError("privacy_action_invalid", 400);
  const row = await database.selectFrom("privacy_action_runs")
    .select([
      "id", "status", "subject_type", "action_codes_json", "affected_counts_json",
      "started_at", "completed_at", "error_code"
    ])
    .where("id", "=", actionId)
    .where("status", "in", ["completed", "failed"])
    .executeTakeFirst();
  if (!row) throw new PrivacyActionError("privacy_action_not_found", 404);
  return resultFromRow(row);
}
