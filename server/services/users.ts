import { db } from "../db/connection.js";
import type { RequestUser } from "../auth.js";

export function upsertAuthenticatedUser(user: RequestUser, timestamp = new Date().toISOString()): void {
  db.prepare(`
    INSERT INTO app_users (
      id, external_subject, email, display_name, role, groups_json,
      last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(external_subject) DO UPDATE SET
      email = excluded.email,
      display_name = excluded.display_name,
      role = excluded.role,
      groups_json = excluded.groups_json,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `).run(
    user.id,
    user.externalSubject,
    user.email ?? null,
    user.displayName,
    user.role,
    JSON.stringify(user.groups),
    timestamp,
    timestamp,
    timestamp
  );
}
