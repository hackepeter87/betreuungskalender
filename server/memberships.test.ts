import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { permissionsForRole, type RequestUser } from "./auth.js";
import { migrateDatabase } from "./db/migrationRunner.js";
import { applyMembershipRole, hasWorkspaceAccess, membershipRoleForUser } from "./services/memberships.js";
import { findAuthenticatedUserBySubject } from "./services/users.js";

const timestamp = "2026-07-05T10:00:00.000Z";

function withDatabase(run: (database: Database.Database) => void): void {
  const root = mkdtempSync(join(tmpdir(), "betreuungskalender-memberships-"));
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

function insertMembership(database: Database.Database, userId: string, role: string): void {
  database.prepare(`
    INSERT INTO app_memberships (
      id, user_id, role, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    `membership-${userId}`,
    userId,
    role,
    "tester",
    "tester",
    timestamp,
    timestamp
  );
}

function setOwner(database: Database.Database, userId: string): void {
  database.prepare(`
    INSERT INTO settings (key, value_json, created_by, updated_by, created_at, updated_at)
    VALUES ('setup.ownerUserId', ?, 'tester', 'tester', ?, ?)
  `).run(JSON.stringify(userId), timestamp, timestamp);
}

test("active app membership overrides the identity-provider derived role", () => {
  withDatabase((database) => {
    database.prepare(`
      UPDATE app_memberships
      SET role = 'viewer', updated_at = ?
      WHERE user_id = 'local-dev' AND deleted_at IS NULL
    `).run(timestamp);

    const user = findAuthenticatedUserBySubject("local-dev", database);

    assert.equal(user?.role, "readonly");
    assert.deepEqual(user?.permissions, permissionsForRole("readonly"));
    assert.equal(membershipRoleForUser("local-dev", database), "viewer");
  });
});

test("users without app membership keep their claim-derived role before ownership is configured", () => {
  const user: RequestUser = {
    id: "user-parent",
    externalSubject: "subject-parent",
    displayName: "Parent",
    groups: ["/betreuungskalender/parents"],
    role: "parent",
    permissions: permissionsForRole("parent")
  };

  withDatabase((database) => {
    const resolved = applyMembershipRole(user, database);

    assert.equal(resolved.membershipRole, undefined);
    assert.equal(resolved.user.role, "parent");
    assert.deepEqual(resolved.user.permissions, permissionsForRole("parent"));
  });
});

test("users without an active membership lose workspace access after ownership is configured", () => {
  const user: RequestUser = {
    id: "user-without-membership",
    externalSubject: "subject-without-membership",
    displayName: "No membership",
    groups: ["/betreuungskalender/admins"],
    role: "admin",
    permissions: permissionsForRole("admin")
  };

  withDatabase((database) => {
    setOwner(database, "different-owner");
    const resolved = applyMembershipRole(user, database);

    assert.equal(resolved.membershipState, "none");
    assert.equal(resolved.workspaceAccess, false);
    assert.equal(resolved.user.workspaceAccess, false);
    assert.deepEqual(resolved.user.workspacePermissions, []);
    assert.equal(hasWorkspaceAccess(user.id, database), false);
  });
});

test("a deleted membership is authoritative and never falls back to identity claims", () => {
  const user: RequestUser = {
    id: "user-revoked",
    externalSubject: "subject-revoked",
    displayName: "Revoked",
    groups: ["/betreuungskalender/admins"],
    role: "admin",
    permissions: permissionsForRole("admin")
  };

  withDatabase((database) => {
    database.prepare(`
      INSERT INTO app_users (
        id, external_subject, display_name, role, groups_json,
        last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'admin', '[]', ?, ?, ?)
    `).run(user.id, user.externalSubject, user.displayName, timestamp, timestamp, timestamp);
    insertMembership(database, user.id, "admin");
    database.prepare(`
      UPDATE app_memberships
      SET deleted_at = ?, updated_at = ?
      WHERE user_id = ?
    `).run(timestamp, timestamp, user.id);
    const resolved = applyMembershipRole(user, database);

    assert.equal(resolved.membershipState, "revoked");
    assert.equal(resolved.workspaceAccess, false);
    assert.equal(resolved.user.workspaceAccess, false);
    assert.deepEqual(resolved.user.permissions, []);
    assert.deepEqual(resolved.user.workspacePermissions, []);
    assert.equal(hasWorkspaceAccess(user.id, database), false);
  });
});
