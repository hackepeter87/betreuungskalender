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
  database: PersistenceRuntime,
  timestamp = new Date().toISOString()
): Promise<void> {
  await database.transaction(async (transaction) => {
    const technicalIdentityExists = await transaction.one(`
      SELECT 1 FROM app_users
      WHERE id = ? AND external_subject = ? AND display_name = ?
      LIMIT 1
    `, [localDevelopmentUserId, localDevelopmentUserId, localDevelopmentUserId]);
    if (!technicalIdentityExists) return;

    const explicitLocalOwner = await transaction.one(`
      SELECT 1 FROM settings
      WHERE key = 'setup.ownerUserId'
        AND deleted_at IS NULL
        AND value_json = ?
      LIMIT 1
    `, [JSON.stringify(localDevelopmentUserId)]);
    if (explicitLocalOwner) return;

    await transaction.run(`
      UPDATE app_memberships
      SET deleted_at = COALESCE(deleted_at, ?),
          updated_by = 'runtime-access-cleanup', updated_at = ?
      WHERE user_id = ? AND deleted_at IS NULL
    `, [timestamp, timestamp, localDevelopmentUserId]);
    await transaction.run(`
      UPDATE app_user_care_party_assignments
      SET deleted_at = COALESCE(deleted_at, ?),
          updated_by = 'runtime-access-cleanup', updated_at = ?
      WHERE user_id = ? AND deleted_at IS NULL
    `, [timestamp, timestamp, localDevelopmentUserId]);
    await transaction.run(`
      UPDATE calendar_feed_tokens
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE user_id = ? AND revoked_at IS NULL
    `, [timestamp, localDevelopmentUserId]);
    await transaction.run(`
      UPDATE push_subscriptions
      SET deleted_at = COALESCE(deleted_at, ?), updated_at = ?
      WHERE user_id = ? AND deleted_at IS NULL
    `, [timestamp, timestamp, localDevelopmentUserId]);
    await transaction.run(`
      UPDATE care_confirmation_requests
      SET deleted_at = COALESCE(deleted_at, ?), updated_at = ?
      WHERE user_id = ? AND deleted_at IS NULL AND answered_at IS NULL
    `, [timestamp, timestamp, localDevelopmentUserId]);
  });
}
