import { db } from "../db/connection.js";

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

export function getCareParty(id: string) {
  const row = db.prepare(`
    SELECT id, name, kind, created_by, updated_by, created_at, updated_at
    FROM care_parties
    WHERE id = ? AND deleted_at IS NULL
  `).get(id) as CarePartyRow | undefined;
  return row ? mapCareParty(row) : undefined;
}

export function assertActiveCareParty(id: string | undefined): void {
  if (!id) return;
  if (!getCareParty(id)) {
    throw new Error("Die ausgewählte betreuende Person existiert nicht.");
  }
}
