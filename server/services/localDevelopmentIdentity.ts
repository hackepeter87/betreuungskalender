import type Database from "better-sqlite3";

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

export function disableLocalDevelopmentIdentityAccess(
  database: Database.Database,
  timestamp = new Date().toISOString()
): void {
  database.transaction(() => {
    const technicalIdentityExists = database.prepare(`
      SELECT 1 FROM app_users
      WHERE id = ? AND external_subject = ? AND display_name = ?
      LIMIT 1
    `).get(localDevelopmentUserId, localDevelopmentUserId, localDevelopmentUserId);
    if (!technicalIdentityExists) return;

    const explicitLocalOwner = database.prepare(`
      SELECT 1 FROM settings
      WHERE key = 'setup.ownerUserId'
        AND deleted_at IS NULL
        AND value_json = ?
      LIMIT 1
    `).get(JSON.stringify(localDevelopmentUserId));
    if (explicitLocalOwner) return;

    database.prepare(`
      UPDATE app_memberships
      SET deleted_at = COALESCE(deleted_at, ?),
          updated_by = 'runtime-access-cleanup', updated_at = ?
      WHERE user_id = ? AND deleted_at IS NULL
    `).run(timestamp, timestamp, localDevelopmentUserId);
    database.prepare(`
      UPDATE app_user_care_party_assignments
      SET deleted_at = COALESCE(deleted_at, ?),
          updated_by = 'runtime-access-cleanup', updated_at = ?
      WHERE user_id = ? AND deleted_at IS NULL
    `).run(timestamp, timestamp, localDevelopmentUserId);
    database.prepare(`
      UPDATE calendar_feed_tokens
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE user_id = ? AND revoked_at IS NULL
    `).run(timestamp, localDevelopmentUserId);
    database.prepare(`
      UPDATE push_subscriptions
      SET deleted_at = COALESCE(deleted_at, ?), updated_at = ?
      WHERE user_id = ? AND deleted_at IS NULL
    `).run(timestamp, timestamp, localDevelopmentUserId);
    database.prepare(`
      UPDATE care_confirmation_requests
      SET deleted_at = COALESCE(deleted_at, ?), updated_at = ?
      WHERE user_id = ? AND deleted_at IS NULL AND answered_at IS NULL
    `).run(timestamp, timestamp, localDevelopmentUserId);
  })();
}
