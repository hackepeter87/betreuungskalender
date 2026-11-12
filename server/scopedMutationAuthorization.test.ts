import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRole, type RequestUser } from "./auth.js";
import { createSqlitePersistenceRuntime } from "./db/runtime.js";
import {
  assertCanUsePersistedCarePartyInScope,
  claimCurrentScopedRecord,
  CurrentRecordChangedError,
  lockPersistedCareDataScope
} from "./services/domainPersistence.js";
import { upsertAuthenticatedUser } from "./services/users.js";

const firstTimestamp = "2026-11-12T08:00:00.000Z";
const secondTimestamp = "2026-11-12T08:01:00.000Z";

function memberUser(): RequestUser {
  return {
    id: "scoped-member",
    externalSubject: "subject-scoped-member",
    email: "scoped-member@example.invalid",
    displayName: "Scoped Member",
    groups: [],
    role: "parent",
    permissions: permissionsForRole("parent"),
    workspaceRole: "editor",
    workspaceAccess: true
  };
}

test("scoped mutation authorization locks current scope and rejects stale records", async () => {
  const runtime = createSqlitePersistenceRuntime(":memory:");
  await runtime.migrate();
  const user = memberUser();
  try {
    await upsertAuthenticatedUser(user, runtime.query, firstTimestamp);
    await runtime.query.insertInto("care_parties").values([
      {
        id: "party-alpha",
        name: "Alpha Betreuung",
        kind: "other",
        created_by: user.id,
        updated_by: user.id,
        created_at: firstTimestamp,
        updated_at: firstTimestamp,
        deleted_at: null
      },
      {
        id: "party-beta",
        name: "Beta Betreuung",
        kind: "other",
        created_by: user.id,
        updated_by: user.id,
        created_at: firstTimestamp,
        updated_at: firstTimestamp,
        deleted_at: null
      }
    ]).execute();
    await runtime.query.insertInto("app_memberships").values({
      id: "membership-scoped-member",
      user_id: user.id,
      role: "editor",
      care_scope_type: "selected",
      created_by: user.id,
      updated_by: user.id,
      created_at: firstTimestamp,
      updated_at: firstTimestamp,
      deleted_at: null
    }).execute();
    await runtime.query.insertInto("app_user_care_party_assignments").values({
      id: "assignment-alpha",
      user_id: user.id,
      care_party_id: "party-alpha",
      created_by: user.id,
      updated_by: user.id,
      created_at: firstTimestamp,
      updated_at: firstTimestamp,
      deleted_at: null
    }).execute();

    await runtime.transaction(async (database) => {
      const scope = await lockPersistedCareDataScope(database, user);
      assert.deepEqual(scope, { type: "selected", carePartyIds: ["party-alpha"] });
      await assertCanUsePersistedCarePartyInScope(database, scope, "party-alpha");
      await assert.rejects(
        assertCanUsePersistedCarePartyInScope(database, scope, "party-beta"),
        { code: "forbidden" }
      );
    });

    await runtime.query.updateTable("app_user_care_party_assignments")
      .set({ deleted_at: secondTimestamp, updated_at: secondTimestamp })
      .where("id", "=", "assignment-alpha")
      .execute();
    await runtime.query.insertInto("app_user_care_party_assignments").values({
      id: "assignment-beta",
      user_id: user.id,
      care_party_id: "party-beta",
      created_by: user.id,
      updated_by: user.id,
      created_at: secondTimestamp,
      updated_at: secondTimestamp,
      deleted_at: null
    }).execute();

    await runtime.transaction(async (database) => {
      const scope = await lockPersistedCareDataScope(database, user);
      assert.deepEqual(scope, { type: "selected", carePartyIds: ["party-beta"] });
      await assert.rejects(
        assertCanUsePersistedCarePartyInScope(database, scope, "party-alpha"),
        { code: "forbidden" }
      );
      await assertCanUsePersistedCarePartyInScope(database, scope, "party-beta");
    });

    await runtime.query.insertInto("care_entries").values({
      id: "stale-entry",
      responsible_party_id: "party-beta",
      start_datetime: "2026-11-14T08:00:00.000Z",
      end_datetime: "2026-11-14T18:00:00.000Z",
      status: "planned",
      care_scope: "full_day",
      overnight: 0,
      holiday: 0,
      duration_minutes: 600,
      created_by: user.id,
      updated_by: user.id,
      created_at: firstTimestamp,
      updated_at: firstTimestamp,
      deleted_at: null
    }).execute();
    await runtime.query.insertInto("contact_rules").values({
      id: "stale-rule",
      name: "Testregel",
      start_date: "2026-11-14",
      end_date: null,
      timezone: "Europe/Berlin",
      recurrence_json: JSON.stringify({ kind: "weekly", intervalWeeks: 1, weekdays: ["SA"] }),
      segments_json: JSON.stringify([]),
      sync_horizon_months: 12,
      responsible_party_id: "party-beta",
      active: 1,
      source_contact_pattern_id: null,
      created_by: user.id,
      updated_by: user.id,
      created_at: firstTimestamp,
      updated_at: firstTimestamp,
      deleted_at: null
    }).execute();
    await runtime.query.insertInto("unavailable_periods").values({
      id: "stale-unavailable",
      start_datetime: "2026-11-15T08:00:00.000Z",
      end_datetime: "2026-11-15T18:00:00.000Z",
      scope: "own_unavailability",
      responsible_party_id: "party-beta",
      category: "other",
      duty_related: 0,
      affects_contact: 0,
      affects_holidays: 0,
      location: null,
      notes: null,
      has_evidence: 0,
      evidence_reference: null,
      created_by: user.id,
      updated_by: user.id,
      created_at: firstTimestamp,
      updated_at: firstTimestamp,
      deleted_at: null
    }).execute();

    for (const [table, id] of [
      ["care_entries", "stale-entry"],
      ["contact_rules", "stale-rule"],
      ["unavailable_periods", "stale-unavailable"]
    ] as const) {
      await runtime.query.updateTable(table)
        .set({ updated_at: secondTimestamp })
        .where("id", "=", id)
        .execute();
      await assert.rejects(
        runtime.transaction((database) =>
          claimCurrentScopedRecord(database, table, id, firstTimestamp)
        ),
        CurrentRecordChangedError
      );
    }

    await assert.rejects(
      runtime.transaction(async (database) => {
        await claimCurrentScopedRecord(database, "care_entries", "stale-entry", secondTimestamp);
        await database.updateTable("care_entries")
          .set({ notes: "must roll back" })
          .where("id", "=", "stale-entry")
          .execute();
        throw new Error("rollback fixture");
      }),
      /rollback fixture/
    );
    assert.equal(
      (await runtime.query.selectFrom("care_entries")
        .select("notes")
        .where("id", "=", "stale-entry")
        .executeTakeFirstOrThrow()).notes,
      null
    );
  } finally {
    await runtime.close();
  }
});
