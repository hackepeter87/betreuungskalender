import type { PersistenceRuntime } from "../db/runtime.js";

export const localDevelopmentUserId = "local-dev";

export function isLocalDevelopmentIdentity(user: {
  id: string;
  externalSubject: string;
  displayName: string;
}): boolean {
  return user.id === localDevelopmentUserId &&
    user.externalSubject === localDevelopmentUserId &&
    user.displayName === localDevelopmentUserId;
}

export async function disableLocalDevelopmentIdentityAccess(
  persistence: PersistenceRuntime,
  timestamp = new Date().toISOString()
): Promise<void> {
  await persistence.transaction(async (database) => {
    const technicalIdentityExists = await database.selectFrom("app_users")
      .select("id")
      .where("id", "=", localDevelopmentUserId)
      .where("external_subject", "=", localDevelopmentUserId)
      .where("display_name", "=", localDevelopmentUserId)
      .executeTakeFirst();
    if (!technicalIdentityExists) return;

    const explicitLocalOwner = await database.selectFrom("settings")
      .select("key")
      .where("key", "=", "setup.ownerUserId")
      .where("deleted_at", "is", null)
      .where("value_json", "=", JSON.stringify(localDevelopmentUserId))
      .executeTakeFirst();
    if (explicitLocalOwner) return;

    await database.updateTable("app_memberships")
      .set({ deleted_at: timestamp, updated_by: "runtime-access-cleanup", updated_at: timestamp })
      .where("user_id", "=", localDevelopmentUserId)
      .where("deleted_at", "is", null)
      .execute();
    await database.updateTable("app_user_care_party_assignments")
      .set({ deleted_at: timestamp, updated_by: "runtime-access-cleanup", updated_at: timestamp })
      .where("user_id", "=", localDevelopmentUserId)
      .where("deleted_at", "is", null)
      .execute();
    await database.updateTable("calendar_feed_tokens")
      .set({ revoked_at: timestamp })
      .where("user_id", "=", localDevelopmentUserId)
      .where("revoked_at", "is", null)
      .execute();
    await database.updateTable("push_subscriptions")
      .set({ deleted_at: timestamp, updated_at: timestamp })
      .where("user_id", "=", localDevelopmentUserId)
      .where("deleted_at", "is", null)
      .execute();
    await database.updateTable("care_confirmation_requests")
      .set({ deleted_at: timestamp, updated_at: timestamp })
      .where("user_id", "=", localDevelopmentUserId)
      .where("deleted_at", "is", null)
      .where("answered_at", "is", null)
      .execute();
  });
}
