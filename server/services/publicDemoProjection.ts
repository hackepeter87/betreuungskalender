import type {
  ApiEntryStatus,
  ApiPublicDemoProjection,
  CareScope
} from "../../shared/api.js";
import type { DatabaseExecutor } from "../db/runtime.js";

export const DEMO_SEED_VERSION_SETTING = "demo.mode.seedVersion";
export const MAX_PUBLIC_DEMO_ENTRIES = 2_000;
const MAX_PUBLIC_DEMO_RELATIONS = 8_000;

export class PublicDemoProjectionError extends Error {
  constructor(readonly code: "demo_unavailable" | "demo_dataset_limit") {
    super(code);
  }
}

function booleanValue(value: number): boolean {
  return value === 1;
}

async function activeSeedVersion(database: DatabaseExecutor): Promise<string | undefined> {
  const row = await database.selectFrom("settings")
    .select("value_json")
    .where("key", "=", DEMO_SEED_VERSION_SETTING)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!row) return undefined;
  try {
    const value = JSON.parse(row.value_json) as unknown;
    return typeof value === "string" && value.trim() ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function publicDemoProjection(
  database: DatabaseExecutor,
  range: { startDate?: string; endDate?: string } = {},
  now = new Date()
): Promise<ApiPublicDemoProjection> {
  const seedVersion = await activeSeedVersion(database);
  if (!seedVersion) throw new PublicDemoProjectionError("demo_unavailable");

  const childrenPromise = database.selectFrom("children")
    .select(["id", "name", "color"])
    .where("deleted_at", "is", null)
    .orderBy("id")
    .execute();
  const carePartiesPromise = database.selectFrom("care_parties")
    .select(["id", "name"])
    .where("deleted_at", "is", null)
    .orderBy("id")
    .execute();

  let entryQuery = database.selectFrom("care_entries")
    .select([
      "id",
      "start_datetime",
      "end_datetime",
      "status",
      "care_scope",
      "overnight",
      "holiday",
      "additional_care",
      "responsible_party_id"
    ])
    .where("deleted_at", "is", null);
  if (range.startDate) {
    entryQuery = entryQuery.where(
      "end_datetime",
      ">",
      `${range.startDate}T00:00:00.000Z`
    );
  }
  if (range.endDate) {
    const exclusiveEnd = new Date(`${range.endDate}T00:00:00.000Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    entryQuery = entryQuery.where("start_datetime", "<", exclusiveEnd.toISOString());
  }
  const entries = await entryQuery
    .orderBy("start_datetime")
    .orderBy("id")
    .limit(MAX_PUBLIC_DEMO_ENTRIES + 1)
    .execute();
  if (entries.length > MAX_PUBLIC_DEMO_ENTRIES) {
    throw new PublicDemoProjectionError("demo_dataset_limit");
  }

  const entryIds = entries.map((entry) => entry.id);
  const childRelations = entryIds.length
    ? await database.selectFrom("care_entry_children")
      .select(["care_entry_id", "child_id"])
      .where("care_entry_id", "in", entryIds)
      .where("deleted_at", "is", null)
      .orderBy("care_entry_id")
      .orderBy("child_id")
      .limit(MAX_PUBLIC_DEMO_RELATIONS + 1)
      .execute()
    : [];
  if (childRelations.length > MAX_PUBLIC_DEMO_RELATIONS) {
    throw new PublicDemoProjectionError("demo_dataset_limit");
  }
  const childIdsByEntry = new Map<string, string[]>();
  for (const relation of childRelations) {
    const childIds = childIdsByEntry.get(relation.care_entry_id);
    if (childIds) childIds.push(relation.child_id);
    else childIdsByEntry.set(relation.care_entry_id, [relation.child_id]);
  }

  const [children, careParties] = await Promise.all([
    childrenPromise,
    carePartiesPromise
  ]);
  return {
    mode: "shared_fictional_demo",
    seedVersion,
    generatedAt: now.toISOString(),
    children,
    careParties,
    entries: entries.map((entry) => ({
      id: entry.id,
      startDateTime: entry.start_datetime,
      endDateTime: entry.end_datetime,
      status: entry.status as ApiEntryStatus,
      careScope: entry.care_scope as CareScope,
      overnight: booleanValue(entry.overnight),
      holiday: booleanValue(entry.holiday),
      additionalCare: booleanValue(entry.additional_care),
      childIds: childIdsByEntry.get(entry.id) ?? [],
      ...(entry.responsible_party_id
        ? { responsiblePartyId: entry.responsible_party_id }
        : {})
    }))
  };
}
