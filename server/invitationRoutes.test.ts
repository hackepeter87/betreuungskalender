import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import Fastify from "fastify";
import { permissionsForRole } from "./auth.js";
import type { InvitationEmailInput } from "./services/invitationEmail.js";

const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "betreuungskalender-invitation-routes-")
);
process.env.DATABASE_PATH = join(temporaryDirectory, "test.sqlite");
process.env.BACKUP_DIR = join(temporaryDirectory, "backups");
process.env.INVITATION_PUBLIC_BASE_URL = "https://calendar.example.invalid";

const { runMigrations } = await import("./db/migrate.js");
const { persistence } = await import("./db/connection.js");
const { requireSqlitePersistenceRuntime } = await import("./db/runtime.js");
const db = requireSqlitePersistenceRuntime(persistence).sqliteDatabase;
const { dataTransferRoutes } = await import("./routes/dataTransfer.js");
const { createInvitationRoutes } = await import("./routes/invitations.js");
const { InvitationEmailError } = await import("./services/invitationEmail.js");

runMigrations();

const timestamp = "2026-09-01T10:00:00.000Z";
const expiresAt = "2099-09-08T10:00:00.000Z";

function setOwner(): void {
  db.prepare(`
    INSERT INTO settings (
      key, value_json, created_by, updated_by, created_at, updated_at
    ) VALUES ('setup.ownerUserId', ?, 'local-dev', 'local-dev', ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at,
      deleted_at = NULL
  `).run(JSON.stringify("local-dev"), timestamp, timestamp);
}

function assertNoTokenField(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoTokenField(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  assert.equal(Object.hasOwn(record, "token"), false);
  for (const nested of Object.values(record)) assertNoTokenField(nested);
}

async function createApp(
  sendEmail: (input: InvitationEmailInput) => Promise<void> = async () => {}
) {
  const instance = Fastify();
  instance.decorate("persistence", persistence);
  instance.addHook("onRequest", async (request) => {
    request.userEmail = "local-dev";
    request.user = {
      id: "local-dev",
      externalSubject: "local-dev",
      displayName: "Local owner",
      groups: [],
      role: "admin",
      permissions: permissionsForRole("admin")
    };
  });
  await createInvitationRoutes({ sendInvitationEmail: sendEmail })(instance, {});
  await dataTransferRoutes(instance);
  return instance;
}

beforeEach(() => {
  db.prepare("UPDATE data_transfer_actors SET invitation_id = NULL").run();
  db.prepare("DELETE FROM app_invitations").run();
  db.prepare("DELETE FROM data_transfer_actors").run();
  db.prepare("DELETE FROM data_transfer_runs").run();
  setOwner();
});

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("manual invitation responses expose only the complete invitation URL", async () => {
  const instance = await createApp();
  const response = await instance.inject({
    method: "POST",
    url: "/api/invitations",
    payload: { role: "editor", expiresAt, sendEmail: false }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.headers["cache-control"], "no-store, max-age=0");
  const body = response.json();
  assertNoTokenField(body);
  assert.equal(new URL(body.invitationUrl).origin, "https://calendar.example.invalid");
  assert.equal(body.emailDelivery.status, "not_requested");
  await instance.close();
});

test("email invitation responses reuse the exact public link without a token field", async () => {
  let emailInput: InvitationEmailInput | undefined;
  const instance = await createApp(async (input) => {
    emailInput = input;
  });
  const response = await instance.inject({
    method: "POST",
    url: "/api/invitations",
    payload: {
      role: "viewer",
      emailHint: "invitee@example.invalid",
      expiresAt,
      sendEmail: true
    }
  });

  assert.equal(response.statusCode, 201);
  const body = response.json();
  assertNoTokenField(body);
  assert.equal(body.emailDelivery.status, "sent");
  assert.equal(new URL(body.invitationUrl).searchParams.get("token"), emailInput?.token);
  await instance.close();
});

test("email delivery failures keep the link copyable without exposing a token field", async () => {
  const instance = await createApp(async () => {
    throw new InvitationEmailError(
      "mail_delivery_failed",
      "Einladungs-E-Mail konnte nicht gesendet werden."
    );
  });
  const response = await instance.inject({
    method: "POST",
    url: "/api/invitations",
    payload: {
      role: "scheduler",
      emailHint: "invitee@example.invalid",
      expiresAt,
      sendEmail: true
    }
  });

  assert.equal(response.statusCode, 201);
  const body = response.json();
  assertNoTokenField(body);
  assert.equal(body.emailDelivery.status, "failed");
  assert.match(body.invitationUrl, /^https:\/\/calendar\.example\.invalid\/invite\?token=/);
  await instance.close();
});

test("historical actor invitation responses expose only the complete invitation URL", async () => {
  db.prepare(`
    INSERT INTO data_transfer_runs (
      id, package_fingerprint, format_version, source_version, result,
      counts_json, warnings_json, created_by, created_at, imported_at
    ) VALUES ('run-invitation-route', ?, 1, '1.22.0', 'imported', '{}', '[]',
      'local-dev', ?, ?)
  `).run("a".repeat(64), timestamp, timestamp);
  db.prepare(`
    INSERT INTO data_transfer_actors (
      id, transfer_run_id, source_ref, display_name, email_hint,
      suggested_role, created_by, updated_by, created_at, updated_at
    ) VALUES ('actor-invitation-route', 'run-invitation-route', 'source-actor',
      'Historical actor', 'historical@example.invalid', 'viewer',
      'local-dev', 'local-dev', ?, ?)
  `).run(timestamp, timestamp);

  const instance = await createApp();
  const response = await instance.inject({
    method: "POST",
    url: "/api/data-transfer/actors/actor-invitation-route/invitation",
    payload: { role: "viewer", expiresAt }
  });

  assert.equal(response.statusCode, 201);
  const body = response.json();
  assertNoTokenField(body);
  assert.match(body.invitationUrl, /^https:\/\/calendar\.example\.invalid\/invite\?token=/);
  await instance.close();
});
