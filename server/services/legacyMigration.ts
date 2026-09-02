import type {
  LegacyDataCounts,
  LegacyDatabaseSummary,
  LegacyDuplicatePolicy,
  LegacyMigrationIssue,
  LegacyMigrationPreview,
  LegacyMigrationReport,
  LegacyMigrationMode
} from "../../shared/migration.js";
import type { DatabaseExecutor, PersistenceRuntime } from "../db/runtime.js";
import {
  clearDomainData,
  importData,
  insertChild,
  insertEntry,
  insertHoliday,
  insertPattern,
  insertUnavailable
} from "../routes/appData.js";
import { markDomainClosedMonthsChanged, recordDomainAudit } from "./domainPersistence.js";
import { createSqliteBackup } from "./backup.js";
import { makeId, nowIso } from "./common.js";
import { getDefaultResponsiblePartyId } from "./settings.js";
import { appDataImportSchema } from "../validation/schemas.js";

type MigrationData = ReturnType<typeof appDataImportSchema.parse>;
type DataRecord = Record<string, unknown>;
type BackupCreator = () => Promise<string>;

interface ExistingEntry {
  id: string;
  startDateTime: string;
  endDateTime: string;
  status: string;
  careScope: string;
  location: string;
  childIds: string[];
}

function text(record: DataRecord, key: string, fallback = ""): string {
  return typeof record[key] === "string" ? record[key] as string : fallback;
}

function records(record: DataRecord, key: string): DataRecord[] {
  return Array.isArray(record[key])
    ? (record[key] as unknown[]).filter(
        (item): item is DataRecord =>
          typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}

function strings(record: DataRecord, key: string): string[] {
  return Array.isArray(record[key])
    ? (record[key] as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
}

function countData(data: MigrationData): LegacyDataCounts {
  let trips = 0;
  let costs = 0;
  for (const entry of data.entries) {
    trips += records(entry, "trips").filter((item) => !item.deletedAt).length;
    costs += records(entry, "costs").filter((item) => !item.deletedAt).length;
  }
  return {
    children: data.children.length,
    entries: data.entries.filter((item) => !item.deletedAt).length,
    holidays: data.holidayPeriods.filter((item) => !item.deletedAt).length,
    contactPatterns: data.contactPatterns.filter((item) => !item.deletedAt).length,
    trips,
    costs,
    unavailablePeriods: data.unavailablePeriods.filter((item) => !item.deletedAt).length,
    settings: Object.keys(data.settings).length + Number(Boolean(data.lastJsonBackupAt)),
    monthClosures: data.monthClosures.length
  };
}

type CountedTable =
  | "children"
  | "care_entries"
  | "holiday_periods"
  | "contact_patterns"
  | "trips"
  | "costs"
  | "unavailable_periods"
  | "settings"
  | "monthly_closings"
  | "audit_log";

async function countTable(database: DatabaseExecutor, table: CountedTable): Promise<number> {
  const row = await database.selectFrom(table)
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

export async function getLegacyDatabaseSummary(
  database: DatabaseExecutor
): Promise<LegacyDatabaseSummary> {
  const [
    children, entries, holidays, contactPatterns, trips, costs,
    unavailablePeriods, settings, monthClosures, auditEntries
  ] = await Promise.all([
    countTable(database, "children"),
    countTable(database, "care_entries"),
    countTable(database, "holiday_periods"),
    countTable(database, "contact_patterns"),
    countTable(database, "trips"),
    countTable(database, "costs"),
    countTable(database, "unavailable_periods"),
    countTable(database, "settings"),
    countTable(database, "monthly_closings"),
    countTable(database, "audit_log")
  ]);
  const summary = {
    children,
    entries,
    holidays,
    contactPatterns,
    trips,
    costs,
    unavailablePeriods,
    settings,
    monthClosures,
    auditEntries
  };
  return {
    ...summary,
    isEmpty: Object.entries(summary)
      .filter(([key]) => key !== "auditEntries")
      .every(([, value]) => value === 0)
  };
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase("de-DE");
}

function childIdentity(record: DataRecord): string {
  return [
    normalizeName(text(record, "name")),
    String(record.birthMonth ?? ""),
    String(record.birthYear ?? "")
  ].join("|");
}

function careScope(record: DataRecord): string {
  if (record.overnight === true) return "overnight";
  const minutes =
    (Date.parse(text(record, "endDateTime")) - Date.parse(text(record, "startDateTime"))) /
    60000;
  if (minutes >= 720) return "full_day";
  if (minutes >= 300) return "half_day";
  return "hourly";
}

function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function overlap(
  leftStart: string,
  leftEnd: string,
  rightStart: string,
  rightEnd: string
): boolean {
  return Date.parse(leftStart) < Date.parse(rightEnd) &&
    Date.parse(leftEnd) > Date.parse(rightStart);
}

function closeTime(left: string, right: string): boolean {
  return Math.abs(Date.parse(left) - Date.parse(right)) <= 15 * 60_000;
}

function monthKeys(start: string, end: string): string[] {
  const result: string[] = [];
  const current = new Date(`${start.slice(0, 7)}-01T00:00:00.000Z`);
  const limit = new Date(`${end.slice(0, 7)}-01T00:00:00.000Z`);
  while (current <= limit) {
    result.push(current.toISOString().slice(0, 7));
    current.setUTCMonth(current.getUTCMonth() + 1);
  }
  return result;
}

async function existingEntries(database: DatabaseExecutor): Promise<ExistingEntry[]> {
  const [rows, childRows] = await Promise.all([
    database.selectFrom("care_entries")
      .select([
        "id", "start_datetime as startDateTime", "end_datetime as endDateTime",
        "status", "care_scope as careScope", "location"
      ])
      .where("deleted_at", "is", null)
      .execute(),
    database.selectFrom("care_entry_children")
      .select(["care_entry_id", "child_id"])
      .where("deleted_at", "is", null)
      .orderBy("child_id")
      .execute()
  ]);
  const childIdsByEntry = new Map<string, string[]>();
  for (const child of childRows) {
    childIdsByEntry.set(child.care_entry_id, [
      ...(childIdsByEntry.get(child.care_entry_id) ?? []),
      child.child_id
    ]);
  }
  return rows.map((row) => ({
    ...row,
    location: row.location ?? "",
    childIds: childIdsByEntry.get(row.id) ?? []
  }));
}

export async function analyzeLegacyData(
  data: MigrationData,
  executor: DatabaseExecutor,
  invalidRecords = 0,
  sourceWarnings: string[] = []
): Promise<LegacyMigrationPreview> {
  const database = await getLegacyDatabaseSummary(executor);
  const duplicateDetails: LegacyMigrationIssue[] = [];
  const conflictDetails: LegacyMigrationIssue[] = [];
  const closedMonths = new Set(
    (await executor.selectFrom("monthly_closings")
      .select("month_key as monthKey")
      .where("deleted_at", "is", null)
      .execute()).map((item) => item.monthKey)
  );
  const existingChildren = await executor.selectFrom("children")
    .select(["id", "name", "birth_month as birthMonth", "birth_year as birthYear"])
    .where("deleted_at", "is", null)
    .execute() as DataRecord[];
  const childIdMap = new Map<string, string>();
  for (const child of data.children) {
    const match = existingChildren.find(
      (existing) => childIdentity(existing) === childIdentity(child)
    );
    if (match) childIdMap.set(text(child, "id"), text(match, "id"));
  }

  const existing = await existingEntries(executor);
  for (const entry of data.entries.filter((item) => !item.deletedAt)) {
    const legacyChildren = strings(entry, "childIds").map(
      (id) => childIdMap.get(id) ?? `legacy:${id}`
    );
    const duplicate = existing.find((candidate) =>
      closeTime(text(entry, "startDateTime"), candidate.startDateTime) &&
      closeTime(text(entry, "endDateTime"), candidate.endDateTime) &&
      sameSet(legacyChildren, candidate.childIds) &&
      text(entry, "status") === candidate.status &&
      careScope(entry) === candidate.careScope &&
      text(entry, "location") === candidate.location
    );
    if (duplicate) {
      duplicateDetails.push({
        type: "careEntry",
        legacyId: text(entry, "id"),
        label: `${text(entry, "startDateTime")} bis ${text(entry, "endDateTime")}`,
        reasons: ["Zeitraum, Kinder, Status, Betreuungsumfang und Ort stimmen überein."],
        closedMonths: []
      });
      const existingTrips = await executor.selectFrom("trips")
        .select(["purpose", "km"])
        .where("care_entry_id", "=", duplicate.id)
        .where("deleted_at", "is", null)
        .execute();
      for (const trip of records(entry, "trips").filter((item) => !item.deletedAt)) {
        if (existingTrips.some(
          (item) =>
            item.purpose === text(trip, "purpose") &&
            Math.abs(item.km - Number(trip.km ?? 0)) < 0.01
        )) {
          duplicateDetails.push({
            type: "trip",
            legacyId: text(trip, "id"),
            label: `${text(trip, "purpose")} · ${Number(trip.km ?? 0)} km`,
            reasons: ["Fahrtzweck und Kilometer stimmen im gleichen Betreuungskontext überein."],
            closedMonths: []
          });
        }
      }
      const existingCosts = await executor.selectFrom("costs")
        .select(["category", "amount"])
        .where("care_entry_id", "=", duplicate.id)
        .where("deleted_at", "is", null)
        .execute();
      for (const cost of records(entry, "costs").filter((item) => !item.deletedAt)) {
        if (existingCosts.some(
          (item) =>
            item.category === text(cost, "category") &&
            Math.abs(item.amount - Number(cost.amount ?? 0)) < 0.01
        )) {
          duplicateDetails.push({
            type: "cost",
            legacyId: text(cost, "id"),
            label: `${text(cost, "category")} · ${Number(cost.amount ?? 0).toFixed(2)} EUR`,
            reasons: ["Kostenkategorie und Betrag stimmen im gleichen Betreuungskontext überein."],
            closedMonths: []
          });
        }
      }
      continue;
    }
    const conflict = existing.find((candidate) =>
      overlap(
        text(entry, "startDateTime"),
        text(entry, "endDateTime"),
        candidate.startDateTime,
        candidate.endDateTime
      ) && (
        text(entry, "status") !== candidate.status ||
        !sameSet(legacyChildren, candidate.childIds) ||
        careScope(entry) !== candidate.careScope
      )
    );
    const affectedClosed = monthKeys(
      text(entry, "startDateTime"),
      text(entry, "endDateTime")
    ).filter((month) => closedMonths.has(month));
    if (conflict || affectedClosed.length) {
      const reasons: string[] = [];
      if (conflict && text(entry, "status") !== conflict.status) {
        reasons.push("Zeitüberschneidung mit abweichendem Status.");
      }
      if (conflict && !sameSet(legacyChildren, conflict.childIds)) {
        reasons.push("Zeitüberschneidung mit anderen Kindern.");
      }
      if (conflict && careScope(entry) !== conflict.careScope) {
        reasons.push("Zeitüberschneidung mit anderem Betreuungsumfang.");
      }
      if (conflict?.status === "planned" && text(entry, "status") === "completed") {
        reasons.push("Bestehender Termin ist geplant, Legacy-Termin ist durchgeführt.");
      }
      if (affectedClosed.length) {
        reasons.push("Der Import betrifft einen abgeschlossenen Monat.");
      }
      conflictDetails.push({
        type: "careEntry",
        legacyId: text(entry, "id"),
        label: `${text(entry, "startDateTime")} bis ${text(entry, "endDateTime")}`,
        reasons,
        closedMonths: affectedClosed
      });
    }
  }

  const existingHolidays = await executor.selectFrom("holiday_periods")
    .select(["id", "start_date as startDate", "end_date as endDate", "assigned_to as assignedTo"])
    .where("deleted_at", "is", null)
    .execute() as Array<{
    id: string;
    startDate: string;
    endDate: string;
    assignedTo: string;
  }>;
  const holidayChildRows = await executor.selectFrom("holiday_period_children")
    .select(["holiday_period_id", "child_id"])
    .where("deleted_at", "is", null)
    .orderBy("child_id")
    .execute();
  const holidayChildren = new Map<string, string[]>();
  for (const child of holidayChildRows) {
    holidayChildren.set(child.holiday_period_id, [
      ...(holidayChildren.get(child.holiday_period_id) ?? []),
      child.child_id
    ]);
  }
  for (const holiday of data.holidayPeriods.filter((item) => !item.deletedAt)) {
    const legacyChildren = strings(holiday, "childIds").map(
      (id) => childIdMap.get(id) ?? `legacy:${id}`
    );
    const duplicate = existingHolidays.find((candidate) =>
      candidate.startDate === text(holiday, "startDate") &&
      candidate.endDate === text(holiday, "endDate") &&
      candidate.assignedTo === text(holiday, "assignedTo") &&
      sameSet(
        legacyChildren,
        holidayChildren.get(candidate.id) ?? []
      )
    );
    if (duplicate) {
      duplicateDetails.push({
        type: "holiday",
        legacyId: text(holiday, "id"),
        label: `${text(holiday, "startDate")} bis ${text(holiday, "endDate")}`,
        reasons: ["Ferienzeitraum, Kinder und Zuordnung stimmen überein."],
        closedMonths: []
      });
    }
  }

  const warnings = [...sourceWarnings];
  if (data.schemaVersion < 4) {
    warnings.push(`Legacy-Schema Version ${data.schemaVersion} wird auf Version 4 normalisiert.`);
  }
  if (conflictDetails.some((item) => item.closedMonths.length)) {
    warnings.push("Mindestens ein Datensatz betrifft einen abgeschlossenen Monat.");
  }
  return {
    counts: countData(data),
    database,
    potentialDuplicates: duplicateDetails.length,
    conflicts: conflictDetails.length,
    invalidRecords,
    warnings: [...new Set(warnings)],
    duplicateDetails,
    conflictDetails
  };
}

type IdentifiedTable =
  | "children"
  | "contact_patterns"
  | "trips"
  | "costs"
  | "care_entries"
  | "holiday_periods"
  | "unavailable_periods"
  | "monthly_closings";

async function uniqueId(
  database: DatabaseExecutor,
  table: IdentifiedTable,
  preferred: string,
  prefix: string
): Promise<string> {
  const exists = await database.selectFrom(table)
    .select("id")
    .where("id", "=", preferred)
    .executeTakeFirst();
  return preferred && !exists ? preferred : makeId(prefix);
}

function emptyCounts(): LegacyDataCounts {
  return {
    children: 0,
    entries: 0,
    holidays: 0,
    contactPatterns: 0,
    trips: 0,
    costs: 0,
    unavailablePeriods: 0,
    settings: 0,
    monthClosures: 0
  };
}

async function storeReport(
  database: DatabaseExecutor,
  report: LegacyMigrationReport,
  fingerprint: string,
  userEmail: string
): Promise<void> {
  await database.insertInto("legacy_migration_runs").values({
    id: report.id,
    source_fingerprint: fingerprint,
    mode: report.mode,
    status: report.status,
    report_json: JSON.stringify(report),
    backup_filename: report.backupFile ?? null,
    created_by: userEmail,
    created_at: report.startedAt,
    updated_at: report.finishedAt
  }).execute();
}

async function recordMigrationAudit(
  database: DatabaseExecutor,
  userEmail: string,
  action: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await recordDomainAudit(database, {
    userEmail,
    entityType: "legacy_migration",
    entityId: String(metadata.reportId ?? metadata.fingerprint ?? "legacy"),
    action: "updated",
    fieldName: action,
    metadata
  });
}

export async function recordLegacyMigrationEvent(
  userEmail: string,
  action: "legacy_migration_detected" | "legacy_migration_skip",
  metadata: Record<string, unknown>,
  database: DatabaseExecutor
): Promise<void> {
  await recordMigrationAudit(database, userEmail, action, metadata);
}

async function additiveImport(
  data: MigrationData,
  preview: LegacyMigrationPreview,
  duplicatePolicy: LegacyDuplicatePolicy,
  userEmail: string,
  database: DatabaseExecutor
): Promise<LegacyDataCounts> {
  const imported = emptyCounts();
  const timestamp = nowIso();
  const duplicateEntryIds = new Set(preview.duplicateDetails.map((item) => item.legacyId));
  const duplicateHolidayIds = new Set(
    preview.duplicateDetails
      .filter((item) => item.type === "holiday")
      .map((item) => item.legacyId)
  );
  const existingChildren = await database.selectFrom("children")
    .select(["id", "name", "birth_month as birthMonth", "birth_year as birthYear"])
    .where("deleted_at", "is", null)
    .execute() as DataRecord[];
  const childMap = new Map<string, string>();
  for (const child of data.children) {
    const oldId = text(child, "id");
    const match = existingChildren.find(
      (existing) => childIdentity(existing) === childIdentity(child)
    );
    if (match) {
      childMap.set(oldId, text(match, "id"));
      continue;
    }
    const id = await uniqueId(database, "children", oldId, "child");
    await insertChild({ ...child, id }, timestamp, userEmail, database);
    childMap.set(oldId, id);
    imported.children += 1;
  }
  const fallbackResponsiblePartyId = await getDefaultResponsiblePartyId(database);

  const patternMap = new Map<string, string>();
  for (const pattern of data.contactPatterns.filter((item) => !item.deletedAt)) {
    const id = await uniqueId(database, "contact_patterns", text(pattern, "id"), "pattern");
    await insertPattern({
      ...pattern,
      id,
      childIds: strings(pattern, "childIds").map((childId) => childMap.get(childId) ?? childId)
    }, timestamp, userEmail, fallbackResponsiblePartyId, database);
    patternMap.set(text(pattern, "id"), id);
    imported.contactPatterns += 1;
  }

  for (const entry of data.entries.filter((item) => !item.deletedAt)) {
    if (duplicatePolicy === "skip" && duplicateEntryIds.has(text(entry, "id"))) continue;
    const trips = records(entry, "trips").filter((item) => !item.deletedAt).map((trip) => ({
      ...trip,
      id: text(trip, "id")
    }));
    const costs = records(entry, "costs").filter((item) => !item.deletedAt).map((cost) => ({
      ...cost,
      id: text(cost, "id")
    }));
    for (const trip of trips) trip.id = await uniqueId(database, "trips", text(trip, "id"), "trip");
    for (const cost of costs) cost.id = await uniqueId(database, "costs", text(cost, "id"), "cost");
    const id = await uniqueId(database, "care_entries", text(entry, "id"), "entry");
    await insertEntry({
      ...entry,
      id,
      generatedByPatternId: patternMap.get(text(entry, "generatedByPatternId")) ??
        entry.generatedByPatternId,
      childIds: strings(entry, "childIds").map((childId) => childMap.get(childId) ?? childId),
      trips,
      costs
    }, timestamp, userEmail, fallbackResponsiblePartyId, database);
    imported.entries += 1;
    imported.trips += trips.length;
    imported.costs += costs.length;
    await markDomainClosedMonthsChanged(
      database,
      userEmail,
      "legacy_migration",
      id,
      text(entry, "startDateTime").slice(0, 10),
      text(entry, "endDateTime").slice(0, 10),
      timestamp
    );
  }

  for (const holiday of data.holidayPeriods.filter((item) => !item.deletedAt)) {
    if (duplicatePolicy === "skip" && duplicateHolidayIds.has(text(holiday, "id"))) {
      continue;
    }
    await insertHoliday({
      ...holiday,
      id: await uniqueId(database, "holiday_periods", text(holiday, "id"), "holiday"),
      childIds: strings(holiday, "childIds").map((childId) => childMap.get(childId) ?? childId)
    }, timestamp, userEmail, database);
    imported.holidays += 1;
  }
  for (const period of data.unavailablePeriods.filter((item) => !item.deletedAt)) {
    await insertUnavailable({
      ...period,
      id: await uniqueId(database, "unavailable_periods", text(period, "id"), "unavailable")
    }, timestamp, userEmail, database);
    imported.unavailablePeriods += 1;
  }

  for (const [key, value] of Object.entries(data.settings)) {
    const existing = await database.selectFrom("settings")
      .select("key")
      .where("key", "=", key)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!existing) {
      await database.insertInto("settings").values({
        key,
        value_json: JSON.stringify(value),
        created_by: userEmail,
        updated_by: userEmail,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null
      }).execute();
      imported.settings += 1;
    }
  }
  for (const closure of data.monthClosures) {
    const monthKey = text(closure, "monthKey");
    if (!monthKey) continue;
    const existing = await database.selectFrom("monthly_closings")
      .select("id")
      .where("month_key", "=", monthKey)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (existing) continue;
    const closedAt = text(closure, "closedAt", timestamp);
    await database.insertInto("monthly_closings").values({
      id: await uniqueId(database, "monthly_closings", `closing_${monthKey}`, "closing"),
      month_key: monthKey,
      summary_json: JSON.stringify({
        dataUpdatedAt: text(closure, "dataUpdatedAt", data.updatedAt),
        summary: closure.summary ?? {}
      }),
      closed_by: userEmail,
      updated_by: userEmail,
      changed_after_close_at: typeof closure.changedAfterCloseAt === "string" ? closure.changedAfterCloseAt : null,
      created_at: closedAt,
      updated_at: timestamp,
      deleted_at: null
    }).execute();
    imported.monthClosures += 1;
  }
  return imported;
}

export async function previewLegacyMigration(
  data: MigrationData,
  userEmail: string,
  fingerprint: string,
  database: DatabaseExecutor,
  invalidRecords = 0,
  warnings: string[] = []
): Promise<LegacyMigrationPreview> {
  const preview = await analyzeLegacyData(data, database, invalidRecords, warnings);
  await recordMigrationAudit(database, userEmail, "legacy_migration_preview", {
    fingerprint,
    counts: preview.counts,
    duplicates: preview.potentialDuplicates,
    conflicts: preview.conflicts,
    invalidRecords
  });
  return preview;
}

export async function executeLegacyMigration(input: {
  data: MigrationData;
  mode: Exclude<LegacyMigrationMode, "preview">;
  duplicatePolicy: LegacyDuplicatePolicy;
  fingerprint: string;
  invalidRecords?: number;
  warnings?: string[];
  userEmail: string;
  backupCreator?: BackupCreator;
}, runtime: PersistenceRuntime): Promise<LegacyMigrationReport> {
  const startedAt = nowIso();
  const reportId = makeId("migration");
  const preview = await analyzeLegacyData(
    input.data,
    runtime.query,
    input.invalidRecords ?? 0,
    input.warnings ?? []
  );
  let backupFile: string | undefined;
  try {
    if (input.mode === "replace") {
      backupFile = await (input.backupCreator ?? createSqliteBackup)();
    }
    return await runtime.transaction(async (database) => {
      let imported = emptyCounts();
      if (input.mode === "replace") {
        await clearDomainData(database);
        await importData({ ...input.data, auditLog: [] }, input.userEmail, database);
        imported = preview.counts;
      } else {
        imported = await additiveImport(
          input.data,
          preview,
          input.duplicatePolicy,
          input.userEmail,
          database
        );
      }
      const finishedAt = nowIso();
      const report: LegacyMigrationReport = {
        id: reportId,
        mode: input.mode,
        status:
          preview.conflicts || preview.invalidRecords || preview.warnings.length
            ? "warning"
            : "success",
        startedAt,
        finishedAt,
        counts: preview.counts,
        imported,
        skippedDuplicates:
          input.duplicatePolicy === "skip" ? preview.potentialDuplicates : 0,
        conflicts: preview.conflicts,
        invalidRecords: preview.invalidRecords,
        warnings: preview.warnings,
        errors: [],
        backupFile
      };
      await storeReport(database, report, input.fingerprint, input.userEmail);
      await recordMigrationAudit(
        database,
        input.userEmail,
        input.mode === "replace"
          ? "legacy_migration_replace"
          : "legacy_migration_import",
        {
          reportId,
          mode: input.mode,
          counts: preview.counts,
          imported,
          skippedDuplicates: report.skippedDuplicates,
          conflicts: preview.conflicts,
          backupCreated: Boolean(backupFile)
        }
      );
      return report;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordMigrationAudit(runtime.query, input.userEmail, "legacy_migration_failed", {
      reportId,
      mode: input.mode,
      counts: preview.counts,
      conflicts: preview.conflicts,
      backupCreated: Boolean(backupFile),
      error: message.slice(0, 500)
    });
    throw error;
  }
}

export async function listLegacyMigrationReports(
  database: DatabaseExecutor
): Promise<LegacyMigrationReport[]> {
  const rows = await database.selectFrom("legacy_migration_runs")
    .select("report_json as report")
    .orderBy("created_at", "desc")
    .limit(20)
    .execute();
  return rows.map(
    (row) => JSON.parse(row.report) as LegacyMigrationReport
  );
}
