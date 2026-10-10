import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { RequestUser } from "./auth.js";
import { createSqlitePersistenceRuntime } from "./db/runtime.js";
import { privacyActionRoutes } from "./routes/privacyActions.js";
import {
  executePrivacyAction,
  getPrivacyActionResult,
  parsePrivacyActionExecuteRequest,
  parsePrivacyActionPreviewRequest,
  previewPrivacyAction,
  PrivacyActionError,
  privacyActionPreviewMatches
} from "./services/privacyActions.js";
import { hasWorkspaceAccess } from "./services/memberships.js";
import { acceptInvitation, createInvitation } from "./services/invitations.js";
import { findAuthenticatedUserBySubject, upsertAuthenticatedUser } from "./services/users.js";

async function database() {
  const runtime = createSqlitePersistenceRuntime(":memory:");
  await runtime.migrate();
  return runtime;
}

function insertOwner(runtime: Awaited<ReturnType<typeof database>>) {
  runtime.sqliteDatabase.exec(`
    INSERT INTO app_users (
      id, external_subject, email, display_name, role, groups_json,
      last_seen_at, created_at, updated_at, deleted_at
    ) VALUES (
      'owner-user', 'owner-subject', 'owner@example.invalid', 'Owner name',
      'admin', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
    );
    INSERT INTO settings (key, value_json, created_by, updated_by, created_at, updated_at, deleted_at)
    VALUES ('setup.ownerUserId', '"owner-user"', 'owner-user', 'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
  `);
}

function insertRevocationFixture(runtime: Awaited<ReturnType<typeof database>>) {
  insertOwner(runtime);
  runtime.sqliteDatabase.exec(`
    INSERT INTO app_users (
      id, external_subject, email, display_name, role, groups_json,
      last_seen_at, created_at, updated_at, deleted_at
    ) VALUES (
      'target-user', 'target-subject', 'target@example.invalid', 'Fictional target',
      'parent', '["fixture"]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
    );
    INSERT INTO app_memberships (
      id, user_id, role, created_by, updated_by, created_at, updated_at, deleted_at
    ) VALUES (
      'membership-1', 'target-user', 'editor', 'owner-user', 'owner-user',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
    );
    INSERT INTO care_parties (
      id, name, kind, created_by, updated_by, created_at, updated_at, deleted_at
    ) VALUES (
      'party-1', 'Fictional party', 'other', 'owner-user', 'owner-user',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
    );
    INSERT INTO app_user_care_party_assignments (
      id, user_id, care_party_id, created_by, updated_by, created_at, updated_at, deleted_at
    ) VALUES (
      'assignment-1', 'target-user', 'party-1', 'owner-user', 'owner-user',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
    );
    INSERT INTO calendar_feed_tokens (id, user_id, token_hash, created_at, scope_type)
    VALUES ('feed-1', 'target-user', 'fixture-token-hash', CURRENT_TIMESTAMP, 'all');
    INSERT INTO push_subscriptions (
      id, user_id, endpoint, p256dh, auth, created_at, updated_at, deleted_at
    ) VALUES (
      'push-1', 'target-user', 'https://push.example.invalid/fixture', 'fixture-key',
      'fixture-auth', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
    );
    INSERT INTO native_oidc_sessions (
      id, session_hash, external_subject, created_at, expires_at, revoked_at
    ) VALUES (
      'session-1', 'fixture-session-hash', 'target-subject', CURRENT_TIMESTAMP,
      '2099-01-01T00:00:00.000Z', NULL
    );
    INSERT INTO notification_preferences (
      id, user_id, event_type, in_app_enabled, push_enabled, email_enabled,
      created_at, updated_at, deleted_at
    ) VALUES (
      'preference-1', 'target-user', 'care_confirmation_due', 1, 1, 1,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
    );
    INSERT INTO app_invitations (
      id, token_hash, role, expires_at, accepted_user_id, accepted_at,
      created_by, updated_by, created_at, updated_at, deleted_at
    ) VALUES (
      'accepted-invitation-1', 'accepted-invitation-token-hash', 'editor',
      '2099-01-01T00:00:00.000Z', 'target-user', CURRENT_TIMESTAMP,
      'owner-user', 'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
    );
    INSERT INTO care_entries (
      id, start_datetime, end_datetime, status, care_scope, duration_minutes,
      created_by, updated_by, created_at, updated_at, deleted_at
    ) VALUES (
      'entry-1', '2026-01-01T10:00:00.000Z', '2026-01-01T12:00:00.000Z',
      'planned', 'full_day', 120, 'owner-user', 'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
    );
    INSERT INTO care_confirmation_requests (
      id, care_entry_id, user_id, due_at, status, reminder_count,
      created_at, updated_at, deleted_at
    ) VALUES (
      'confirmation-1', 'entry-1', 'target-user', CURRENT_TIMESTAMP, 'open', 0,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
    );
    INSERT INTO care_confirmation_email_deliveries (
      id, care_confirmation_request_id, event_type, occurrence_key, status,
      attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (
      'delivery-1', 'confirmation-1', 'care_confirmation_due', 'fixture-occurrence',
      'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
  `);
}

function completeRevocationRequest() {
  return parsePrivacyActionPreviewRequest({
    subjectType: "user",
    subjectId: "target-user",
    actions: [
      { category: "access", action: "revoke" },
      { category: "authentication_identity", action: "detach" },
      { category: "domain_relationships", action: "delete" },
      { category: "runtime_channels", action: "revoke" }
    ]
  });
}

test("identity detachment blocks while a mapped historical actor has no selected resolution", async () => {
  const runtime = await database();
  try {
    insertRevocationFixture(runtime);
    runtime.sqliteDatabase.exec(`
      INSERT INTO data_transfer_runs (
        id, package_fingerprint, format_version, source_version, result,
        counts_json, created_by, created_at
      ) VALUES (
        'transfer-1', 'fixture-fingerprint', 1, '1.0.0', 'imported', '{}',
        'owner-user', CURRENT_TIMESTAMP
      );
      INSERT INTO data_transfer_actors (
        id, transfer_run_id, source_ref, display_name, mapped_user_id,
        created_by, updated_by, created_at, updated_at
      ) VALUES (
        'transfer-actor-1', 'transfer-1', 'fixture-ref', 'Historical fixture',
        'target-user', 'owner-user', 'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
    `);
    const request = parsePrivacyActionPreviewRequest({
      subjectType: "user",
      subjectId: "target-user",
      actions: [
        { category: "access", action: "revoke" },
        { category: "authentication_identity", action: "detach" },
        { category: "domain_relationships", action: "delete" },
        { category: "runtime_channels", action: "revoke" }
      ]
    });
    const preview = await previewPrivacyAction(request, "owner-user", runtime.query);
    assert.equal(preview.result, "blocked");
    assert.equal(preview.blockerCodes.includes("identity_detachment_requires_transfer_resolution"), true);
    await assert.rejects(
      executePrivacyAction({ ...request, fingerprint: preview.fingerprint }, "owner-user", runtime),
      (error: unknown) => error instanceof PrivacyActionError && error.code === "privacy_action_invalid"
    );
  } finally {
    await runtime.close();
  }
});

test("privacy preview inventories aggregate user categories without writes or identity leakage", async () => {
  const runtime = await database();
  try {
    insertOwner(runtime);
    runtime.sqliteDatabase.exec(`
      INSERT INTO app_users (
        id, external_subject, email, display_name, role, groups_json,
        last_seen_at, created_at, updated_at, deleted_at
      ) VALUES (
        'target-user', 'private-subject', 'target@example.invalid', 'Private target',
        'parent', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO app_memberships (
        id, user_id, role, created_by, updated_by, created_at, updated_at, deleted_at
      ) VALUES (
        'membership-1', 'target-user', 'editor', 'owner-user', 'owner-user',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO calendar_feed_tokens (id, user_id, token_hash, created_at, scope_type)
      VALUES ('feed-1', 'target-user', 'not-a-real-token', CURRENT_TIMESTAMP, 'all');
      INSERT INTO audit_log (
        timestamp, user_email, entity_type, entity_id, action,
        old_value, new_value, created_at, updated_at, deleted_at
      ) VALUES (
        CURRENT_TIMESTAMP, 'target-user', 'care_entry', 'fictional-entry', 'updated',
        '"Private target"', '"PRIVATE_MARKER"', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
    `);
    const before = runtime.sqliteDatabase.serialize();
    const request = parsePrivacyActionPreviewRequest({
      subjectType: "user",
      subjectId: "target-user",
      actions: [
        { category: "access", action: "revoke" },
        { category: "historical_attribution", action: "anonymize" }
      ]
    });
    const preview = await previewPrivacyAction(request, "owner-user", runtime.query);
    assert.equal(preview.result, "warnings");
    assert.equal(preview.categories.find(({ code }) => code === "access")?.count, 1);
    assert.equal(preview.categories.find(({ code }) => code === "runtime_channels")?.count, 1);
    assert.equal(preview.categories.find(({ code }) => code === "historical_attribution")?.count, 1);
    assert.match(preview.fingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(runtime.sqliteDatabase.serialize(), before);
    const response = JSON.stringify(preview);
    for (const prohibited of ["Private target", "target@example.invalid", "private-subject", "PRIVATE_MARKER"]) {
      assert.equal(response.includes(prohibited), false);
    }
  } finally {
    await runtime.close();
  }
});

test("privacy preview fingerprint changes with relevant state", async () => {
  const runtime = await database();
  try {
    insertOwner(runtime);
    runtime.sqliteDatabase.prepare(`
      INSERT INTO app_users (
        id, external_subject, display_name, role, groups_json,
        last_seen_at, created_at, updated_at, deleted_at
      ) VALUES (
        'target-user', 'target-subject', 'Target', 'parent', '[]',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      )
    `).run();
    const request = parsePrivacyActionPreviewRequest({
      subjectType: "user",
      subjectId: "target-user",
      actions: [{ category: "access", action: "revoke" }]
    });
    const preview = await previewPrivacyAction(request, "owner-user", runtime.query);
    assert.equal(await privacyActionPreviewMatches(request, "owner-user", preview.fingerprint, runtime.query), true);
    runtime.sqliteDatabase.prepare(`
      INSERT INTO app_memberships (
        id, user_id, role, created_by, updated_by, created_at, updated_at, deleted_at
      ) VALUES ('membership-new', 'target-user', 'viewer', 'owner-user', 'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
    `).run();
    assert.equal(await privacyActionPreviewMatches(request, "owner-user", preview.fingerprint, runtime.query), false);
  } finally {
    await runtime.close();
  }
});

test("privacy preview fingerprints do not depend on action ordering", async () => {
  const runtime = await database();
  try {
    insertOwner(runtime);
    runtime.sqliteDatabase.prepare(`
      INSERT INTO app_users (
        id, external_subject, display_name, role, groups_json,
        last_seen_at, created_at, updated_at, deleted_at
      ) VALUES (
        'target-user', 'target-subject', 'Target', 'parent', '[]',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      )
    `).run();
    const first = parsePrivacyActionPreviewRequest({
      subjectType: "user",
      subjectId: "target-user",
      actions: [
        { category: "runtime_channels", action: "revoke" },
        { category: "access", action: "revoke" }
      ]
    });
    const second = parsePrivacyActionPreviewRequest({
      subjectType: "user",
      subjectId: "target-user",
      actions: [...first.actions].reverse()
    });
    const [firstPreview, secondPreview] = await Promise.all([
      previewPrivacyAction(first, "owner-user", runtime.query),
      previewPrivacyAction(second, "owner-user", runtime.query)
    ]);
    assert.equal(firstPreview.fingerprint, secondPreview.fingerprint);
  } finally {
    await runtime.close();
  }
});

test("privacy execution revokes access and detaches identity atomically and idempotently", async () => {
  const runtime = await database();
  try {
    insertRevocationFixture(runtime);
    const request = completeRevocationRequest();
    const preview = await previewPrivacyAction(request, "owner-user", runtime.query);
    assert.equal(preview.result, "ready");
    const execution = parsePrivacyActionExecuteRequest({ ...request, fingerprint: preview.fingerprint });
    const first = await executePrivacyAction(
      execution,
      "owner-user",
      runtime,
      "2026-10-10T12:00:00.000Z"
    );
    const second = await executePrivacyAction(
      execution,
      "owner-user",
      runtime,
      "2026-10-10T12:01:00.000Z"
    );
    assert.deepEqual(second, first);
    assert.equal((await getPrivacyActionResult(first.id, runtime.query)).id, first.id);
    assert.equal(first.status, "completed");
    assert.deepEqual(first.actionCodes, [
      "access:revoke",
      "authentication_identity:detach",
      "domain_relationships:delete",
      "runtime_channels:revoke"
    ]);
    assert.equal(await findAuthenticatedUserBySubject("target-subject", runtime.query), undefined);
    assert.equal(await hasWorkspaceAccess("target-user", runtime.query), false);
    const target = await runtime.query.selectFrom("app_users")
      .select(["external_subject", "email", "display_name", "groups_json", "role"])
      .where("id", "=", "target-user").executeTakeFirstOrThrow();
    assert.match(target.external_subject, /^urn:betreuungskalender:detached:/);
    assert.equal(target.email, null);
    assert.equal(target.display_name.includes("Fictional"), false);
    assert.equal(target.groups_json, "[]");
    assert.equal(target.role, "readonly");
    assert.equal(Number((await runtime.query.selectFrom("app_memberships")
      .select(({ fn }) => fn.count<number>("id").as("count"))
      .where("user_id", "=", "target-user").where("deleted_at", "is", null)
      .executeTakeFirstOrThrow()).count), 0);
    assert.equal(Number((await runtime.query.selectFrom("native_oidc_sessions")
      .select(({ fn }) => fn.count<number>("id").as("count"))
      .where("external_subject", "=", "target-subject").where("revoked_at", "is", null)
      .executeTakeFirstOrThrow()).count), 0);
    assert.equal((await runtime.query.selectFrom("app_invitations")
      .select("accepted_user_id").where("id", "=", "accepted-invitation-1")
      .executeTakeFirstOrThrow()).accepted_user_id, null);
    assert.equal((await runtime.query.selectFrom("care_confirmation_email_deliveries")
      .select("error_code").where("id", "=", "delivery-1")
      .executeTakeFirstOrThrow()).error_code, "subject_revoked");
    assert.equal(Number((await runtime.query.selectFrom("privacy_action_runs")
      .select(({ fn }) => fn.count<number>("id").as("count"))
      .executeTakeFirstOrThrow()).count), 1);

    const returningIdentity: RequestUser = {
      id: "target-user",
      externalSubject: "target-subject",
      email: "new-target@example.invalid",
      displayName: "New fictional target",
      groups: [],
      role: "readonly",
      permissions: ["read"]
    };
    const newUserId = await upsertAuthenticatedUser(
      returningIdentity,
      runtime.query,
      "2026-10-10T12:01:00.000Z"
    );
    assert.notEqual(newUserId, "target-user");
    assert.equal(await hasWorkspaceAccess(newUserId, runtime.query), false);
    const invitation = await createInvitation({
      role: "viewer",
      expiresAt: "2026-10-11T12:00:00.000Z",
      actorId: "owner-user",
      token: "fictional-privacy-rejoin-token",
      timestamp: "2026-10-10T12:01:30.000Z"
    }, runtime.query);
    const accepted = await acceptInvitation(
      invitation.token,
      returningIdentity,
      runtime,
      "2026-10-10T12:02:00.000Z"
    );
    assert.equal(accepted.acceptedUserId, newUserId);
    assert.equal(await hasWorkspaceAccess(newUserId, runtime.query), true);
  } finally {
    await runtime.close();
  }
});

test("privacy execution rejects stale previews without partial changes", async () => {
  const runtime = await database();
  try {
    insertRevocationFixture(runtime);
    const request = completeRevocationRequest();
    const preview = await previewPrivacyAction(request, "owner-user", runtime.query);
    await runtime.query.updateTable("app_memberships")
      .set({ updated_at: "2026-10-10T12:05:00.000Z" })
      .where("id", "=", "membership-1").execute();
    await assert.rejects(
      executePrivacyAction({ ...request, fingerprint: preview.fingerprint }, "owner-user", runtime),
      (error) => error instanceof PrivacyActionError && error.code === "privacy_action_preview_changed"
    );
    assert.equal(await hasWorkspaceAccess("target-user", runtime.query), true);
    assert.equal(Number((await runtime.query.selectFrom("privacy_action_runs")
      .select(({ fn }) => fn.count<number>("id").as("count"))
      .executeTakeFirstOrThrow()).count), 0);
  } finally {
    await runtime.close();
  }
});

test("privacy execution rolls back access revocation when identity detachment fails", async () => {
  const runtime = await database();
  try {
    insertRevocationFixture(runtime);
    const request = completeRevocationRequest();
    const preview = await previewPrivacyAction(request, "owner-user", runtime.query);
    runtime.sqliteDatabase.exec(`
      CREATE TRIGGER fail_privacy_identity_update
      BEFORE UPDATE OF external_subject ON app_users
      BEGIN
        SELECT RAISE(ABORT, 'PRIVATE_TRIGGER_DETAIL');
      END;
    `);
    await assert.rejects(
      executePrivacyAction({ ...request, fingerprint: preview.fingerprint }, "owner-user", runtime)
    );
    assert.equal(await hasWorkspaceAccess("target-user", runtime.query), true);
    assert.equal((await runtime.query.selectFrom("calendar_feed_tokens")
      .select("revoked_at").where("id", "=", "feed-1").executeTakeFirstOrThrow()).revoked_at, null);
    assert.equal(Number((await runtime.query.selectFrom("privacy_action_runs")
      .select(({ fn }) => fn.count<number>("id").as("count"))
      .executeTakeFirstOrThrow()).count), 0);
  } finally {
    await runtime.close();
  }
});

test("privacy preview blocks changes to the current installation owner", async () => {
  const runtime = await database();
  try {
    insertOwner(runtime);
    const preview = await previewPrivacyAction(parsePrivacyActionPreviewRequest({
      subjectType: "user",
      subjectId: "owner-user",
      actions: [{ category: "authentication_identity", action: "detach" }]
    }), "owner-user", runtime.query);
    assert.equal(preview.result, "blocked");
    assert.deepEqual(preview.blockerCodes, ["current_owner_protected"]);
  } finally {
    await runtime.close();
  }
});

test("privacy preview requires child relationships to be resolved with domain records", async () => {
  const runtime = await database();
  try {
    runtime.sqliteDatabase.exec(`
      INSERT INTO children (id, name, birth_month, birth_year, color, created_at, updated_at, deleted_at)
      VALUES ('child-1', 'Fictional child', 1, 2020, '#123456', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
      INSERT INTO care_entries (
        id, start_datetime, end_datetime, status, care_scope, duration_minutes,
        created_by, updated_by, created_at, updated_at, deleted_at
      ) VALUES (
        'entry-1', '2026-01-01T10:00:00.000Z', '2026-01-01T12:00:00.000Z',
        'planned', 'full_day', 120, 'actor', 'actor', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO care_entry_children (care_entry_id, child_id, created_at, updated_at, deleted_at)
      VALUES ('entry-1', 'child-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
    `);
    const preview = await previewPrivacyAction(parsePrivacyActionPreviewRequest({
      subjectType: "child",
      subjectId: "child-1",
      actions: [{ category: "domain_records", action: "delete" }]
    }), "owner-user", runtime.query);
    assert.equal(preview.result, "blocked");
    assert.equal(preview.categories.find(({ code }) => code === "domain_records")?.status, "blocked");
    assert.deepEqual(preview.warningCodes, ["shared_records_require_review"]);
    assert.deepEqual(preview.blockerCodes, ["record_deletion_requires_relationship_resolution"]);
  } finally {
    await runtime.close();
  }
});

test("privacy execution anonymizes a revoked user and mapped historical actor without retaining identifiers", async () => {
  const runtime = await database();
  try {
    insertRevocationFixture(runtime);
    runtime.sqliteDatabase.exec(`
      INSERT INTO data_transfer_runs (
        id, package_fingerprint, format_version, source_version, result,
        counts_json, created_by, created_at
      ) VALUES (
        'transfer-anonymize', 'fixture-fingerprint-anonymize', 1, '1.0.0',
        'imported', '{}', 'owner-user', CURRENT_TIMESTAMP
      );
      INSERT INTO data_transfer_actors (
        id, transfer_run_id, source_ref, display_name, email_hint,
        suggested_role, mapped_user_id, created_by, updated_by, created_at, updated_at
      ) VALUES (
        'transfer-actor-anonymize', 'transfer-anonymize', 'private-source-ref',
        'Historical private name', 'historical@example.invalid', 'editor',
        'target-user', 'owner-user', 'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
      INSERT INTO audit_log (
        timestamp, user_email, entity_type, entity_id, action, field_name,
        old_value, new_value, metadata_json, created_at, updated_at, deleted_at
      ) VALUES (
        CURRENT_TIMESTAMP, 'owner-user', 'app_member', 'target-user', 'updated',
        'display_name', '"Historical private name"', '"Fictional target"',
        '{"email":"historical@example.invalid"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
    `);
    const request = parsePrivacyActionPreviewRequest({
      subjectType: "user",
      subjectId: "target-user",
      actions: [
        { category: "access", action: "revoke" },
        { category: "authentication_identity", action: "anonymize" },
        { category: "domain_relationships", action: "delete" },
        { category: "historical_attribution", action: "anonymize" },
        { category: "runtime_channels", action: "revoke" },
        { category: "transfer_state", action: "anonymize" }
      ]
    });
    const preview = await previewPrivacyAction(request, "owner-user", runtime.query);
    assert.notEqual(preview.result, "blocked");
    assert.equal(preview.categories.find(({ code }) => code === "historical_attribution")?.count, 1);
    const result = await executePrivacyAction(
      { ...request, fingerprint: preview.fingerprint },
      "owner-user",
      runtime,
      "2026-10-10T13:00:00.000Z"
    );
    assert.equal(result.status, "completed");

    const user = runtime.sqliteDatabase.prepare(`
      SELECT external_subject AS externalSubject, email, display_name AS displayName,
             groups_json AS groupsJson, role
      FROM app_users WHERE id = 'target-user'
    `).get() as Record<string, unknown>;
    assert.match(String(user.externalSubject), /^urn:betreuungskalender:detached:/);
    assert.equal(user.email, null);
    assert.match(String(user.displayName), /^Anonymized workspace member /);
    assert.equal(user.groupsJson, "[]");
    assert.equal(user.role, "readonly");

    const historicalActor = runtime.sqliteDatabase.prepare(`
      SELECT source_ref AS sourceRef, display_name AS displayName, email_hint AS emailHint,
             suggested_role AS suggestedRole, mapped_user_id AS mappedUserId,
             invitation_id AS invitationId
      FROM data_transfer_actors WHERE id = 'transfer-actor-anonymize'
    `).get() as Record<string, unknown>;
    assert.match(String(historicalActor.sourceRef), /^anonymized:/);
    assert.match(String(historicalActor.displayName), /^Anonymized historical actor /);
    assert.equal(historicalActor.emailHint, null);
    assert.equal(historicalActor.suggestedRole, null);
    assert.equal(historicalActor.mappedUserId, null);
    assert.equal(historicalActor.invitationId, null);

    const audit = runtime.sqliteDatabase.prepare(`
      SELECT old_value AS oldValue, new_value AS newValue, metadata_json AS metadataJson
      FROM audit_log WHERE entity_type = 'app_member' AND entity_id = 'target-user'
    `).get() as Record<string, unknown>;
    assert.deepEqual(audit, { oldValue: null, newValue: null, metadataJson: null });
    const serialized = JSON.stringify({ user, historicalActor, audit });
    for (const prohibited of [
      "target-subject", "target@example.invalid", "Fictional target",
      "Historical private name", "historical@example.invalid", "private-source-ref"
    ]) assert.equal(serialized.includes(prohibited), false);

    const repeated = await executePrivacyAction(
      { ...request, fingerprint: preview.fingerprint },
      "owner-user",
      runtime,
      "2026-10-10T13:05:00.000Z"
    );
    assert.equal(repeated.id, result.id);
  } finally {
    await runtime.close();
  }
});

test("privacy execution anonymizes child attributes and direct audit snapshots while preserving relationships", async () => {
  const runtime = await database();
  try {
    insertOwner(runtime);
    runtime.sqliteDatabase.exec(`
      INSERT INTO children (
        id, name, birth_month, birth_year, color, created_by, updated_by,
        created_at, updated_at, deleted_at
      ) VALUES (
        'child-anonymize', 'Private child name', 4, 2018, '#123456',
        'owner-user', 'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO care_entries (
        id, start_datetime, end_datetime, status, care_scope, duration_minutes,
        created_by, updated_by, created_at, updated_at, deleted_at
      ) VALUES (
        'entry-child-anonymize', '2026-01-01T10:00:00.000Z', '2026-01-01T12:00:00.000Z',
        'completed', 'full_day', 120, 'owner-user', 'owner-user',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO care_entry_children (
        care_entry_id, child_id, created_at, updated_at, deleted_at
      ) VALUES (
        'entry-child-anonymize', 'child-anonymize', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO audit_log (
        timestamp, user_email, entity_type, entity_id, action, field_name,
        old_value, new_value, metadata_json, created_at, updated_at, deleted_at
      ) VALUES (
        CURRENT_TIMESTAMP, 'owner-user', 'child', 'child-anonymize', 'updated',
        'name', '"Private child name"', '"Other private child name"',
        '{"birthMonth":4,"birthYear":2018}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
    `);
    const request = parsePrivacyActionPreviewRequest({
      subjectType: "child",
      subjectId: "child-anonymize",
      actions: [
        { category: "profile", action: "anonymize" },
        { category: "historical_attribution", action: "anonymize" }
      ]
    });
    const preview = await previewPrivacyAction(request, "owner-user", runtime.query);
    assert.notEqual(preview.result, "blocked");
    await executePrivacyAction(
      { ...request, fingerprint: preview.fingerprint },
      "owner-user",
      runtime,
      "2026-10-10T13:10:00.000Z"
    );
    const child = runtime.sqliteDatabase.prepare(`
      SELECT name, birth_month AS birthMonth, birth_year AS birthYear
      FROM children WHERE id = 'child-anonymize'
    `).get() as Record<string, unknown>;
    assert.match(String(child.name), /^Anonymized child /);
    assert.equal(child.birthMonth, null);
    assert.equal(child.birthYear, null);
    assert.equal(Number((runtime.sqliteDatabase.prepare(`
      SELECT COUNT(*) AS count FROM care_entry_children
      WHERE child_id = 'child-anonymize' AND deleted_at IS NULL
    `).get() as { count: number }).count), 1);
    const audit = runtime.sqliteDatabase.prepare(`
      SELECT old_value AS oldValue, new_value AS newValue, metadata_json AS metadataJson
      FROM audit_log WHERE entity_type = 'child' AND entity_id = 'child-anonymize'
    `).get();
    assert.deepEqual(audit, { oldValue: null, newValue: null, metadataJson: null });
  } finally {
    await runtime.close();
  }
});

test("privacy preview blocks profile anonymization that would retain direct identifying audit snapshots", async () => {
  const runtime = await database();
  try {
    insertOwner(runtime);
    runtime.sqliteDatabase.exec(`
      INSERT INTO children (
        id, name, birth_month, birth_year, color, created_by, updated_by,
        created_at, updated_at, deleted_at
      ) VALUES (
        'child-history-block', 'Private child history', 5, 2017, '#123456',
        'owner-user', 'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO audit_log (
        timestamp, user_email, entity_type, entity_id, action, old_value,
        created_at, updated_at, deleted_at
      ) VALUES (
        CURRENT_TIMESTAMP, 'owner-user', 'child', 'child-history-block', 'updated',
        '"Private child history"', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
    `);
    const preview = await previewPrivacyAction(parsePrivacyActionPreviewRequest({
      subjectType: "child",
      subjectId: "child-history-block",
      actions: [{ category: "profile", action: "anonymize" }]
    }), "owner-user", runtime.query);
    assert.equal(preview.result, "blocked");
    assert.deepEqual(preview.blockerCodes, ["profile_anonymization_requires_history_resolution"]);
  } finally {
    await runtime.close();
  }
});

test("privacy execution anonymizes a care-party profile and direct audit snapshots", async () => {
  const runtime = await database();
  try {
    insertOwner(runtime);
    runtime.sqliteDatabase.exec(`
      INSERT INTO care_parties (
        id, name, kind, created_by, updated_by, created_at, updated_at, deleted_at
      ) VALUES (
        'party-anonymize', 'Private caregiver name', 'other', 'owner-user',
        'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO audit_log (
        timestamp, user_email, entity_type, entity_id, action, field_name,
        old_value, new_value, metadata_json, created_at, updated_at, deleted_at
      ) VALUES (
        CURRENT_TIMESTAMP, 'owner-user', 'care_party', 'party-anonymize', 'updated',
        'name', '"Private caregiver name"', '"Another caregiver name"', NULL,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
    `);
    const request = parsePrivacyActionPreviewRequest({
      subjectType: "care_party",
      subjectId: "party-anonymize",
      actions: [
        { category: "profile", action: "anonymize" },
        { category: "historical_attribution", action: "anonymize" }
      ]
    });
    const preview = await previewPrivacyAction(request, "owner-user", runtime.query);
    assert.notEqual(preview.result, "blocked");
    await executePrivacyAction(
      { ...request, fingerprint: preview.fingerprint },
      "owner-user",
      runtime,
      "2026-10-10T13:15:00.000Z"
    );
    const party = runtime.sqliteDatabase.prepare(
      "SELECT name FROM care_parties WHERE id = 'party-anonymize'"
    ).get() as { name: string };
    assert.match(party.name, /^Anonymized care party /);
    const audit = runtime.sqliteDatabase.prepare(`
      SELECT old_value AS oldValue, new_value AS newValue, metadata_json AS metadataJson
      FROM audit_log WHERE entity_type = 'care_party' AND entity_id = 'party-anonymize'
    `).get();
    assert.deepEqual(audit, { oldValue: null, newValue: null, metadataJson: null });
  } finally {
    await runtime.close();
  }
});

test("privacy execution physically removes an approved exclusive child record graph", async () => {
  const runtime = await database();
  try {
    insertOwner(runtime);
    runtime.sqliteDatabase.exec(`
      INSERT INTO children (
        id, name, birth_month, birth_year, color, created_by, updated_by,
        created_at, updated_at, deleted_at
      ) VALUES (
        'child-delete', 'Fictional child to delete', 3, 2019, '#123456',
        'owner-user', 'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO care_entries (
        id, start_datetime, end_datetime, status, care_scope, duration_minutes,
        created_by, updated_by, created_at, updated_at, deleted_at
      ) VALUES (
        'entry-delete', '2026-03-01T10:00:00.000Z', '2026-03-01T12:00:00.000Z',
        'completed', 'full_day', 120, 'owner-user', 'owner-user',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO care_entry_children (
        care_entry_id, child_id, created_at, updated_at, deleted_at
      ) VALUES (
        'entry-delete', 'child-delete', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO trips (
        id, care_entry_id, purpose, km, created_by, updated_by,
        created_at, updated_at, deleted_at
      ) VALUES (
        'trip-delete', 'entry-delete', 'Fictional trip', 2,
        'owner-user', 'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO costs (
        id, care_entry_id, category, amount, paid_by, created_by, updated_by,
        created_at, updated_at, deleted_at
      ) VALUES (
        'cost-delete', 'entry-delete', 'other', 5, 'Fictional payer',
        'owner-user', 'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO care_confirmation_requests (
        id, care_entry_id, user_id, due_at, status, reminder_count,
        created_at, updated_at, deleted_at
      ) VALUES (
        'confirmation-delete', 'entry-delete', 'owner-user', CURRENT_TIMESTAMP,
        'answered', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO care_confirmation_email_deliveries (
        id, care_confirmation_request_id, event_type, occurrence_key, status,
        attempt_count, created_at, updated_at
      ) VALUES (
        'delivery-delete', 'confirmation-delete', 'care_confirmation_due',
        'fixture-delete', 'sent', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
      INSERT INTO audit_log (
        timestamp, user_email, entity_type, entity_id, action, old_value,
        created_at, updated_at, deleted_at
      ) VALUES (
        CURRENT_TIMESTAMP, 'owner-user', 'child', 'child-delete', 'updated',
        '"Fictional child to delete"', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO monthly_closings (
        id, month_key, summary_json, closed_by, created_at, updated_at, deleted_at
      ) VALUES (
        'closing-delete', '2026-03', '{}', 'owner-user',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
    `);
    const request = parsePrivacyActionPreviewRequest({
      subjectType: "child",
      subjectId: "child-delete",
      actions: [
        { category: "domain_records", action: "delete" },
        { category: "domain_relationships", action: "delete" },
        { category: "historical_attribution", action: "anonymize" },
        { category: "profile", action: "delete" }
      ]
    });
    const preview = await previewPrivacyAction(request, "owner-user", runtime.query);
    assert.notEqual(preview.result, "blocked");
    const result = await executePrivacyAction(
      { ...request, fingerprint: preview.fingerprint },
      "owner-user",
      runtime,
      "2026-10-10T14:00:00.000Z"
    );
    assert.equal(result.status, "completed");
    for (const table of [
      "children", "care_entries", "care_entry_children", "trips", "costs",
      "care_confirmation_requests", "care_confirmation_email_deliveries"
    ]) {
      const row = runtime.sqliteDatabase.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      assert.equal(Number(row.count), 0, table);
    }
    const audit = runtime.sqliteDatabase.prepare(`
      SELECT old_value AS oldValue, new_value AS newValue, metadata_json AS metadataJson
      FROM audit_log WHERE entity_type = 'child' AND entity_id = 'child-delete'
    `).get();
    assert.deepEqual(audit, { oldValue: null, newValue: null, metadataJson: null });
    const closing = runtime.sqliteDatabase.prepare(`
      SELECT changed_after_close_at AS changedAt FROM monthly_closings WHERE id = 'closing-delete'
    `).get() as { changedAt: string | null };
    assert.equal(closing.changedAt, "2026-10-10T14:00:00.000Z");
  } finally {
    await runtime.close();
  }
});

test("privacy execution detaches a deleted child while preserving a safe shared record", async () => {
  const runtime = await database();
  try {
    insertOwner(runtime);
    runtime.sqliteDatabase.exec(`
      INSERT INTO children (
        id, name, birth_month, birth_year, color, created_by, updated_by,
        created_at, updated_at, deleted_at
      ) VALUES
        ('child-delete-shared', 'Fictional selected child', 3, 2019, '#123456', 'owner-user', 'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL),
        ('child-keep-shared', 'Fictional retained child', 4, 2020, '#654321', 'owner-user', 'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
      INSERT INTO care_entries (
        id, start_datetime, end_datetime, status, care_scope, duration_minutes,
        created_by, updated_by, created_at, updated_at, deleted_at
      ) VALUES (
        'entry-shared-safe', '2026-03-01T10:00:00.000Z', '2026-03-01T12:00:00.000Z',
        'completed', 'full_day', 120, 'owner-user', 'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO care_entry_children (
        care_entry_id, child_id, created_at, updated_at, deleted_at
      ) VALUES
        ('entry-shared-safe', 'child-delete-shared', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL),
        ('entry-shared-safe', 'child-keep-shared', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
    `);
    const request = parsePrivacyActionPreviewRequest({
      subjectType: "child",
      subjectId: "child-delete-shared",
      actions: [
        { category: "domain_records", action: "delete" },
        { category: "domain_relationships", action: "delete" },
        { category: "profile", action: "delete" }
      ]
    });
    const preview = await previewPrivacyAction(request, "owner-user", runtime.query);
    assert.notEqual(preview.result, "blocked");
    await executePrivacyAction(
      { ...request, fingerprint: preview.fingerprint },
      "owner-user",
      runtime,
      "2026-10-10T14:05:00.000Z"
    );
    assert.equal(Number((runtime.sqliteDatabase.prepare(
      "SELECT COUNT(*) AS count FROM children WHERE id = 'child-delete-shared'"
    ).get() as { count: number }).count), 0);
    assert.equal(Number((runtime.sqliteDatabase.prepare(
      "SELECT COUNT(*) AS count FROM care_entries WHERE id = 'entry-shared-safe'"
    ).get() as { count: number }).count), 1);
    const links = runtime.sqliteDatabase.prepare(`
      SELECT child_id AS childId FROM care_entry_children
      WHERE care_entry_id = 'entry-shared-safe' ORDER BY child_id
    `).all() as Array<{ childId: string }>;
    assert.deepEqual(links, [{ childId: "child-keep-shared" }]);
  } finally {
    await runtime.close();
  }
});

test("privacy preview blocks shared child records with ambiguous free text", async () => {
  const runtime = await database();
  try {
    insertOwner(runtime);
    runtime.sqliteDatabase.exec(`
      INSERT INTO children (id, name, birth_month, birth_year, color, created_at, updated_at, deleted_at)
      VALUES
        ('child-shared-text', 'Fictional selected child', 3, 2019, '#123456', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL),
        ('child-shared-other', 'Fictional retained child', 4, 2020, '#654321', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
      INSERT INTO care_entries (
        id, start_datetime, end_datetime, status, care_scope, notes, duration_minutes,
        created_by, updated_by, created_at, updated_at, deleted_at
      ) VALUES (
        'entry-shared-text', '2026-03-01T10:00:00.000Z', '2026-03-01T12:00:00.000Z',
        'completed', 'full_day', 'Fictional identifying note', 120,
        'owner-user', 'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO care_entry_children (care_entry_id, child_id, created_at, updated_at, deleted_at)
      VALUES
        ('entry-shared-text', 'child-shared-text', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL),
        ('entry-shared-text', 'child-shared-other', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
    `);
    const preview = await previewPrivacyAction(parsePrivacyActionPreviewRequest({
      subjectType: "child",
      subjectId: "child-shared-text",
      actions: [
        { category: "domain_records", action: "delete" },
        { category: "domain_relationships", action: "delete" },
        { category: "profile", action: "delete" }
      ]
    }), "owner-user", runtime.query);
    assert.equal(preview.result, "blocked");
    assert(preview.blockerCodes.includes("shared_record_requires_manual_review"));
  } finally {
    await runtime.close();
  }
});

test("privacy execution rejects a child erasure preview after a domain record changes", async () => {
  const runtime = await database();
  try {
    insertOwner(runtime);
    runtime.sqliteDatabase.exec(`
      INSERT INTO children (id, name, birth_month, birth_year, color, created_at, updated_at, deleted_at)
      VALUES ('child-delete-stale', 'Fictional stale child', 3, 2019, '#123456', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
      INSERT INTO care_entries (
        id, start_datetime, end_datetime, status, care_scope, duration_minutes,
        created_by, updated_by, created_at, updated_at, deleted_at
      ) VALUES (
        'entry-delete-stale', '2026-03-01T10:00:00.000Z', '2026-03-01T12:00:00.000Z',
        'completed', 'full_day', 120, 'owner-user', 'owner-user',
        CURRENT_TIMESTAMP, '2026-01-01T00:00:00.000Z', NULL
      );
      INSERT INTO care_entry_children (care_entry_id, child_id, created_at, updated_at, deleted_at)
      VALUES ('entry-delete-stale', 'child-delete-stale', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
    `);
    const request = parsePrivacyActionPreviewRequest({
      subjectType: "child",
      subjectId: "child-delete-stale",
      actions: [
        { category: "domain_records", action: "delete" },
        { category: "domain_relationships", action: "delete" },
        { category: "profile", action: "delete" }
      ]
    });
    const preview = await previewPrivacyAction(request, "owner-user", runtime.query);
    runtime.sqliteDatabase.prepare(`
      UPDATE care_entries SET notes = ?, updated_at = ? WHERE id = 'entry-delete-stale'
    `).run("Fictional later note", "2026-01-02T00:00:00.000Z");
    await assert.rejects(
      () => executePrivacyAction(
        { ...request, fingerprint: preview.fingerprint },
        "owner-user",
        runtime,
        "2026-10-10T14:08:00.000Z"
      ),
      (error: unknown) => error instanceof PrivacyActionError && error.code === "privacy_action_preview_changed"
    );
    assert.equal(Number((runtime.sqliteDatabase.prepare(
      "SELECT COUNT(*) AS count FROM children WHERE id = 'child-delete-stale'"
    ).get() as { count: number }).count), 1);
  } finally {
    await runtime.close();
  }
});

test("privacy execution rolls back the complete erasure graph when profile deletion fails", async () => {
  const runtime = await database();
  try {
    insertOwner(runtime);
    runtime.sqliteDatabase.exec(`
      INSERT INTO children (id, name, birth_month, birth_year, color, created_at, updated_at, deleted_at)
      VALUES ('child-delete-fail', 'Fictional rollback child', 3, 2019, '#123456', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
      INSERT INTO care_entries (
        id, start_datetime, end_datetime, status, care_scope, duration_minutes,
        created_by, updated_by, created_at, updated_at, deleted_at
      ) VALUES (
        'entry-delete-fail', '2026-03-01T10:00:00.000Z', '2026-03-01T12:00:00.000Z',
        'completed', 'full_day', 120, 'owner-user', 'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO care_entry_children (care_entry_id, child_id, created_at, updated_at, deleted_at)
      VALUES ('entry-delete-fail', 'child-delete-fail', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
      CREATE TRIGGER fail_child_privacy_delete BEFORE DELETE ON children
      WHEN OLD.id = 'child-delete-fail'
      BEGIN
        SELECT RAISE(ABORT, 'fixture failure');
      END;
    `);
    const request = parsePrivacyActionPreviewRequest({
      subjectType: "child",
      subjectId: "child-delete-fail",
      actions: [
        { category: "domain_records", action: "delete" },
        { category: "domain_relationships", action: "delete" },
        { category: "profile", action: "delete" }
      ]
    });
    const preview = await previewPrivacyAction(request, "owner-user", runtime.query);
    await assert.rejects(() => executePrivacyAction(
      { ...request, fingerprint: preview.fingerprint },
      "owner-user",
      runtime,
      "2026-10-10T14:10:00.000Z"
    ));
    assert.equal(Number((runtime.sqliteDatabase.prepare(
      "SELECT COUNT(*) AS count FROM children WHERE id = 'child-delete-fail'"
    ).get() as { count: number }).count), 1);
    assert.equal(Number((runtime.sqliteDatabase.prepare(
      "SELECT COUNT(*) AS count FROM care_entries WHERE id = 'entry-delete-fail'"
    ).get() as { count: number }).count), 1);
    assert.equal(Number((runtime.sqliteDatabase.prepare(
      "SELECT COUNT(*) AS count FROM care_entry_children WHERE child_id = 'child-delete-fail'"
    ).get() as { count: number }).count), 1);
    assert.equal(Number((runtime.sqliteDatabase.prepare(
      "SELECT COUNT(*) AS count FROM privacy_action_runs"
    ).get() as { count: number }).count), 0);
  } finally {
    await runtime.close();
  }
});

test("privacy execution deletes approved historical transfer state for a detached user", async () => {
  const runtime = await database();
  try {
    insertRevocationFixture(runtime);
    runtime.sqliteDatabase.exec(`
      INSERT INTO data_transfer_runs (
        id, package_fingerprint, format_version, source_version, result,
        counts_json, created_by, created_at
      ) VALUES (
        'transfer-delete', 'fixture-fingerprint-delete', 1, '1.0.0',
        'imported', '{}', 'owner-user', CURRENT_TIMESTAMP
      );
      INSERT INTO data_transfer_actors (
        id, transfer_run_id, source_ref, display_name, email_hint,
        mapped_user_id, created_by, updated_by, created_at, updated_at
      ) VALUES (
        'transfer-actor-delete', 'transfer-delete', 'fixture-source-ref',
        'Fictional historical actor', 'actor@example.invalid', 'target-user',
        'owner-user', 'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
    `);
    const request = parsePrivacyActionPreviewRequest({
      subjectType: "user",
      subjectId: "target-user",
      actions: [
        { category: "access", action: "revoke" },
        { category: "authentication_identity", action: "detach" },
        { category: "domain_relationships", action: "delete" },
        { category: "runtime_channels", action: "revoke" },
        { category: "transfer_state", action: "delete" }
      ]
    });
    const preview = await previewPrivacyAction(request, "owner-user", runtime.query);
    assert.notEqual(preview.result, "blocked");
    await executePrivacyAction(
      { ...request, fingerprint: preview.fingerprint },
      "owner-user",
      runtime,
      "2026-10-10T14:15:00.000Z"
    );
    assert.equal(Number((runtime.sqliteDatabase.prepare(
      "SELECT COUNT(*) AS count FROM data_transfer_actors WHERE id = 'transfer-actor-delete'"
    ).get() as { count: number }).count), 0);
  } finally {
    await runtime.close();
  }
});

test("privacy preview blocks care-party record deletion that would remove child data", async () => {
  const runtime = await database();
  try {
    insertOwner(runtime);
    runtime.sqliteDatabase.exec(`
      INSERT INTO care_parties (
        id, name, kind, created_by, updated_by, created_at, updated_at, deleted_at
      ) VALUES (
        'party-shared-delete', 'Fictional caregiver', 'other', 'owner-user',
        'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO children (id, name, birth_month, birth_year, color, created_at, updated_at, deleted_at)
      VALUES ('child-party-shared', 'Fictional linked child', 3, 2019, '#123456', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
      INSERT INTO care_entries (
        id, start_datetime, end_datetime, status, care_scope, duration_minutes,
        responsible_party_id, created_by, updated_by, created_at, updated_at, deleted_at
      ) VALUES (
        'entry-party-shared', '2026-03-01T10:00:00.000Z', '2026-03-01T12:00:00.000Z',
        'completed', 'full_day', 120, 'party-shared-delete', 'owner-user',
        'owner-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
      );
      INSERT INTO care_entry_children (care_entry_id, child_id, created_at, updated_at, deleted_at)
      VALUES ('entry-party-shared', 'child-party-shared', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
    `);
    const preview = await previewPrivacyAction(parsePrivacyActionPreviewRequest({
      subjectType: "care_party",
      subjectId: "party-shared-delete",
      actions: [
        { category: "domain_records", action: "delete" },
        { category: "profile", action: "delete" }
      ]
    }), "owner-user", runtime.query);
    assert.equal(preview.result, "blocked");
    assert(preview.blockerCodes.includes("shared_record_requires_manual_review"));
  } finally {
    await runtime.close();
  }
});

test("privacy preview route is no-store and validation errors are generic", async () => {
  const runtime = await database();
  const app = Fastify();
  app.decorate("persistence", runtime);
  app.addHook("onRequest", async (request) => {
    request.userEmail = "owner-user";
    request.user = { id: "owner-user" } as RequestUser;
  });
  await privacyActionRoutes(app);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/privacy-actions/preview",
      payload: { subjectType: "user", subjectId: "PRIVATE_MARKER", actions: [] }
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: "privacy_action_invalid",
      message: "The privacy action preview could not be completed."
    });
    assert.equal(response.body.includes("PRIVATE_MARKER"), false);
    assert.match(response.headers["cache-control"] ?? "", /no-store/);
  } finally {
    await app.close();
    await runtime.close();
  }
});

test("privacy preview route reports unexpected failures as generic server errors", async () => {
  const app = Fastify({ logger: false });
  app.decorate("persistence", {
    query: {
      selectFrom() {
        throw new Error("PRIVATE_DATABASE_DETAIL");
      }
    }
  } as unknown as Awaited<ReturnType<typeof database>>);
  app.addHook("onRequest", async (request) => {
    request.userEmail = "owner-user";
    request.user = { id: "owner-user" } as RequestUser;
  });
  await privacyActionRoutes(app);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/privacy-actions/preview",
      payload: {
        subjectType: "user",
        subjectId: "target-user",
        actions: [{ category: "access", action: "revoke" }]
      }
    });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), {
      error: "privacy_action_failed",
      message: "The privacy action preview could not be completed."
    });
    assert.equal(response.body.includes("PRIVATE_DATABASE_DETAIL"), false);
    assert.match(response.headers["cache-control"] ?? "", /no-store/);
  } finally {
    await app.close();
  }
});

test("privacy execution and result routes are no-store and reject stale fingerprints generically", async () => {
  const runtime = await database();
  insertRevocationFixture(runtime);
  const app = Fastify();
  app.decorate("persistence", runtime);
  app.addHook("onRequest", async (request) => {
    request.userEmail = "owner-user";
    request.user = { id: "owner-user" } as RequestUser;
  });
  await privacyActionRoutes(app);
  try {
    const request = completeRevocationRequest();
    const preview = await previewPrivacyAction(request, "owner-user", runtime.query);
    const changed = await app.inject({
      method: "POST",
      url: "/api/privacy-actions/execute",
      payload: { ...request, fingerprint: "0".repeat(64) }
    });
    assert.equal(changed.statusCode, 409);
    assert.deepEqual(changed.json(), {
      error: "privacy_action_preview_changed",
      message: "The privacy action could not be completed."
    });
    assert.match(changed.headers["cache-control"] ?? "", /no-store/);

    const executed = await app.inject({
      method: "POST",
      url: "/api/privacy-actions/execute",
      payload: { ...request, fingerprint: preview.fingerprint }
    });
    assert.equal(executed.statusCode, 200);
    assert.match(executed.headers["cache-control"] ?? "", /no-store/);
    const result = executed.json<{ id: string }>();
    const loaded = await app.inject({
      method: "GET",
      url: `/api/privacy-actions/${result.id}/result`
    });
    assert.equal(loaded.statusCode, 200);
    assert.equal(loaded.json<{ id: string }>().id, result.id);
    assert.match(loaded.headers["cache-control"] ?? "", /no-store/);
  } finally {
    await app.close();
    await runtime.close();
  }
});
