import type { RequestUser } from "../auth.js";
import { db } from "../db/connection.js";
import { getCareParty } from "./careParties.js";

export function activeCarePartyAssignmentCount(): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM app_user_care_party_assignments
    WHERE deleted_at IS NULL
  `).get() as { count: number };
  return row.count;
}

export function sharedCarePartyModeEnabled(): boolean {
  return activeCarePartyAssignmentCount() > 0;
}

export function assignedCarePartyIds(userId: string): string[] {
  return (db.prepare(`
    SELECT care_party_id AS carePartyId
    FROM app_user_care_party_assignments
    WHERE user_id = ? AND deleted_at IS NULL
    ORDER BY care_party_id
  `).all(userId) as Array<{ carePartyId: string }>).map((row) => row.carePartyId);
}

export function canUseCareParty(user: RequestUser, carePartyId: string): boolean {
  if (!getCareParty(carePartyId)) return false;
  if (user.role === "admin") return true;
  if (!sharedCarePartyModeEnabled()) return true;
  return assignedCarePartyIds(user.id).includes(carePartyId);
}

export function assertCanUseCareParty(
  user: RequestUser | undefined,
  carePartyId: string | undefined
): void {
  if (!carePartyId) {
    if (user && user.role !== "admin" && sharedCarePartyModeEnabled()) {
      throw new Error("Eine zugeordnete betreuende Person ist erforderlich.");
    }
    return;
  }
  if (!user) return;
  if (!canUseCareParty(user, carePartyId)) {
    throw new Error("Diese betreuende Person ist für deinen Benutzer nicht freigegeben.");
  }
}
