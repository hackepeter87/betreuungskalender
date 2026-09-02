import { sql } from "kysely";
import type { RequestUser } from "../auth.js";
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

export async function assignedPersistedCarePartyIds(
  database: DatabaseExecutor,
  userId: string
): Promise<string[]> {
  const rows = await database.selectFrom("app_user_care_party_assignments")
    .select("care_party_id")
    .where("user_id", "=", userId)
    .where("deleted_at", "is", null)
    .orderBy("care_party_id")
    .execute();
  return rows.map((row) => row.care_party_id);
}

export async function assertCanUsePersistedCareParty(
  database: DatabaseExecutor,
  user: RequestUser | undefined,
  carePartyId: string | undefined
): Promise<void> {
  const assignmentCount = await database.selectFrom("app_user_care_party_assignments")
    .select(({ fn }) => fn.count<number>("id").as("count"))
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  const sharedMode = Number(assignmentCount?.count ?? 0) > 0;
  if (!carePartyId) {
    if (user && user.role !== "admin" && sharedMode) {
      throw new Error("Eine zugeordnete betreuende Person ist erforderlich.");
    }
    return;
  }
  if (!(await getPersistedCareParty(database, carePartyId))) {
    throw new Error("Diese betreuende Person ist für deinen Benutzer nicht freigegeben.");
  }
  if (!user || user.role === "admin" || !sharedMode) return;
  const assigned = await assignedPersistedCarePartyIds(database, user.id);
  if (!assigned.includes(carePartyId)) {
    throw new Error("Diese betreuende Person ist für deinen Benutzer nicht freigegeben.");
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
