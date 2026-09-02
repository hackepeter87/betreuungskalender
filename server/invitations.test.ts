import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { permissionsForRole, type RequestUser } from "./auth.js";
import { migrateDatabase } from "./db/migrationRunner.js";
import { createSqlitePersistenceRuntime, type PersistenceRuntime } from "./db/runtime.js";
import {
  acceptInvitation,
  acceptInvitationByHash,
  createInvitation,
  InvitationError,
  prepareInvitationLogin,
  revokeInvitation
} from "./services/invitations.js";
import {
  InvitationEmailError,
  invitationEmailAvailable,
  invitationEmailText,
  invitationSenderAddress,
  invitationUrl,
  sendInvitationEmail,
  type InvitationEmailConfig
} from "./services/invitationEmail.js";
import { membershipRoleForUser } from "./services/memberships.js";

const migrationsDirectory = resolve(process.cwd(), "server/migrations");

async function withDatabase(
  run: (database: Database.Database, persistence: PersistenceRuntime) => Promise<void>
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "betreuungskalender-invitations-"));
  const database = new Database(join(root, "app.sqlite"));
  database.pragma("foreign_keys = ON");
  try {
    migrateDatabase(database, migrationsDirectory);
    await run(database, createSqlitePersistenceRuntime(database));
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function insertUser(database: Database.Database, id = "user_invited"): RequestUser {
  const timestamp = "2026-07-05T10:00:00.000Z";
  database.prepare(`
    INSERT INTO app_users (
      id, external_subject, email, display_name, role, groups_json,
      last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    `subject-${id}`,
    `${id}@example.invalid`,
    "Invited User",
    "readonly",
    "[]",
    timestamp,
    timestamp,
    timestamp
  );
  return {
    id,
    externalSubject: `subject-${id}`,
    email: `${id}@example.invalid`,
    displayName: "Invited User",
    groups: [],
    role: "readonly",
    permissions: permissionsForRole("readonly")
  };
}

test("valid invitations can be accepted by authenticated users", async () => {
  await withDatabase(async (database, persistence) => {
    const user = insertUser(database);
    const created = await createInvitation({
      role: "editor",
      emailHint: "USER_INVITED@EXAMPLE.INVALID",
      expiresAt: "2026-07-06T10:00:00.000Z",
      actorId: "local-dev",
      token: "test-token-valid-invitation-000000",
      timestamp: "2026-07-05T10:00:00.000Z"
    }, persistence.query);

    const accepted = await acceptInvitation(
      created.token,
      user,
      persistence,
      "2026-07-05T11:00:00.000Z"
    );

    assert.equal(accepted.id, created.invitation.id);
    assert.equal(accepted.role, "editor");
    assert.equal(accepted.emailHint, "user_invited@example.invalid");
    assert.equal(accepted.acceptedUserId, user.id);
    assert.equal(accepted.acceptedAt, "2026-07-05T11:00:00.000Z");
    assert.equal(await membershipRoleForUser(user.id, persistence.query), "editor");
  });
});

test("invitation acceptance rolls back user, membership, and token state after a late failure", async () => {
  await withDatabase(async (database, persistence) => {
    const user: RequestUser = {
      id: "user_rollback",
      externalSubject: "subject-user_rollback",
      email: "user_rollback@example.invalid",
      displayName: "Rollback User",
      groups: [],
      role: "readonly",
      permissions: permissionsForRole("readonly")
    };
    const created = await createInvitation({
      role: "editor",
      expiresAt: "2026-07-06T10:00:00.000Z",
      actorId: "local-dev",
      token: "test-token-rollback-invitation-000000",
      timestamp: "2026-07-05T10:00:00.000Z"
    }, persistence.query);
    database.exec(`
      CREATE TRIGGER reject_test_invitation_accept
      BEFORE UPDATE OF accepted_at ON app_invitations
      WHEN NEW.accepted_at IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'forced invitation failure');
      END
    `);

    await assert.rejects(
      acceptInvitation(created.token, user, persistence, "2026-07-05T11:00:00.000Z"),
      /forced invitation failure/
    );

    assert.equal(await membershipRoleForUser(user.id, persistence.query), undefined);
    const userCount = database.prepare(`
      SELECT COUNT(*) AS count
      FROM app_users
      WHERE id = ?
    `).get(user.id) as { count: number };
    assert.equal(userCount.count, 0);
    assert.deepEqual(database.prepare(`
      SELECT accepted_user_id AS acceptedUserId, accepted_at AS acceptedAt
      FROM app_invitations
      WHERE id = ?
    `).get(created.invitation.id), { acceptedUserId: null, acceptedAt: null });
  });
});

test("transfer-linked invitations apply only the selected role and proposed care parties", async () => {
  await withDatabase(async (database, persistence) => {
    const user = insertUser(database, "user_transferred");
    const timestamp = "2026-07-05T10:00:00.000Z";
    database.prepare(`
      INSERT INTO care_parties (id, name, kind, created_by, updated_by, created_at, updated_at)
      VALUES ('party-transfer', 'Care party', 'other', 'owner', 'owner', ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO data_transfer_runs (
        id, package_fingerprint, format_version, source_version, result,
        counts_json, warnings_json, created_by, created_at, imported_at
      ) VALUES ('run-transfer', ?, 1, '1.22.0', 'imported', '{}', '[]', 'owner', ?, ?)
    `).run("a".repeat(64), timestamp, timestamp);
    database.prepare(`
      INSERT INTO data_transfer_actors (
        id, transfer_run_id, source_ref, display_name, suggested_role,
        created_by, updated_by, created_at, updated_at
      ) VALUES ('actor-transfer', 'run-transfer', 'source-actor', 'Historical actor',
        'viewer', 'owner', 'owner', ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO data_transfer_actor_care_parties (
        actor_id, source_care_party_id, target_care_party_id, created_at, updated_at
      ) VALUES ('actor-transfer', 'source-party', 'party-transfer', ?, ?)
    `).run(timestamp, timestamp);
    const created = await createInvitation({
      role: "scheduler",
      expiresAt: "2026-07-06T10:00:00.000Z",
      actorId: "owner",
      token: "test-token-transfer-invitation-000000",
      timestamp,
      dataTransferActorId: "actor-transfer"
    }, persistence.query);

    await acceptInvitation(created.token, user, persistence, "2026-07-05T11:00:00.000Z");

    assert.equal(await membershipRoleForUser(user.id, persistence.query), "scheduler");
    assert.deepEqual(database.prepare(`
      SELECT care_party_id AS carePartyId
      FROM app_user_care_party_assignments
      WHERE user_id = ? AND deleted_at IS NULL
    `).all(user.id), [{ carePartyId: "party-transfer" }]);
    assert.equal((database.prepare("SELECT mapped_user_id AS mappedUserId FROM data_transfer_actors WHERE id = 'actor-transfer'").get() as { mappedUserId: string }).mappedUserId, user.id);
  });
});

test("invitation login uses a hash and accepts after authentication", async () => {
  await withDatabase(async (database, persistence) => {
    const user = insertUser(database);
    const created = await createInvitation({
      role: "editor",
      expiresAt: "2026-07-06T10:00:00.000Z",
      actorId: "local-dev",
      token: "test-token-login-flow-000000",
      timestamp: "2026-07-05T10:00:00.000Z"
    }, persistence.query);

    const hash = await prepareInvitationLogin(
      created.token,
      persistence.query,
      "2026-07-05T10:30:00.000Z"
    );
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.notEqual(hash, created.token);

    const accepted = await acceptInvitationByHash(
      hash,
      user,
      persistence,
      "2026-07-05T11:00:00.000Z"
    );
    assert.equal(accepted.acceptedUserId, user.id);
    assert.equal(await membershipRoleForUser(user.id, persistence.query), "editor");
  });
});

test("raw invitation tokens are not persisted", async () => {
  await withDatabase(async (database, persistence) => {
    const rawToken = "test-token-never-persisted-000000";
    const created = await createInvitation({
      role: "viewer",
      expiresAt: "2026-07-06T10:00:00.000Z",
      actorId: "local-dev",
      token: rawToken,
      timestamp: "2026-07-05T10:00:00.000Z"
    }, persistence.query);

    const row = database.prepare(`
      SELECT token_hash AS tokenHash
      FROM app_invitations
      WHERE id = ?
    `).get(created.invitation.id) as { tokenHash: string };

    assert.notEqual(row.tokenHash, rawToken);
    assert.match(row.tokenHash, /^[a-f0-9]{64}$/);
    const rawMatches = database.prepare(`
      SELECT COUNT(*) AS count
      FROM app_invitations
      WHERE token_hash = ?
    `).get(rawToken) as { count: number };
    assert.equal(rawMatches.count, 0);
  });
});

test("expired invitations cannot be accepted", async () => {
  await withDatabase(async (database, persistence) => {
    const user = insertUser(database);
    const created = await createInvitation({
      role: "editor",
      expiresAt: "2026-07-05T10:00:00.000Z",
      actorId: "local-dev",
      token: "test-token-expired-invitation-000000",
      timestamp: "2026-07-05T09:00:00.000Z"
    }, persistence.query);

    await assert.rejects(
      acceptInvitation(created.token, user, persistence, "2026-07-05T10:00:00.000Z"),
      (error) =>
        error instanceof InvitationError &&
        error.code === "invitation_expired" &&
        error.statusCode === 410
    );
    assert.equal(await membershipRoleForUser(user.id, persistence.query), undefined);
  });
});

test("revoked invitations cannot be accepted", async () => {
  await withDatabase(async (database, persistence) => {
    const user = insertUser(database);
    const created = await createInvitation({
      role: "admin",
      expiresAt: "2026-07-06T10:00:00.000Z",
      actorId: "local-dev",
      token: "test-token-revoked-invitation-000000",
      timestamp: "2026-07-05T09:00:00.000Z"
    }, persistence.query);
    const revoked = await revokeInvitation(
      created.invitation.id,
      "local-dev",
      persistence.query,
      "2026-07-05T09:30:00.000Z"
    );

    assert.equal(revoked?.revokedAt, "2026-07-05T09:30:00.000Z");
    await assert.rejects(
      acceptInvitation(created.token, user, persistence, "2026-07-05T10:00:00.000Z"),
      (error) =>
        error instanceof InvitationError &&
        error.code === "invitation_revoked" &&
        error.statusCode === 410
    );
    assert.equal(await membershipRoleForUser(user.id, persistence.query), undefined);
  });
});

test("accepted invitations cannot be reused", async () => {
  await withDatabase(async (database, persistence) => {
    const firstUser = insertUser(database, "user_first");
    const secondUser = insertUser(database, "user_second");
    const created = await createInvitation({
      role: "editor",
      expiresAt: "2026-07-06T10:00:00.000Z",
      actorId: "local-dev",
      token: "test-token-single-use-invitation-000000",
      timestamp: "2026-07-05T09:00:00.000Z"
    }, persistence.query);

    await acceptInvitation(created.token, firstUser, persistence, "2026-07-05T10:00:00.000Z");

    await assert.rejects(
      acceptInvitation(created.token, secondUser, persistence, "2026-07-05T10:05:00.000Z"),
      (error) =>
        error instanceof InvitationError &&
        error.code === "invitation_already_accepted" &&
        error.statusCode === 409
    );
    assert.equal(await membershipRoleForUser(firstUser.id, persistence.query), "editor");
    assert.equal(await membershipRoleForUser(secondUser.id, persistence.query), undefined);
  });
});

test("invitation email delivery uses a provider-neutral test transport", async () => {
  const sent: Array<{ from: string; to: string; subject: string; text: string }> = [];
  const mailConfig: InvitationEmailConfig = {
    invitationEmailEnabled: true,
    invitationPublicBaseUrl: "https://bk.example.test",
    smtpHost: "smtp.example.test",
    smtpPort: 587,
    smtpSecure: false,
    smtpFrom: "Betreuungskalender <no-reply@example.test>"
  };

  await sendInvitationEmail(
    {
      to: "invited@example.test",
      token: "test-token-mail-delivery-000000",
      role: "editor",
      expiresAt: "2026-07-06T10:00:00.000Z"
    },
    mailConfig,
    () => ({
      sendMail: (message) => {
        sent.push(message);
      }
    })
  );

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.from, "Betreuungskalender <no-reply@example.test>");
  assert.equal(sent[0]?.to, "invited@example.test");
  assert.equal(sent[0]?.subject, "Einladung zum Betreuungskalender");
  assert.match(sent[0]?.text ?? "", /https:\/\/bk\.example\.test\/invite\?token=test-token-mail-delivery-000000/);
  assert.match(sent[0]?.text ?? "", /Rolle: Bearbeiten/);
});

test("manual and email invitations use the same complete link", () => {
  const input = {
    token: "test-token-link-equality-000000",
    role: "scheduler" as const,
    expiresAt: "2026-07-06T10:00:00.000Z"
  };
  const baseUrl = "https://bk.example.test/base-path";
  const publicUrl = invitationUrl(input.token, baseUrl);

  assert.equal(
    publicUrl,
    "https://bk.example.test/invite?token=test-token-link-equality-000000"
  );
  assert.equal(invitationEmailText(input, baseUrl).split("\n").includes(publicUrl), true);
});

test("invitation email capability requires enabled host and sender configuration", () => {
  assert.equal(invitationEmailAvailable({
    invitationEmailEnabled: true,
    invitationPublicBaseUrl: "https://bk.example.test",
    smtpHost: "smtp.example.test",
    smtpPort: 587,
    smtpSecure: false,
    smtpFrom: "no-reply@example.test"
  }), true);
  assert.equal(invitationEmailAvailable({
    invitationEmailEnabled: false,
    invitationPublicBaseUrl: "https://bk.example.test",
    smtpHost: "smtp.example.test",
    smtpPort: 587,
    smtpSecure: false,
    smtpFrom: "no-reply@example.test"
  }), false);
});

test("invitation email delivery can use the installation label as sender display name", async () => {
  const sent: Array<{ from: string; to: string; subject: string; text: string }> = [];
  const mailConfig: InvitationEmailConfig = {
    invitationEmailEnabled: true,
    invitationPublicBaseUrl: "https://bk.example.test",
    smtpHost: "smtp.example.test",
    smtpPort: 587,
    smtpSecure: false,
    smtpFrom: "no-reply@example.test",
    smtpFromName: "Familienkalender"
  };

  await sendInvitationEmail(
    {
      to: "invited@example.test",
      token: "test-token-mail-display-name-000000",
      role: "viewer",
      expiresAt: "2026-07-06T10:00:00.000Z"
    },
    mailConfig,
    () => ({
      sendMail: (message) => {
        sent.push(message);
      }
    })
  );

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.from, "\"Familienkalender\" <no-reply@example.test>");
});

test("invitation sender display name is safe for mail headers", () => {
  const from = invitationSenderAddress(
    "Betreuungskalender <no-reply@example.test>",
    "Familie\nKalender \"Demo\""
  );

  assert.equal(from, "\"Familie Kalender \\\"Demo\\\"\" <no-reply@example.test>");
  assert.doesNotMatch(from, /[\r\n]/);
});

test("invitation email delivery reports missing or failed mail configuration safely", async () => {
  await assert.rejects(
    () => sendInvitationEmail({
      to: "invited@example.test",
      token: "test-token-mail-missing-config-000000",
      role: "viewer",
      expiresAt: "2026-07-06T10:00:00.000Z"
    }, {
      invitationEmailEnabled: false,
      invitationPublicBaseUrl: "https://bk.example.test",
      smtpPort: 587,
      smtpSecure: false
    }),
    (error) =>
      error instanceof InvitationEmailError &&
      error.code === "mail_not_configured" &&
      !error.message.includes("smtp.example.test")
  );

  await assert.rejects(
    () => sendInvitationEmail(
      {
        to: "invited@example.test",
        token: "test-token-mail-failure-000000",
        role: "admin",
        expiresAt: "2026-07-06T10:00:00.000Z"
      },
      {
        invitationEmailEnabled: true,
        invitationPublicBaseUrl: "https://bk.example.test",
        smtpHost: "smtp.example.test",
        smtpPort: 587,
        smtpSecure: true,
        smtpUser: "smtp-user",
        smtpPassword: "smtp-secret",
        smtpFrom: "no-reply@example.test"
      },
      () => ({
        sendMail: () => {
          throw new Error("smtp-secret at smtp.example.test");
        }
      })
    ),
    (error) =>
      error instanceof InvitationEmailError &&
      error.code === "mail_delivery_failed" &&
      !error.message.includes("smtp-secret") &&
      !error.message.includes("smtp.example.test")
  );
});
