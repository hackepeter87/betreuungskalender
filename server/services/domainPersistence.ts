import { sql } from "kysely";
import type { RequestUser } from "../auth.js";
import { effectiveCareDataScope, type CareDataScope } from "./careDataScopes.js";
import type { DatabaseExecutor } from "../db/runtime.js";
import type { ApiAppSettings } from "../../shared/api.js";
import { normalizeSettingsValues, settingsDefaults } from "./settingsContract.js";

type AuditAction = "created" | "updated" | "deleted" | "post_close_change";

export interface DomainAuditInput {
  userEmail: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  fieldName?: string;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: unknown;
  timestamp?: string;
}

export interface PersistedCareParty {
  id: string;
  name: string;
  kind: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

function serialize(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export async function recordDomainAudit(
  database: DatabaseExecutor,
  input: DomainAuditInput
): Promise<void> {
  const timestamp = input.timestamp ?? new Date().toISOString();
  await database.insertInto("audit_log").values({
    timestamp,
    user_email: input.userEmail,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    field_name: input.fieldName ?? null,
    old_value: serialize(input.oldValue),
    new_value: serialize(input.newValue),
    metadata_json: serialize(input.metadata),
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null
  }).execute();
}

export async function recordDomainFieldChanges(
  database: DatabaseExecutor,
  userEmail: string,
  entityType: string,
  entityId: string,
  before: object,
  after: object,
  ignoredFields: string[] = []
): Promise<void> {
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const ignored = new Set(ignoredFields);
  for (const field of new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])) {
    if (ignored.has(field)) continue;
    const oldValue = serialize(beforeRecord[field]);
    const newValue = serialize(afterRecord[field]);
    if (oldValue === newValue) continue;
    await recordDomainAudit(database, {
      userEmail,
      entityType,
      entityId,
      action: "updated",
      fieldName: field,
      oldValue: beforeRecord[field],
      newValue: afterRecord[field]
    });
  }
}

function monthKeysForRange(startDate: string, endDate: string): string[] {
  const [startYear, startMonth] = startDate.slice(0, 7).split("-").map(Number);
  const [endYear, endMonth] = endDate.slice(0, 7).split("-").map(Number);
  const current = new Date(Date.UTC(startYear ?? 1970, (startMonth ?? 1) - 1, 1));
  const end = new Date(Date.UTC(endYear ?? 1970, (endMonth ?? 1) - 1, 1));
  const result: string[] = [];
  while (current <= end) {
    result.push(`${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}`);
    current.setUTCMonth(current.getUTCMonth() + 1);
  }
  return result;
}

export async function markDomainClosedMonthsChanged(
  database: DatabaseExecutor,
  userEmail: string,
  entityType: string,
  entityId: string,
  startDate: string,
  endDate: string,
  timestamp = new Date().toISOString()
): Promise<void> {
  for (const monthKey of monthKeysForRange(startDate, endDate)) {
    const result = await database.updateTable("monthly_closings")
      .set({ changed_after_close_at: timestamp, updated_by: userEmail, updated_at: timestamp })
      .where("month_key", "=", monthKey)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (result.numUpdatedRows > 0n) {
      await recordDomainAudit(database, {
        userEmail,
        entityType,
        entityId,
        action: "post_close_change",
        fieldName: monthKey,
        newValue: timestamp
      });
    }
  }
}

export async function markAllDomainClosedMonthsChanged(
  database: DatabaseExecutor,
  userEmail: string,
  entityType: string,
  entityId: string,
  timestamp = new Date().toISOString()
): Promise<void> {
  const rows = await database.selectFrom("monthly_closings")
    .select("month_key")
    .where("deleted_at", "is", null)
    .execute();
  for (const row of rows) {
    await database.updateTable("monthly_closings")
      .set({ changed_after_close_at: timestamp, updated_by: userEmail, updated_at: timestamp })
      .where("month_key", "=", row.month_key)
      .execute();
    await recordDomainAudit(database, {
      userEmail,
      entityType,
      entityId,
      action: "post_close_change",
      fieldName: row.month_key,
      newValue: timestamp
    });
  }
}

export async function assertPersistedChildren(
  database: DatabaseExecutor,
  childIds: string[]
): Promise<void> {
  const uniqueIds = [...new Set(childIds)];
  if (!uniqueIds.length) return;
  const row = await database.selectFrom("children")
    .select(({ fn }) => fn.count<number>("id").as("count"))
    .where("deleted_at", "is", null)
    .where("id", "in", uniqueIds)
    .executeTakeFirst();
  if (Number(row?.count ?? 0) !== uniqueIds.length) {
    throw new Error("Mindestens ein zugeordnetes Kind existiert nicht oder wurde gelöscht.");
  }
}

type ChildJunction =
  | { table: "care_entry_children"; owner: "care_entry_id" }
  | { table: "care_entry_actual_children"; owner: "care_entry_id" }
  | { table: "contact_pattern_children"; owner: "contact_pattern_id" }
  | { table: "contact_rule_children"; owner: "contact_rule_id" }
  | { table: "holiday_period_children"; owner: "holiday_period_id" }
  | { table: "unavailable_period_children"; owner: "unavailable_period_id" };

export async function syncPersistedChildJunction(
  database: DatabaseExecutor,
  junction: ChildJunction,
  ownerId: string,
  childIds: string[],
  timestamp: string
): Promise<void> {
  const selected = new Set(childIds);
  const existing = await database.selectFrom(junction.table)
    .select(["child_id", "deleted_at"])
    .where(sql.ref(junction.owner), "=", ownerId)
    .execute();
  for (const link of existing) {
    if (selected.has(link.child_id)) {
      await database.updateTable(junction.table)
        .set({ deleted_at: null, updated_at: timestamp })
        .where(sql.ref(junction.owner), "=", ownerId)
        .where("child_id", "=", link.child_id)
        .execute();
      selected.delete(link.child_id);
    } else if (link.deleted_at === null) {
      await database.updateTable(junction.table)
        .set({ deleted_at: timestamp, updated_at: timestamp })
        .where(sql.ref(junction.owner), "=", ownerId)
        .where("child_id", "=", link.child_id)
        .execute();
    }
  }
  for (const childId of selected) {
    await database.insertInto(junction.table).values({
      [junction.owner]: ownerId,
      child_id: childId,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null
    }).execute();
  }
}

export async function softDeletePersistedChildRelations(
  database: DatabaseExecutor,
  childId: string,
  timestamp: string
): Promise<void> {
  const relations = [
    { table: "care_entry_children", owner: "care_entry_id", parent: "care_entries" },
    { table: "holiday_period_children", owner: "holiday_period_id", parent: "holiday_periods" },
    { table: "unavailable_period_children", owner: "unavailable_period_id", parent: "unavailable_periods" },
    { table: "contact_pattern_children", owner: "contact_pattern_id", parent: "contact_patterns" }
  ] as const;
  for (const relation of relations) {
    await database.updateTable(relation.table)
      .set({ deleted_at: timestamp, updated_at: timestamp })
      .where("child_id", "=", childId)
      .where("deleted_at", "is", null)
      .execute();
    const owners = await database.selectFrom(relation.table)
      .select(sql.ref(relation.owner).as("ownerId"))
      .groupBy(sql.ref(relation.owner))
      .execute() as Array<{ ownerId: string }>;
    for (const owner of owners) {
      const active = await database.selectFrom(relation.table)
        .select(({ fn }) => fn.count<number>("child_id").as("count"))
        .where(sql.ref(relation.owner), "=", owner.ownerId)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
      if (Number(active?.count ?? 0) === 0) {
        await database.updateTable(relation.parent)
          .set({ deleted_at: timestamp, updated_at: timestamp })
          .where("id", "=", owner.ownerId)
          .where("deleted_at", "is", null)
          .execute();
      }
    }
  }
}

export async function getPersistedCareParty(
  database: DatabaseExecutor,
  id: string
): Promise<PersistedCareParty | undefined> {
  const row = await database.selectFrom("care_parties")
    .select(["id", "name", "kind", "created_by", "updated_by", "created_at", "updated_at"])
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  return row ? {
    id: row.id,
    name: row.name,
    kind: row.kind,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : undefined;
}

export async function assertPersistedCareParty(
  database: DatabaseExecutor,
  id: string | undefined
): Promise<void> {
  if (id && !(await getPersistedCareParty(database, id))) {
    throw new Error("Betreuende Person ist nicht vorhanden.");
  }
}

export class CarePartyAccessError extends Error {
  readonly code = "forbidden";
  readonly statusCode = 403;

  constructor() {
    super("Diese betreuende Person ist für deinen Benutzer nicht freigegeben.");
    this.name = "CarePartyAccessError";
  }
}

export class CurrentRecordChangedError extends Error {
  readonly code = "record_changed";
  readonly statusCode = 409;

  constructor() {
    super("Der Datensatz wurde zwischenzeitlich geändert.");
    this.name = "CurrentRecordChangedError";
  }
}

export function isCurrentRecordChangedError(
  error: unknown
): error is CurrentRecordChangedError {
  return error instanceof CurrentRecordChangedError ||
    (error instanceof Error && (error as { code?: string }).code === "record_changed");
}

export function isCarePartyAccessError(error: unknown): error is CarePartyAccessError {
  return error instanceof CarePartyAccessError ||
    (error instanceof Error && (error as { code?: string }).code === "forbidden");
}

export async function scopedPersistedCarePartyIds(
  database: DatabaseExecutor,
  user: RequestUser | undefined
): Promise<string[] | undefined> {
  const scope = await effectiveCareDataScope(user, database);
  return scope.type === "all" ? undefined : scope.carePartyIds;
}

export async function assertCanUsePersistedCareParty(
  database: DatabaseExecutor,
  user: RequestUser | undefined,
  carePartyId: string | undefined
): Promise<void> {
  const scopedPartyIds = await scopedPersistedCarePartyIds(database, user);
  if (!carePartyId) {
    if (scopedPartyIds) throw new CarePartyAccessError();
    return;
  }
  if (!(await getPersistedCareParty(database, carePartyId))) {
    throw new CarePartyAccessError();
  }
  if (scopedPartyIds && !scopedPartyIds.includes(carePartyId)) {
    throw new CarePartyAccessError();
  }
}

export async function lockPersistedCareDataScope(
  database: DatabaseExecutor,
  user: RequestUser | undefined
): Promise<CareDataScope> {
  if (
    !user ||
    user.isOwner ||
    user.workspaceRole === "admin" ||
    (!user.workspaceRole && user.role === "admin")
  ) {
    return { type: "all" };
  }

  await database.updateTable("app_memberships")
    .set({ updated_at: sql.ref("updated_at") })
    .where("user_id", "=", user.id)
    .where("deleted_at", "is", null)
    .execute();
  await database.updateTable("app_user_care_party_assignments")
    .set({ updated_at: sql.ref("updated_at") })
    .where("user_id", "=", user.id)
    .where("deleted_at", "is", null)
    .execute();

  return effectiveCareDataScope(user, database);
}

export async function assertCanUsePersistedCarePartyInScope(
  database: DatabaseExecutor,
  scope: CareDataScope,
  carePartyId: string | undefined
): Promise<void> {
  await assertCanUsePersistedCarePartiesInScope(database, scope, [carePartyId]);
}

export async function assertCanUsePersistedCarePartiesInScope(
  database: DatabaseExecutor,
  scope: CareDataScope,
  carePartyIds: Array<string | undefined>
): Promise<void> {
  if (scope.type === "selected" && carePartyIds.some((id) => !id)) {
    throw new CarePartyAccessError();
  }
  const ids = [...new Set(carePartyIds.filter((id): id is string => Boolean(id)))].sort();
  if (scope.type === "selected" && ids.some((id) => !scope.carePartyIds.includes(id))) {
    throw new CarePartyAccessError();
  }
  if (ids.length === 0) return;
  const claimed = await database.updateTable("care_parties")
    .set({ updated_at: sql.ref("updated_at") })
    .where("id", "in", ids)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (Number(claimed.numUpdatedRows) !== ids.length) throw new CarePartyAccessError();
}

export async function claimCurrentScopedRecord(
  database: DatabaseExecutor,
  table: "care_entries" | "contact_rules" | "unavailable_periods",
  id: string,
  updatedAt: string
): Promise<void> {
  const claim = table === "care_entries"
    ? database.updateTable("care_entries")
      .set({ updated_at: sql.ref("updated_at") })
      .where("id", "=", id)
      .where("updated_at", "=", updatedAt)
      .where("deleted_at", "is", null)
      .executeTakeFirst()
    : table === "contact_rules"
      ? database.updateTable("contact_rules")
        .set({ updated_at: sql.ref("updated_at") })
        .where("id", "=", id)
        .where("updated_at", "=", updatedAt)
        .where("deleted_at", "is", null)
        .executeTakeFirst()
      : database.updateTable("unavailable_periods")
        .set({ updated_at: sql.ref("updated_at") })
        .where("id", "=", id)
        .where("updated_at", "=", updatedAt)
        .where("deleted_at", "is", null)
        .executeTakeFirst();
  if (Number((await claim).numUpdatedRows) !== 1) {
    throw new CurrentRecordChangedError();
  }
}

export async function getPersistedSettingValues(
  database: DatabaseExecutor
): Promise<Record<string, unknown>> {
  const rows = await database.selectFrom("settings")
    .select(["key", "value_json"])
    .where("deleted_at", "is", null)
    .execute();
  const values: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      values[row.key] = JSON.parse(row.value_json) as unknown;
    } catch {
      // Invalid historical values are ignored by all consumers.
    }
  }
  return { ...settingsDefaults, ...values };
}

export async function getPersistedClientSettings(
  database: DatabaseExecutor
): Promise<ApiAppSettings> {
  const [values, activeCareParties] = await Promise.all([
    getPersistedSettingValues(database),
    database.selectFrom("care_parties")
      .select("id")
      .where("deleted_at", "is", null)
      .execute()
  ]);
  return normalizeSettingsValues(values, new Set(activeCareParties.map((row) => row.id)));
}

export async function getPersistedDefaultResponsiblePartyId(
  database: DatabaseExecutor
): Promise<string | undefined> {
  const configured = (await getPersistedSettingValues(database)).defaultResponsiblePartyId;
  if (typeof configured === "string" && configured.trim()) {
    const active = await database.selectFrom("care_parties")
      .select("id")
      .where("id", "=", configured)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (active) return configured;
  }
  const row = await database.selectFrom("care_parties")
    .select("id")
    .where("deleted_at", "is", null)
    .orderBy(sql`CASE WHEN id = 'party_primary' THEN 0 ELSE 1 END`)
    .orderBy("created_at")
    .orderBy("id")
    .executeTakeFirst();
  return row?.id;
}
