import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { permissionsForRole, type RequestUser } from "./auth.js";
import { migrateDatabase } from "./db/migrationRunner.js";
import { applyMembershipRole, membershipRoleForUser } from "./services/memberships.js";
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

test("active app membership overrides the identity-provider derived role", () => {
  withDatabase((database) => {
    insertMembership(database, "local-dev", "readonly");

    const user = findAuthenticatedUserBySubject("local-dev", database);

    assert.equal(user?.role, "readonly");
    assert.deepEqual(user?.permissions, permissionsForRole("readonly"));
    assert.equal(membershipRoleForUser("local-dev", database), "readonly");
  });
});

test("users without app membership keep their claim-derived role", () => {
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
