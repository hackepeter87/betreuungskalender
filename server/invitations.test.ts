import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { permissionsForRole, type RequestUser } from "./auth.js";
import { migrateDatabase } from "./db/migrationRunner.js";
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
  invitationSenderAddress,
  sendInvitationEmail,
  type InvitationEmailConfig
} from "./services/invitationEmail.js";
import { membershipRoleForUser } from "./services/memberships.js";

const migrationsDirectory = resolve(process.cwd(), "server/migrations");

function withDatabase(run: (database: Database.Database) => void): void {
  const root = mkdtempSync(join(tmpdir(), "betreuungskalender-invitations-"));
  const database = new Database(join(root, "app.sqlite"));
  database.pragma("foreign_keys = ON");
  try {
    migrateDatabase(database, migrationsDirectory);
    run(database);
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

test("valid invitations can be accepted by authenticated users", () => {
  withDatabase((database) => {
    const user = insertUser(database);
    const created = createInvitation({
      role: "parent",
      emailHint: "USER_INVITED@EXAMPLE.INVALID",
      expiresAt: "2026-07-06T10:00:00.000Z",
      actorId: "local-dev",
      token: "test-token-valid-invitation-000000",
      timestamp: "2026-07-05T10:00:00.000Z"
    }, database);

    const accepted = acceptInvitation(
      created.token,
      user,
      "2026-07-05T11:00:00.000Z",
      database
    );

    assert.equal(accepted.id, created.invitation.id);
    assert.equal(accepted.role, "parent");
    assert.equal(accepted.emailHint, "user_invited@example.invalid");
    assert.equal(accepted.acceptedUserId, user.id);
    assert.equal(accepted.acceptedAt, "2026-07-05T11:00:00.000Z");
    assert.equal(membershipRoleForUser(user.id, database), "parent");
  });
});

test("invitation login uses a hash and accepts after authentication", () => {
  withDatabase((database) => {
    const user = insertUser(database);
    const created = createInvitation({
      role: "parent",
      expiresAt: "2026-07-06T10:00:00.000Z",
      actorId: "local-dev",
      token: "test-token-login-flow-000000",
      timestamp: "2026-07-05T10:00:00.000Z"
    }, database);

    const hash = prepareInvitationLogin(
      created.token,
      "2026-07-05T10:30:00.000Z",
      database
    );
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.notEqual(hash, created.token);

    const accepted = acceptInvitationByHash(
      hash,
      user,
      "2026-07-05T11:00:00.000Z",
      database
    );
    assert.equal(accepted.acceptedUserId, user.id);
    assert.equal(membershipRoleForUser(user.id, database), "parent");
  });
});

test("raw invitation tokens are not persisted", () => {
  withDatabase((database) => {
    const rawToken = "test-token-never-persisted-000000";
    const created = createInvitation({
      role: "readonly",
      expiresAt: "2026-07-06T10:00:00.000Z",
      actorId: "local-dev",
      token: rawToken,
      timestamp: "2026-07-05T10:00:00.000Z"
    }, database);

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

test("expired invitations cannot be accepted", () => {
  withDatabase((database) => {
    const user = insertUser(database);
    const created = createInvitation({
      role: "parent",
      expiresAt: "2026-07-05T10:00:00.000Z",
      actorId: "local-dev",
      token: "test-token-expired-invitation-000000",
      timestamp: "2026-07-05T09:00:00.000Z"
    }, database);

    assert.throws(
      () => acceptInvitation(created.token, user, "2026-07-05T10:00:00.000Z", database),
      (error) =>
        error instanceof InvitationError &&
        error.code === "invitation_expired" &&
        error.statusCode === 410
    );
    assert.equal(membershipRoleForUser(user.id, database), undefined);
  });
});

test("revoked invitations cannot be accepted", () => {
  withDatabase((database) => {
    const user = insertUser(database);
    const created = createInvitation({
      role: "admin",
      expiresAt: "2026-07-06T10:00:00.000Z",
      actorId: "local-dev",
      token: "test-token-revoked-invitation-000000",
      timestamp: "2026-07-05T09:00:00.000Z"
    }, database);
    const revoked = revokeInvitation(
      created.invitation.id,
      "local-dev",
      "2026-07-05T09:30:00.000Z",
      database
    );

    assert.equal(revoked?.revokedAt, "2026-07-05T09:30:00.000Z");
    assert.throws(
      () => acceptInvitation(created.token, user, "2026-07-05T10:00:00.000Z", database),
      (error) =>
        error instanceof InvitationError &&
        error.code === "invitation_revoked" &&
        error.statusCode === 410
    );
    assert.equal(membershipRoleForUser(user.id, database), undefined);
  });
});

test("accepted invitations cannot be reused", () => {
  withDatabase((database) => {
    const firstUser = insertUser(database, "user_first");
    const secondUser = insertUser(database, "user_second");
    const created = createInvitation({
      role: "parent",
      expiresAt: "2026-07-06T10:00:00.000Z",
      actorId: "local-dev",
      token: "test-token-single-use-invitation-000000",
      timestamp: "2026-07-05T09:00:00.000Z"
    }, database);

    acceptInvitation(created.token, firstUser, "2026-07-05T10:00:00.000Z", database);

    assert.throws(
      () => acceptInvitation(created.token, secondUser, "2026-07-05T10:05:00.000Z", database),
      (error) =>
        error instanceof InvitationError &&
        error.code === "invitation_already_accepted" &&
        error.statusCode === 409
    );
    assert.equal(membershipRoleForUser(firstUser.id, database), "parent");
    assert.equal(membershipRoleForUser(secondUser.id, database), undefined);
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
      role: "parent",
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
      role: "readonly",
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
      role: "readonly",
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
