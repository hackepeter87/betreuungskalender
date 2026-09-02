import type { DatabaseExecutor } from "../db/runtime.js";

export interface CarePartyRow {
  id: string;
  name: string;
  kind: "father" | "mother" | "grandparent" | "foster_caregiver" | "other";
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export function mapCareParty(row: CarePartyRow) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function getCareParty(
  id: string,
  database: DatabaseExecutor
) {
  const row = await database.selectFrom("care_parties")
    .select(["id", "name", "kind", "created_by", "updated_by", "created_at", "updated_at"])
    .where("id", "=", id)
    .where("deleted_at", "is", null)
    .executeTakeFirst() as CarePartyRow | undefined;
  return row ? mapCareParty(row) : undefined;
}

export async function assertActiveCareParty(
  id: string | undefined,
  database: DatabaseExecutor
): Promise<void> {
  if (!id) return;
  if (!(await getCareParty(id, database))) {
    throw new Error("Die ausgewählte betreuende Person existiert nicht.");
  }
}
