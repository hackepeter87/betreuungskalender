import type { RequestUser } from "../auth.js";
import type { DatabaseExecutor } from "../db/runtime.js";
import { getCareParty } from "./careParties.js";

export async function activeCarePartyAssignmentCount(
  database: DatabaseExecutor
): Promise<number> {
  const row = await database.selectFrom("app_user_care_party_assignments")
    .select(({ fn }) => fn.count<number>("id").as("count"))
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

export async function sharedCarePartyModeEnabled(
  database: DatabaseExecutor
): Promise<boolean> {
  return (await activeCarePartyAssignmentCount(database)) > 0;
}

export async function assignedCarePartyIds(
  userId: string,
  database: DatabaseExecutor
): Promise<string[]> {
  const rows = await database.selectFrom("app_user_care_party_assignments")
    .select("care_party_id")
    .where("user_id", "=", userId)
    .where("deleted_at", "is", null)
    .orderBy("care_party_id")
    .execute();
  return rows.map((row) => row.care_party_id);
}

export async function canUseCareParty(
  user: RequestUser,
  carePartyId: string,
  database: DatabaseExecutor
): Promise<boolean> {
  if (!(await getCareParty(carePartyId, database))) return false;
  if (user.role === "admin") return true;
  if (!(await sharedCarePartyModeEnabled(database))) return true;
  return (await assignedCarePartyIds(user.id, database)).includes(carePartyId);
}

export async function assertCanUseCareParty(
  user: RequestUser | undefined,
  carePartyId: string | undefined,
  database: DatabaseExecutor
): Promise<void> {
  if (!carePartyId) {
    if (user && user.role !== "admin" && await sharedCarePartyModeEnabled(database)) {
      throw new Error("Eine zugeordnete betreuende Person ist erforderlich.");
    }
    return;
  }
  if (!user) return;
  if (!(await canUseCareParty(user, carePartyId, database))) {
    throw new Error("Diese betreuende Person ist für deinen Benutzer nicht freigegeben.");
  }
}
