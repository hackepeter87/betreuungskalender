import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { RequestUser } from "./auth.js";
import { createSqlitePersistenceRuntime } from "./db/runtime.js";
import { privacyActionRoutes } from "./routes/privacyActions.js";
import {
  parsePrivacyActionPreviewRequest,
  previewPrivacyAction,
  privacyActionPreviewMatches
} from "./services/privacyActions.js";

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
        { category: "authentication_identity", action: "detach" },
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

test("privacy preview classifies child relationships for manual review", async () => {
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
    assert.equal(preview.result, "warnings");
    assert.equal(preview.categories.find(({ code }) => code === "domain_records")?.status, "manual_review");
    assert.deepEqual(preview.warningCodes, ["shared_records_require_review"]);
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
