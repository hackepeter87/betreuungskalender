import { createHash } from "node:crypto";
import type {
  PrivacyActionCategoryCode,
  PrivacyActionCategoryPreview,
  PrivacyActionKind,
  PrivacyActionPreviewRequest,
  PrivacyActionPreviewResponse,
  PrivacyActionSelection,
  PrivacySubjectType
} from "../../shared/privacyActions.js";
import type { DatabaseExecutor } from "../db/runtime.js";
import { installationOwnerId } from "./memberManagement.js";

interface InventoryCategory {
  code: PrivacyActionCategoryCode;
  availableActions: PrivacyActionKind[];
  references: string[];
  requiresManualReview?: boolean;
}

export class PrivacyActionError extends Error {
  constructor(
    public readonly code: "privacy_action_invalid" | "privacy_subject_not_found",
    public readonly statusCode: 400 | 404
  ) {
    super(code);
  }
}

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

function ref(id: string, ...state: Array<string | number | null>): string {
  return [id, ...state].join(":");
}

async function userInventory(userId: string, database: DatabaseExecutor): Promise<InventoryCategory[]> {
  const user = await database.selectFrom("app_users")
    .select(["id", "external_subject", "updated_at", "deleted_at"])
    .where("id", "=", userId).where("deleted_at", "is", null).executeTakeFirst();
  if (!user) throw new PrivacyActionError("privacy_subject_not_found", 404);
  const [memberships, assignments, feeds, pushes, confirmations, sessions, preferences, invitations, audit, transfers] = await Promise.all([
    database.selectFrom("app_memberships").select(["id", "updated_at", "deleted_at"]).where("user_id", "=", userId).execute(),
    database.selectFrom("app_user_care_party_assignments").select(["id", "updated_at", "deleted_at"]).where("user_id", "=", userId).execute(),
    database.selectFrom("calendar_feed_tokens").select(["id", "revoked_at", "last_used_at"]).where("user_id", "=", userId).execute(),
    database.selectFrom("push_subscriptions").select(["id", "updated_at", "deleted_at"]).where("user_id", "=", userId).execute(),
    database.selectFrom("care_confirmation_requests").select(["id", "updated_at", "deleted_at", "answered_at"]).where("user_id", "=", userId).execute(),
    database.selectFrom("native_oidc_sessions").select(["id", "last_seen_at", "expires_at", "revoked_at"]).where("external_subject", "=", user.external_subject).execute(),
    database.selectFrom("notification_preferences").select(["event_type", "updated_at"]).where("user_id", "=", userId).execute(),
    database.selectFrom("app_invitations").select(["id", "updated_at", "revoked_at", "accepted_at"]).where("accepted_user_id", "=", userId).execute(),
    database.selectFrom("audit_log").select(["id", "updated_at", "deleted_at"]).where("user_email", "=", userId).execute(),
    database.selectFrom("data_transfer_actors").select(["id", "updated_at"]).where("mapped_user_id", "=", userId).execute()
  ]);
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
  const [entries, actualEntries, holidays, patterns, rules, unavailable] = await Promise.all([
    database.selectFrom("care_entry_children").select(["care_entry_id", "updated_at", "deleted_at"]).where("child_id", "=", childId).execute(),
    database.selectFrom("care_entry_actual_children").select(["care_entry_id", "updated_at", "deleted_at"]).where("child_id", "=", childId).execute(),
    database.selectFrom("holiday_period_children").select(["holiday_period_id", "updated_at", "deleted_at"]).where("child_id", "=", childId).execute(),
    database.selectFrom("contact_pattern_children").select(["contact_pattern_id", "updated_at", "deleted_at"]).where("child_id", "=", childId).execute(),
    database.selectFrom("contact_rule_children").select(["contact_rule_id", "updated_at", "deleted_at"]).where("child_id", "=", childId).execute(),
    database.selectFrom("unavailable_period_children").select(["unavailable_period_id", "updated_at", "deleted_at"]).where("child_id", "=", childId).execute()
  ]);
  const relationships = [
    ...entries.map((row) => ref(`entry:${row.care_entry_id}`, row.updated_at, row.deleted_at)),
    ...actualEntries.map((row) => ref(`actual:${row.care_entry_id}`, row.updated_at, row.deleted_at)),
    ...holidays.map((row) => ref(`holiday:${row.holiday_period_id}`, row.updated_at, row.deleted_at)),
    ...patterns.map((row) => ref(`pattern:${row.contact_pattern_id}`, row.updated_at, row.deleted_at)),
    ...rules.map((row) => ref(`rule:${row.contact_rule_id}`, row.updated_at, row.deleted_at)),
    ...unavailable.map((row) => ref(`unavailable:${row.unavailable_period_id}`, row.updated_at, row.deleted_at))
  ];
  return [
    { code: "profile", availableActions: ["anonymize", "delete"], references: [ref(profile.id, profile.updated_at)] },
    { code: "domain_relationships", availableActions: ["delete"], references: relationships },
    {
      code: "domain_records", availableActions: ["delete"],
      references: [...new Set(relationships.map((value) => value.split(":").slice(0, 2).join(":")))],
      requiresManualReview: relationships.length > 0
    }
  ];
}

async function carePartyInventory(carePartyId: string, database: DatabaseExecutor): Promise<InventoryCategory[]> {
  const profile = await database.selectFrom("care_parties").select(["id", "updated_at"])
    .where("id", "=", carePartyId).where("deleted_at", "is", null).executeTakeFirst();
  if (!profile) throw new PrivacyActionError("privacy_subject_not_found", 404);
  const [assignments, entries, actualEntries, rules, unavailable] = await Promise.all([
    database.selectFrom("app_user_care_party_assignments").select(["id", "updated_at", "deleted_at"]).where("care_party_id", "=", carePartyId).execute(),
    database.selectFrom("care_entries").select(["id", "updated_at", "deleted_at"]).where("responsible_party_id", "=", carePartyId).execute(),
    database.selectFrom("care_entries").select(["id", "updated_at", "deleted_at"]).where("actual_responsible_party_id", "=", carePartyId).execute(),
    database.selectFrom("contact_rules").select(["id", "updated_at", "deleted_at"]).where("responsible_party_id", "=", carePartyId).execute(),
    database.selectFrom("unavailable_periods").select(["id", "updated_at", "deleted_at"]).where("responsible_party_id", "=", carePartyId).execute()
  ]);
  const domainRecords = [
    ...entries.map((row) => ref(`entry:${row.id}`, row.updated_at, row.deleted_at)),
    ...actualEntries.map((row) => ref(`actual:${row.id}`, row.updated_at, row.deleted_at)),
    ...rules.map((row) => ref(`rule:${row.id}`, row.updated_at, row.deleted_at)),
    ...unavailable.map((row) => ref(`unavailable:${row.id}`, row.updated_at, row.deleted_at))
  ];
  return [
    { code: "profile", availableActions: ["anonymize", "delete"], references: [ref(profile.id, profile.updated_at)] },
    { code: "domain_relationships", availableActions: ["delete"], references: assignments.map((row) => ref(row.id, row.updated_at, row.deleted_at)) },
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
    externalFollowUpCodes: ["backups", "exports", "identity_provider", "logs"]
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
