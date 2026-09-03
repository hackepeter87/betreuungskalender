import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Fastify from "fastify";
import { Pool } from "pg";
import { permissionsForRole, type AuthRole, type RequestUser } from "./auth.js";
import {
  classifyDatabaseError,
  createPersistenceRuntime,
  createSqlitePersistenceRuntime,
  type PersistenceRuntime,
  type PostgresPersistenceOptions
} from "./db/runtime.js";
import { clearDomainData, importData } from "./routes/appData.js";
import { auditRoutes } from "./routes/audit.js";
import {
  calendarFeedStatus,
  resolveCalendarFeedToken,
  rotateCalendarFeedToken
} from "./services/calendarFeeds.js";
import { listCareConflicts, previewPlannedCareConflicts } from "./services/careConflicts.js";
import {
  getNotificationPreferences,
  updateNotificationPreferences
} from "./services/careConfirmations.js";
import {
  previewContactRuleSync,
  syncContactRule,
  upsertContactRuleFromPattern
} from "./services/contactRules.js";
import {
  createPortableTransfer,
  dryRunPortableTransfer,
  exportDomainData,
  importPortableTransfer,
  listTransferActors
} from "./services/dataTransfer.js";
import { createEdgeCaseDemoData } from "./services/demoFixtures.js";
import { acceptInvitation, createInvitation, listInvitations } from "./services/invitations.js";
import { listMembers, updateMemberRole } from "./services/memberManagement.js";
import { createReportSnapshot } from "./services/reportSnapshots.js";
import { completeFirstUseSetup } from "./services/setupBootstrap.js";
import { findAuthenticatedUserBySubject, upsertAuthenticatedUser } from "./services/users.js";

const timestamp = "2026-07-01T08:00:00.000Z";
const postgresConfigured = Boolean(
  process.env.TEST_POSTGRES_HOST && process.env.TEST_POSTGRES_PASSWORD_FILE
);

function postgresOptions(): PostgresPersistenceOptions {
  return {
    driver: "postgres",
    host: process.env.TEST_POSTGRES_HOST ?? "127.0.0.1",
    port: Number(process.env.TEST_POSTGRES_PORT ?? 5432),
    database: process.env.TEST_POSTGRES_DATABASE ?? "betreuungskalender_test",
    user: process.env.TEST_POSTGRES_USER ?? "postgres",
    passwordFile: process.env.TEST_POSTGRES_PASSWORD_FILE ?? "",
    tlsMode: "disable"
  };
}

async function resetPostgresSchema(): Promise<void> {
  const options = postgresOptions();
  const password = (await readFile(options.passwordFile, "utf8")).trim();
  const admin = new Pool({
    host: options.host,
    port: options.port,
    database: options.database,
    user: options.user,
    password
  });
  try {
    await admin.query("DROP SCHEMA public CASCADE");
    await admin.query("CREATE SCHEMA public");
  } finally {
    await admin.end();
  }
}

async function sqliteRuntime(): Promise<PersistenceRuntime> {
  const runtime = createSqlitePersistenceRuntime(":memory:");
  await runtime.migrate();
  return runtime;
}

async function postgresRuntime(): Promise<PersistenceRuntime> {
  await resetPostgresSchema();
  const runtime = createPersistenceRuntime(postgresOptions());
  await runtime.migrate();
  return runtime;
}

function user(id: string, role: AuthRole): RequestUser {
  return {
    id,
    externalSubject: `subject-${id}`,
    email: `${id}@example.invalid`,
    displayName: id === "demo-fixture" ? "Demo Owner" : "Demo Member",
    groups: [],
    role,
    permissions: permissionsForRole(role)
  };
}

async function insertOwnerSetting(runtime: PersistenceRuntime, ownerId: string): Promise<void> {
  await runtime.query.insertInto("settings").values({
    key: "setup.ownerUserId",
    value_json: JSON.stringify(ownerId),
    created_by: ownerId,
    updated_by: ownerId,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null
  }).onConflict((conflict) => conflict.column("key").doUpdateSet({
    value_json: JSON.stringify(ownerId),
    updated_by: ownerId,
    updated_at: timestamp,
    deleted_at: null
  })).execute();
}

type DataRecord = Record<string, unknown>;

function recordId(record: DataRecord): string {
  return String(record.id ?? "");
}

function stableEntryId(record: DataRecord): string {
  const occurrenceKey = record.contactRuleOccurrenceKey;
  return typeof occurrenceKey === "string" && occurrenceKey
    ? `occurrence:${occurrenceKey}`
    : recordId(record);
}

function recordStrings(record: DataRecord, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.map(String).sort() : [];
}

function recordCount(record: DataRecord, key: string): number {
  return Array.isArray(record[key]) ? record[key].length : 0;
}

function sortedIds(records: DataRecord[]): string[] {
  return records.map(recordId).sort();
}

async function domainSummary(runtime: PersistenceRuntime) {
  const data = await runtime.transaction(exportDomainData);
  return {
    children: data.children.map((child) => ({
      id: recordId(child),
      name: String(child.name ?? ""),
      birthMonth: Number(child.birthMonth),
      birthYear: Number(child.birthYear),
      color: String(child.color ?? "")
    })).sort((left, right) => left.id.localeCompare(right.id)),
    careParties: data.careParties.map((party) => ({
      id: recordId(party),
      name: String(party.name ?? ""),
      kind: String(party.kind ?? "")
    })).sort((left, right) => left.id.localeCompare(right.id)),
    entries: data.entries.map((entry) => ({
      id: stableEntryId(entry),
      startDateTime: String(entry.startDateTime ?? ""),
      endDateTime: String(entry.endDateTime ?? ""),
      status: String(entry.status ?? ""),
      childIds: recordStrings(entry, "childIds"),
      tripCount: recordCount(entry, "trips"),
      costCount: recordCount(entry, "costs"),
      overnight: Boolean(entry.overnight),
      holiday: Boolean(entry.holiday)
    })).sort((left, right) => left.id.localeCompare(right.id)),
    holidays: sortedIds(data.holidayPeriods),
    unavailable: sortedIds(data.unavailablePeriods),
    externalSources: sortedIds(data.externalCalendarSources),
    externalEvents: sortedIds(data.externalCalendarEvents),
    contactPatterns: sortedIds(data.contactPatterns),
    contactRules: sortedIds(data.contactRules),
    monthClosures: data.monthClosures.map((closing) => String(closing.monthKey ?? "")).sort(),
    settings: data.settings
  };
}

async function transferAuditSummary(runtime: PersistenceRuntime) {
  const data = await runtime.transaction(exportDomainData);
  return data.auditLog.map((entry) => ({
    objectType: String(entry.objectType ?? ""),
    objectId: String(entry.objectId ?? ""),
    field: String(entry.field ?? ""),
    oldValue: String(entry.oldValue ?? ""),
    newValue: String(entry.newValue ?? ""),
    action: String(entry.action ?? "")
  }));
}

function assertContainsAuditHistory(
  target: Awaited<ReturnType<typeof transferAuditSummary>>,
  source: Awaited<ReturnType<typeof transferAuditSummary>>
): void {
  const targetCounts = new Map<string, number>();
  for (const entry of target) {
    const key = JSON.stringify(entry);
    targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
  }
  for (const entry of source) {
    const key = JSON.stringify(entry);
    const available = targetCounts.get(key) ?? 0;
    assert.equal(available > 0, true, `missing transferred audit record: ${key}`);
    targetCounts.set(key, available - 1);
  }
}

async function auditPaginationSummary(runtime: PersistenceRuntime) {
  const app = Fastify();
  app.decorate("persistence", runtime);
  await auditRoutes(app);
  try {
    const firstResponse = await app.inject({
      method: "GET",
      url: "/api/audit-log/page?limit=2"
    });
    assert.equal(firstResponse.statusCode, 200);
    const first = firstResponse.json<{
      items: Array<{ id: unknown; entityType: string; action: string; userDisplayName?: string }>;
      nextCursor?: string;
    }>();
    assert.ok(first.nextCursor);
    const secondResponse = await app.inject({
      method: "GET",
      url: `/api/audit-log/page?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`
    });
    assert.equal(secondResponse.statusCode, 200);
    const second = secondResponse.json<{
      items: Array<{ id: unknown; entityType: string; action: string; userDisplayName?: string }>;
      nextCursor?: string;
    }>();
    return {
      first: first.items.map(({ id, entityType, action, userDisplayName }) => ({
        idType: typeof id,
        entityType,
        action,
        userDisplayName: userDisplayName ?? null
      })),
      second: second.items.map(({ id, entityType, action, userDisplayName }) => ({
        idType: typeof id,
        entityType,
        action,
        userDisplayName: userDisplayName ?? null
      })),
      hasFurtherPage: Boolean(second.nextCursor)
    };
  } finally {
    await app.close();
  }
}

async function runApplicationScenario(runtime: PersistenceRuntime) {
  const owner = user("demo-fixture", "admin");
  await upsertAuthenticatedUser(owner, runtime.query, timestamp);
  const strictBeforeSetup = await findAuthenticatedUserBySubject(owner.externalSubject, runtime.query);
  const compatibleBeforeSetup = await findAuthenticatedUserBySubject(
    owner.externalSubject,
    runtime.query,
    "legacy-pre-owner"
  );

  const setup = await completeFirstUseSetup(owner, {
    installationLabel: "Parity fixture",
    careParty: { name: "Primary fixture", kind: "father" },
    secondaryCareParty: { name: "Secondary fixture", kind: "mother" },
    primaryCareParty: "primary",
    defaultCareParty: "secondary",
    children: [
      { name: "Setup fixture", birthMonth: 2, birthYear: 2018, color: "#0d9488" }
    ]
  }, runtime, timestamp);
  const strictAfterSetup = await findAuthenticatedUserBySubject(owner.externalSubject, runtime.query);

  await runtime.transaction((database) => importData(createEdgeCaseDemoData(), owner.id, database));
  await runtime.transaction(async (database) => {
    await upsertContactRuleFromPattern({
      id: "demo-pattern-biweekly-weekend",
      name: "Alle 14 Tage Freitag bis Sonntag",
      startDate: "2026-07-10",
      fridayStartTime: "15:30",
      sundayEndTime: "16:00",
      childIds: ["demo-child-alpha", "demo-child-beta", "demo-child-gamma"],
      responsiblePartyId: "demo-party-primary",
      active: true,
      createdBy: owner.id,
      updatedBy: owner.id,
      createdAt: timestamp,
      updatedAt: timestamp
    }, database);
  });
  const syncPreview = await previewContactRuleSync("demo-pattern-biweekly-weekend", {
    startDate: "2026-07-10",
    endDate: "2026-08-31",
    now: "2026-09-01T00:00:00.000Z",
    database: runtime.query
  });
  const sync = await runtime.transaction((database) => syncContactRule(
    "demo-pattern-biweekly-weekend",
    {
      startDate: "2026-07-10",
      endDate: "2026-08-31",
      now: "2026-09-01T00:00:00.000Z",
      userEmail: owner.id,
      database,
      previewFingerprint: syncPreview.fingerprint,
      suppressPastConfirmations: true,
      strictWindow: true
    }
  ));

  const invited = user("invited-member", "parent");
  const createdInvitation = await createInvitation({
    role: "editor",
    actorId: owner.id,
    emailHint: invited.email,
    token: "parity-invitation-token",
    timestamp: "2026-07-01T09:00:00.000Z",
    expiresAt: "2026-07-08T09:00:00.000Z"
  }, runtime.query);
  const acceptedInvitation = await acceptInvitation(
    createdInvitation.token,
    invited,
    runtime,
    "2026-07-01T10:00:00.000Z"
  );
  await updateMemberRole(owner, invited.id, "scheduler", runtime, "2026-07-01T11:00:00.000Z");
  await updateMemberRole(owner, invited.id, "editor", runtime, "2026-07-01T12:00:00.000Z");
  const acceptedUser = await findAuthenticatedUserBySubject(invited.externalSubject, runtime.query);
  const feed = await rotateCalendarFeedToken(invited.id, "all", runtime);
  const resolvedFeed = await resolveCalendarFeedToken(feed.token, runtime.query);
  const notificationPreferences = await updateNotificationPreferences(runtime, invited.id, [{
    eventType: "care_confirmation_due",
    inAppEnabled: true,
    pushEnabled: false,
    emailEnabled: false
  }]);
  const storedPreferences = await getNotificationPreferences(runtime.query, invited.id);

  const conflictPreview = await previewPlannedCareConflicts({
    status: "planned",
    startDateTime: "2026-07-10T16:00:00.000Z",
    endDateTime: "2026-07-10T18:00:00.000Z",
    childIds: ["demo-child-alpha"]
  }, runtime.query);
  const conflicts = await listCareConflicts(runtime.query);
  const report = await createReportSnapshot({
    persistence: runtime,
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    includeAuditHistory: true
  });
  const auditPagination = await auditPaginationSummary(runtime);

  await runtime.query.insertInto("children").values({
    id: "soft-deleted-child",
    name: "Soft deleted fixture",
    birth_month: 1,
    birth_year: 2018,
    color: "#000000",
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: timestamp
  }).execute();

  let constraintKind = "none";
  try {
    await runtime.query.insertInto("children").values({
      id: "demo-child-alpha",
      name: "Duplicate fixture",
      birth_month: 1,
      birth_year: 2018,
      color: "#000000",
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null
    }).execute();
  } catch (error) {
    constraintKind = classifyDatabaseError(error).kind;
  }

  const childrenBeforeRollback = await runtime.query.selectFrom("children")
    .select(({ fn }) => fn.count<number>("id").as("count"))
    .where("deleted_at", "is", null)
    .executeTakeFirstOrThrow();
  await assert.rejects(runtime.transaction(async (database) => {
    await clearDomainData(database);
    throw new Error("simulated destructive-operation failure");
  }), /simulated destructive-operation failure/);
  const childrenAfterRollback = await runtime.query.selectFrom("children")
    .select(({ fn }) => fn.count<number>("id").as("count"))
    .where("deleted_at", "is", null)
    .executeTakeFirstOrThrow();

  const members = await listMembers(runtime.query, { includeLocalDevelopmentIdentity: false });
  const invitations = await listInvitations(runtime.query);
  const status = await calendarFeedStatus(invited.id, "all", runtime.query);
  const domain = await domainSummary(runtime);
  const integrity = await runtime.integrity();

  return {
    driver: runtime.driver,
    setup: {
      strictBeforeSetup: strictBeforeSetup?.workspaceAccess ?? false,
      compatibleBeforeSetup: compatibleBeforeSetup?.workspaceAccess ?? false,
      complete: setup.setup.complete,
      childCount: setup.created.childIds.length,
      hasPrimaryParty: Boolean(setup.created.primaryCarePartyId),
      hasDefaultParty: Boolean(setup.created.defaultCarePartyId),
      strictAfterSetup: strictAfterSetup?.workspaceAccess ?? false
    },
    ruleSync: {
      previewCreate: syncPreview.create,
      created: sync.created,
      updated: sync.updated,
      startDate: sync.startDate,
      endDate: sync.endDate
    },
    invitation: {
      role: acceptedInvitation.role,
      accepted: Boolean(acceptedInvitation.acceptedAt),
      listed: invitations.length,
      userWorkspaceRole: acceptedUser?.workspaceRole,
      userWorkspaceAccess: acceptedUser?.workspaceAccess
    },
    members: members.map(({ displayName, effectiveRole, membershipRole, owner: isOwner, workspaceAccess }) => ({
      displayName, effectiveRole, membershipRole, owner: isOwner, workspaceAccess
    })),
    feed: {
      active: status.active,
      scope: status.scope,
      resolved: resolvedFeed?.user_id === invited.id
    },
    notifications: {
      updated: notificationPreferences.preferences.find(
        ({ eventType }) => eventType === "care_confirmation_due"
      )?.pushEnabled,
      stored: storedPreferences.preferences.find(
        ({ eventType }) => eventType === "care_confirmation_due"
      )?.pushEnabled
    },
    conflicts: {
      previewCount: conflictPreview.conflicts.length,
      storedCount: conflicts.length
    },
    report: {
      entryIds: report.data.entries.map((entry) => stableEntryId(entry as unknown as DataRecord)).sort(),
      holidayCount: report.data.holidayPeriods.length,
      unavailableCount: report.data.unavailablePeriods.length,
      auditActions: report.data.auditLog.map(({ action }) => action).sort(),
      auditActors: report.data.auditLog.map(({ userDisplayName }) => userDisplayName ?? null).sort()
    },
    auditPagination,
    rollback: {
      constraintKind,
      before: Number(childrenBeforeRollback.count),
      after: Number(childrenAfterRollback.count)
    },
    domain,
    softDeletedChildExported: domain.children.some(({ id }) => id === "soft-deleted-child"),
    integrity
  };
}

function withoutDriver<T extends { driver: string }>(result: T): Omit<T, "driver"> {
  const { driver: _driver, ...rest } = result;
  return rest;
}

async function prepareTransferSource(runtime: PersistenceRuntime): Promise<void> {
  await upsertAuthenticatedUser(user("demo-fixture", "admin"), runtime.query, timestamp);
  await insertOwnerSetting(runtime, "demo-fixture");
  await runtime.transaction((database) => importData(createEdgeCaseDemoData(), "demo-fixture", database));
}

async function setTransferTargetOwner(runtime: PersistenceRuntime): Promise<void> {
  const owner = user("target-owner", "admin");
  await upsertAuthenticatedUser(owner, runtime.query, timestamp);
  await insertOwnerSetting(runtime, owner.id);
}

async function transferBetween(source: PersistenceRuntime, target: PersistenceRuntime) {
  await prepareTransferSource(source);
  await setTransferTargetOwner(target);
  const packageData = await createPortableTransfer(source);
  const before = await domainSummary(target);
  const dryRun = await dryRunPortableTransfer(packageData, target);
  assert.deepEqual(await domainSummary(target), before, "dry run must not mutate the target");
  assert.equal(dryRun.result, "ready");
  assert.deepEqual(dryRun.skippedRuntimeCodes, [
    "identity",
    "sessions",
    "feeds_push",
    "credentials",
    "external_urls"
  ]);

  await assert.rejects(importPortableTransfer({
    package: packageData,
    fingerprint: "0".repeat(64),
    dryRunReceipt: dryRun.dryRunReceipt!,
    confirmWarnings: false,
    actorId: "target-owner"
  }, target), /differs from the tested package/);
  await assert.rejects(importPortableTransfer({
    package: packageData,
    fingerprint: dryRun.fingerprint,
    dryRunReceipt: "stale-dry-run-receipt",
    confirmWarnings: false,
    actorId: "target-owner"
  }, target), /current successful dry run/);
  const tampered = structuredClone(packageData);
  tampered.data.children[0]!.name = "Tampered fixture";
  await assert.rejects(dryRunPortableTransfer(tampered, target), /checksum is invalid/);
  const invalidReferences = createEdgeCaseDemoData();
  invalidReferences.entries[0]!.childIds = ["missing-child"];
  assert.equal((await dryRunPortableTransfer(invalidReferences, target)).result, "blocked");
  assert.deepEqual(await domainSummary(target), before, "rejected packages must not mutate the target");

  await importPortableTransfer({
    package: packageData,
    fingerprint: dryRun.fingerprint,
    dryRunReceipt: dryRun.dryRunReceipt!,
    confirmWarnings: false,
    actorId: "target-owner"
  }, target);
  const ownerSetting = await target.query.selectFrom("settings")
    .select("value_json")
    .where("key", "=", "setup.ownerUserId")
    .executeTakeFirstOrThrow();
  const actors = await listTransferActors(target.query);
  return {
    source: await domainSummary(source),
    target: await domainSummary(target),
    sourceAudit: await transferAuditSummary(source),
    targetAudit: await transferAuditSummary(target),
    owner: JSON.parse(ownerSetting.value_json) as unknown,
    actorCount: actors.length,
    actorsUnmapped: actors.every((actor) => !actor.mappedUserId),
    integrity: await target.integrity()
  };
}

test("SQLite exercises the complete application parity scenario", async () => {
  const runtime = await sqliteRuntime();
  try {
    const result = await runApplicationScenario(runtime);
    assert.equal(result.setup.strictBeforeSetup, false);
    assert.equal(result.setup.compatibleBeforeSetup, true);
    assert.equal(result.setup.strictAfterSetup, true);
    assert.equal(result.invitation.userWorkspaceRole, "editor");
    assert.equal(result.feed.resolved, true);
    assert.equal(result.rollback.constraintKind, "constraint");
    assert.equal(result.rollback.after, result.rollback.before);
    assert.equal(result.softDeletedChildExported, false);
    assert.equal(result.auditPagination.first.every(({ idType }) => idType === "number"), true);
    assert.equal(result.integrity.valid, true);
  } finally {
    await runtime.close();
  }
});

test("PostgreSQL produces the same application results as SQLite", {
  skip: !postgresConfigured
}, async () => {
  const sqlite = await sqliteRuntime();
  const postgres = await postgresRuntime();
  try {
    const [sqliteResult, postgresResult] = await Promise.all([
      runApplicationScenario(sqlite),
      runApplicationScenario(postgres)
    ]);
    assert.deepEqual(withoutDriver(postgresResult), withoutDriver(sqliteResult));
  } finally {
    await Promise.all([sqlite.close(), postgres.close()]);
  }
});

test("portable transfers remain atomic from SQLite to PostgreSQL and back", {
  skip: !postgresConfigured
}, async () => {
  const sqliteSource = await sqliteRuntime();
  const postgresTarget = await postgresRuntime();
  try {
    const result = await transferBetween(sqliteSource, postgresTarget);
    assert.deepEqual(result.target, result.source);
    assertContainsAuditHistory(result.targetAudit, result.sourceAudit);
    assert.equal(result.owner, "target-owner");
    assert.equal(result.actorCount > 0, true);
    assert.equal(result.actorsUnmapped, true);
    assert.deepEqual(result.integrity, { valid: true, foreignKeyViolations: 0 });
  } finally {
    await Promise.all([sqliteSource.close(), postgresTarget.close()]);
  }

  const postgresSource = await postgresRuntime();
  const sqliteTarget = await sqliteRuntime();
  try {
    const result = await transferBetween(postgresSource, sqliteTarget);
    assert.deepEqual(result.target, result.source);
    assertContainsAuditHistory(result.targetAudit, result.sourceAudit);
    assert.equal(result.owner, "target-owner");
    assert.equal(result.actorCount > 0, true);
    assert.equal(result.actorsUnmapped, true);
    assert.deepEqual(result.integrity, { valid: true, foreignKeyViolations: 0 });
  } finally {
    await Promise.all([postgresSource.close(), sqliteTarget.close()]);
  }
});
