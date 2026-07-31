import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { permissionsForRole, type AuthRole, type RequestUser } from "./auth.js";
import { migrateDatabase } from "./db/migrationRunner.js";
import {
  canAdministerMembers,
  listMembers,
  MemberManagementError,
  removeMember,
  updateMemberRole
} from "./services/memberManagement.js";
import { membershipRoleForUser } from "./services/memberships.js";

const timestamp = "2026-07-05T10:00:00.000Z";

function withDatabase(run: (database: Database.Database) => void): void {
  const root = mkdtempSync(join(tmpdir(), "betreuungskalender-member-management-"));
  const database = new Database(join(root, "app.sqlite"));
  database.pragma("foreign_keys = ON");
  try {
    migrateDatabase(database);
    run(database);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function user(id: string, role: AuthRole): RequestUser {
  return {
    id,
    externalSubject: id,
    email: `${id}@example.invalid`,
    displayName: id,
    groups: [],
    role,
    permissions: permissionsForRole(role)
  };
}

function insertUser(database: Database.Database, actor: RequestUser): void {
  database.prepare(`
    INSERT INTO app_users (
      id, external_subject, email, display_name, role, groups_json,
      last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?)
  `).run(
    actor.id,
    actor.externalSubject,
    actor.email ?? null,
    actor.displayName,
    actor.role,
    timestamp,
    timestamp,
    timestamp
  );
}

function setOwner(database: Database.Database, ownerId: string): void {
  database.prepare(`
    INSERT INTO settings (key, value_json, created_by, updated_by, created_at, updated_at)
    VALUES ('setup.ownerUserId', ?, ?, ?, ?, ?)
  `).run(JSON.stringify(ownerId), ownerId, ownerId, timestamp, timestamp);
}

test("explicit installation owner can update another member role", () => {
  withDatabase((database) => {
    const owner = user("user_owner", "admin");
    const invited = user("user_invited", "readonly");
    insertUser(database, owner);
    insertUser(database, invited);
    setOwner(database, owner.id);

    const updated = updateMemberRole(
      owner,
      invited.id,
      "editor",
      "2026-07-05T11:00:00.000Z",
      database
    );

    assert.equal(updated.id, invited.id);
    assert.equal(updated.effectiveRole, "editor");
    assert.equal(updated.membershipRole, "editor");
    assert.equal(membershipRoleForUser(invited.id, database), "editor");
    assert.deepEqual(database.prepare(`
      SELECT user_email AS userEmail, entity_type AS entityType, entity_id AS entityId,
        field_name AS fieldName, new_value AS newValue
      FROM audit_log
      WHERE entity_type = 'app_member'
    `).get(), {
      userEmail: owner.id,
      entityType: "app_member",
      entityId: invited.id,
      fieldName: "membershipRole",
      newValue: "\"editor\""
    });
  });
});

test("non-owners cannot administer members when an owner is configured", () => {
  withDatabase((database) => {
    const owner = user("user_owner", "admin");
    const otherAdmin = user("user_other_admin", "admin");
    const target = user("user_target", "readonly");
    insertUser(database, owner);
    insertUser(database, otherAdmin);
    insertUser(database, target);
    setOwner(database, owner.id);

    assert.equal(canAdministerMembers(otherAdmin, database), false);
    assert.throws(
      () => updateMemberRole(otherAdmin, target.id, "editor", timestamp, database),
      (error) =>
        error instanceof MemberManagementError &&
        error.code === "member_admin_required" &&
        error.statusCode === 403
    );
    assert.equal(membershipRoleForUser(target.id, database), undefined);
  });
});

test("admin fallback can administer members before an explicit owner exists", () => {
  withDatabase((database) => {
    const admin = user("user_admin", "admin");
    const target = user("user_target", "readonly");
    insertUser(database, admin);
    insertUser(database, target);

    assert.equal(canAdministerMembers(admin, database), true);
    updateMemberRole(admin, target.id, "editor", timestamp, database);

    assert.equal(membershipRoleForUser(target.id, database), "editor");
  });
});

test("users cannot change their own role through member management", () => {
  withDatabase((database) => {
    const owner = user("user_owner", "admin");
    insertUser(database, owner);
    setOwner(database, owner.id);

    assert.throws(
      () => updateMemberRole(owner, owner.id, "viewer", timestamp, database),
      (error) =>
        error instanceof MemberManagementError &&
        error.code === "self_role_change_rejected" &&
        error.statusCode === 400
    );
    assert.equal(membershipRoleForUser(owner.id, database), undefined);
  });
});

test("member listing exposes claim and effective roles without tokens", () => {
  withDatabase((database) => {
    const admin = user("user_admin", "admin");
    const target = user("user_target", "readonly");
    insertUser(database, admin);
    insertUser(database, target);
    updateMemberRole(admin, target.id, "editor", timestamp, database);

    const members = listMembers(database);
    const listed = members.find((member) => member.id === target.id);

    assert.equal(listed?.claimRole, "readonly");
    assert.equal(listed?.membershipRole, "editor");
    assert.equal(listed?.effectiveRole, "editor");
    assert.equal("token" in (listed ?? {}), false);
  });
});

test("owner can remove another member app role without deleting the user", () => {
  withDatabase((database) => {
    const owner = user("user_owner", "admin");
    const target = user("user_target", "readonly");
    insertUser(database, owner);
    insertUser(database, target);
    setOwner(database, owner.id);
    updateMemberRole(owner, target.id, "editor", timestamp, database);
    database.prepare(`
      INSERT INTO calendar_feed_tokens (
        id, user_id, token_hash, created_at, scope_type
      ) VALUES ('feed-target', ?, 'feed-hash-target', ?, 'all')
    `).run(target.id, timestamp);
    database.prepare(`
      INSERT INTO push_subscriptions (
        id, user_id, endpoint, p256dh, auth, created_at, updated_at
      ) VALUES ('push-target', ?, 'https://push.example.invalid/subscription', 'key', 'auth', ?, ?)
    `).run(target.id, timestamp, timestamp);
    database.prepare(`
      INSERT INTO care_entries (
        id, start_datetime, end_datetime, status, care_scope,
        duration_minutes, created_by, updated_by, created_at, updated_at
      ) VALUES (
        'entry-target', '2026-07-04T16:00:00.000Z', '2026-07-04T18:00:00.000Z',
        'planned', 'hourly', 120, ?, ?, ?, ?
      )
    `).run(owner.id, owner.id, timestamp, timestamp);
    database.prepare(`
      INSERT INTO care_confirmation_requests (
        id, care_entry_id, user_id, due_at, status, reminder_count, created_at, updated_at
      ) VALUES ('confirmation-target', 'entry-target', ?, ?, 'open', 0, ?, ?)
    `).run(target.id, timestamp, timestamp, timestamp);

    const updated = removeMember(owner, target.id, "2026-07-05T12:00:00.000Z", database);

    assert.equal(updated.id, target.id);
    assert.equal(updated.membershipRole, undefined);
    assert.equal(updated.effectiveRole, "editor");
    assert.equal(updated.workspaceAccess, false);
    assert.equal(membershipRoleForUser(target.id, database), undefined);
    const remainingUser = database.prepare(
      "SELECT COUNT(*) AS count FROM app_users WHERE id = ?"
    ).get(target.id) as { count: number };
    assert.equal(remainingUser.count, 1);
    assert.deepEqual(database.prepare(`
      SELECT revoked_at AS revokedAt
      FROM calendar_feed_tokens
      WHERE id = 'feed-target'
    `).get(), { revokedAt: "2026-07-05T12:00:00.000Z" });
    assert.deepEqual(database.prepare(`
      SELECT deleted_at AS deletedAt
      FROM push_subscriptions
      WHERE id = 'push-target'
    `).get(), { deletedAt: "2026-07-05T12:00:00.000Z" });
    assert.deepEqual(database.prepare(`
      SELECT deleted_at AS deletedAt
      FROM care_confirmation_requests
      WHERE id = 'confirmation-target'
    `).get(), { deletedAt: "2026-07-05T12:00:00.000Z" });
    assert.deepEqual(database.prepare(`
      SELECT field_name AS fieldName, old_value AS oldValue, new_value AS newValue
      FROM audit_log
      WHERE entity_type = 'app_member'
      ORDER BY timestamp DESC
      LIMIT 1
    `).get(), {
      fieldName: "membershipRole",
      oldValue: "\"editor\"",
      newValue: "null"
    });
  });
});

test("role downgrade revokes feeds and unanswered care confirmations", () => {
  withDatabase((database) => {
    const owner = user("user_owner", "admin");
    const target = user("user_target", "parent");
    insertUser(database, owner);
    insertUser(database, target);
    setOwner(database, owner.id);
    updateMemberRole(owner, target.id, "editor", timestamp, database);
    database.prepare(`
      INSERT INTO calendar_feed_tokens (
        id, user_id, token_hash, created_at, scope_type
      ) VALUES ('feed-downgrade', ?, 'feed-hash-downgrade', ?, 'all')
    `).run(target.id, timestamp);
    database.prepare(`
      INSERT INTO care_entries (
        id, start_datetime, end_datetime, status, care_scope,
        duration_minutes, created_by, updated_by, created_at, updated_at
      ) VALUES (
        'entry-downgrade', '2026-07-04T16:00:00.000Z', '2026-07-04T18:00:00.000Z',
        'planned', 'hourly', 120, ?, ?, ?, ?
      )
    `).run(owner.id, owner.id, timestamp, timestamp);
    database.prepare(`
      INSERT INTO care_confirmation_requests (
        id, care_entry_id, user_id, due_at, status, reminder_count, created_at, updated_at
      ) VALUES ('confirmation-downgrade', 'entry-downgrade', ?, ?, 'open', 0, ?, ?)
    `).run(target.id, timestamp, timestamp, timestamp);

    updateMemberRole(owner, target.id, "scheduler", "2026-07-05T12:00:00.000Z", database);

    assert.deepEqual(database.prepare(`
      SELECT revoked_at AS revokedAt FROM calendar_feed_tokens WHERE id = 'feed-downgrade'
    `).get(), { revokedAt: "2026-07-05T12:00:00.000Z" });
    assert.deepEqual(database.prepare(`
      SELECT deleted_at AS deletedAt FROM care_confirmation_requests WHERE id = 'confirmation-downgrade'
    `).get(), { deletedAt: "2026-07-05T12:00:00.000Z" });
  });
});

test("users cannot remove their own membership through member management", () => {
  withDatabase((database) => {
    const owner = user("user_owner", "admin");
    insertUser(database, owner);
    setOwner(database, owner.id);

    assert.throws(
      () => removeMember(owner, owner.id, timestamp, database),
      (error) =>
        error instanceof MemberManagementError &&
        error.code === "self_remove_rejected" &&
        error.statusCode === 400
    );
  });
});
