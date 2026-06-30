import type {
  LegacyDataCounts,
  LegacyDatabaseSummary,
  LegacyDuplicatePolicy,
  LegacyMigrationIssue,
  LegacyMigrationPreview,
  LegacyMigrationReport,
  LegacyMigrationMode
} from "../../shared/migration.js";
import { db } from "../db/connection.js";
import {
  clearDomainData,
  importData,
  insertChild,
  insertEntry,
  insertHoliday,
  insertPattern,
  insertUnavailable
} from "../routes/appData.js";
import { recordAudit, markClosedMonthsChanged } from "./audit.js";
import { createSqliteBackup } from "./backup.js";
import { makeId, nowIso } from "./common.js";
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

function countTable(table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE deleted_at IS NULL`).get() as {
    count: number;
  }).count;
}

export function getLegacyDatabaseSummary(): LegacyDatabaseSummary {
  const summary = {
    children: countTable("children"),
    entries: countTable("care_entries"),
    holidays: countTable("holiday_periods"),
    contactPatterns: countTable("contact_patterns"),
    trips: countTable("trips"),
    costs: countTable("costs"),
    unavailablePeriods: countTable("unavailable_periods"),
    settings: countTable("settings"),
    monthClosures: countTable("monthly_closings"),
    auditEntries: countTable("audit_log")
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

function existingEntries(): ExistingEntry[] {
  const rows = db.prepare(`
    SELECT id, start_datetime AS startDateTime, end_datetime AS endDateTime,
      status, care_scope AS careScope, COALESCE(location, '') AS location
    FROM care_entries WHERE deleted_at IS NULL
  `).all() as Omit<ExistingEntry, "childIds">[];
  const childStatement = db.prepare(`
    SELECT child_id AS childId FROM care_entry_children
    WHERE care_entry_id = ? AND deleted_at IS NULL ORDER BY child_id
  `);
  return rows.map((row) => ({
    ...row,
    childIds: (childStatement.all(row.id) as Array<{ childId: string }>).map(
      (item) => item.childId
    )
  }));
}

export function analyzeLegacyData(
  data: MigrationData,
  invalidRecords = 0,
  sourceWarnings: string[] = []
): LegacyMigrationPreview {
  const database = getLegacyDatabaseSummary();
  const duplicateDetails: LegacyMigrationIssue[] = [];
  const conflictDetails: LegacyMigrationIssue[] = [];
  const closedMonths = new Set(
    (db.prepare(`
      SELECT month_key AS monthKey FROM monthly_closings WHERE deleted_at IS NULL
    `).all() as Array<{ monthKey: string }>).map((item) => item.monthKey)
  );
  const existingChildren = db.prepare(`
    SELECT id, name, birth_month AS birthMonth, birth_year AS birthYear
    FROM children WHERE deleted_at IS NULL
  `).all() as DataRecord[];
  const childIdMap = new Map<string, string>();
  for (const child of data.children) {
    const match = existingChildren.find(
      (existing) => childIdentity(existing) === childIdentity(child)
    );
    if (match) childIdMap.set(text(child, "id"), text(match, "id"));
  }

  const existing = existingEntries();
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
      const existingTrips = db.prepare(`
        SELECT purpose, km FROM trips
        WHERE care_entry_id = ? AND deleted_at IS NULL
      `).all(duplicate.id) as Array<{ purpose: string; km: number }>;
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
      const existingCosts = db.prepare(`
        SELECT category, amount FROM costs
        WHERE care_entry_id = ? AND deleted_at IS NULL
      `).all(duplicate.id) as Array<{ category: string; amount: number }>;
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

  const existingHolidays = db.prepare(`
    SELECT id, start_date AS startDate, end_date AS endDate, assigned_to AS assignedTo
    FROM holiday_periods WHERE deleted_at IS NULL
  `).all() as Array<{
    id: string;
    startDate: string;
    endDate: string;
    assignedTo: string;
  }>;
  const holidayChildren = db.prepare(`
    SELECT child_id AS childId FROM holiday_period_children
    WHERE holiday_period_id = ? AND deleted_at IS NULL ORDER BY child_id
  `);
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
        (holidayChildren.all(candidate.id) as Array<{ childId: string }>).map(
          (item) => item.childId
        )
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

function uniqueId(table: string, preferred: string, prefix: string): string {
  const exists = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(preferred);
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

function storeReport(
  report: LegacyMigrationReport,
  fingerprint: string,
  userEmail: string
): void {
  db.prepare(`
    INSERT INTO legacy_migration_runs (
      id, source_fingerprint, mode, status, report_json, backup_filename,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    report.id,
    fingerprint,
    report.mode,
    report.status,
    JSON.stringify(report),
    report.backupFile ?? null,
    userEmail,
    report.startedAt,
    report.finishedAt
  );
}

function recordMigrationAudit(
  userEmail: string,
  action: string,
  metadata: Record<string, unknown>
): void {
  recordAudit({
    userEmail,
    entityType: "legacy_migration",
    entityId: String(metadata.reportId ?? metadata.fingerprint ?? "legacy"),
    action: "updated",
    fieldName: action,
    metadata
  });
}

export function recordLegacyMigrationEvent(
  userEmail: string,
  action: "legacy_migration_detected" | "legacy_migration_skip",
  metadata: Record<string, unknown>
): void {
  recordMigrationAudit(userEmail, action, metadata);
}

function additiveImport(
  data: MigrationData,
  preview: LegacyMigrationPreview,
  duplicatePolicy: LegacyDuplicatePolicy,
  userEmail: string
): LegacyDataCounts {
  const imported = emptyCounts();
  const timestamp = nowIso();
  const duplicateEntryIds = new Set(preview.duplicateDetails.map((item) => item.legacyId));
  const duplicateHolidayIds = new Set(
    preview.duplicateDetails
      .filter((item) => item.type === "holiday")
      .map((item) => item.legacyId)
  );
  const existingChildren = db.prepare(`
    SELECT id, name, birth_month AS birthMonth, birth_year AS birthYear
    FROM children WHERE deleted_at IS NULL
  `).all() as DataRecord[];
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
    const id = uniqueId("children", oldId, "child");
    insertChild({ ...child, id }, timestamp, userEmail);
    childMap.set(oldId, id);
    imported.children += 1;
  }

  const patternMap = new Map<string, string>();
  for (const pattern of data.contactPatterns.filter((item) => !item.deletedAt)) {
    const id = uniqueId("contact_patterns", text(pattern, "id"), "pattern");
    insertPattern({
      ...pattern,
      id,
      childIds: strings(pattern, "childIds").map((childId) => childMap.get(childId) ?? childId)
    }, timestamp, userEmail);
    patternMap.set(text(pattern, "id"), id);
    imported.contactPatterns += 1;
  }

  for (const entry of data.entries.filter((item) => !item.deletedAt)) {
    if (duplicatePolicy === "skip" && duplicateEntryIds.has(text(entry, "id"))) continue;
    const trips = records(entry, "trips").filter((item) => !item.deletedAt).map((trip) => ({
      ...trip,
      id: uniqueId("trips", text(trip, "id"), "trip")
    }));
    const costs = records(entry, "costs").filter((item) => !item.deletedAt).map((cost) => ({
      ...cost,
      id: uniqueId("costs", text(cost, "id"), "cost")
    }));
    const id = uniqueId("care_entries", text(entry, "id"), "entry");
    insertEntry({
      ...entry,
      id,
      generatedByPatternId: patternMap.get(text(entry, "generatedByPatternId")) ??
        entry.generatedByPatternId,
      childIds: strings(entry, "childIds").map((childId) => childMap.get(childId) ?? childId),
      trips,
      costs
    }, timestamp, userEmail);
    imported.entries += 1;
    imported.trips += trips.length;
    imported.costs += costs.length;
    markClosedMonthsChanged(
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
    insertHoliday({
      ...holiday,
      id: uniqueId("holiday_periods", text(holiday, "id"), "holiday"),
      childIds: strings(holiday, "childIds").map((childId) => childMap.get(childId) ?? childId)
    }, timestamp, userEmail);
    imported.holidays += 1;
  }
  for (const period of data.unavailablePeriods.filter((item) => !item.deletedAt)) {
    insertUnavailable({
      ...period,
      id: uniqueId("unavailable_periods", text(period, "id"), "unavailable")
    }, timestamp, userEmail);
    imported.unavailablePeriods += 1;
  }

  const insertSetting = db.prepare(`
    INSERT INTO settings (key, value_json, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const [key, value] of Object.entries(data.settings)) {
    if (!db.prepare("SELECT 1 FROM settings WHERE key = ? AND deleted_at IS NULL").get(key)) {
      insertSetting.run(key, JSON.stringify(value), userEmail, userEmail, timestamp, timestamp);
      imported.settings += 1;
    }
  }
  const insertClosing = db.prepare(`
    INSERT INTO monthly_closings (
      id, month_key, summary_json, closed_by, updated_by, changed_after_close_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const closure of data.monthClosures) {
    const monthKey = text(closure, "monthKey");
    if (!monthKey || db.prepare(
      "SELECT 1 FROM monthly_closings WHERE month_key = ? AND deleted_at IS NULL"
    ).get(monthKey)) continue;
    const closedAt = text(closure, "closedAt", timestamp);
    insertClosing.run(
      uniqueId("monthly_closings", `closing_${monthKey}`, "closing"),
      monthKey,
      JSON.stringify({
        dataUpdatedAt: text(closure, "dataUpdatedAt", data.updatedAt),
        summary: closure.summary ?? {}
      }),
      userEmail,
      userEmail,
      typeof closure.changedAfterCloseAt === "string" ? closure.changedAfterCloseAt : null,
      closedAt,
      timestamp
    );
    imported.monthClosures += 1;
  }
  return imported;
}

export function previewLegacyMigration(
  data: MigrationData,
  userEmail: string,
  fingerprint: string,
  invalidRecords = 0,
  warnings: string[] = []
): LegacyMigrationPreview {
  const preview = analyzeLegacyData(data, invalidRecords, warnings);
  recordMigrationAudit(userEmail, "legacy_migration_preview", {
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
}): Promise<LegacyMigrationReport> {
  const startedAt = nowIso();
  const reportId = makeId("migration");
  const preview = analyzeLegacyData(
    input.data,
    input.invalidRecords ?? 0,
    input.warnings ?? []
  );
  let backupFile: string | undefined;
  try {
    if (input.mode === "replace") {
      backupFile = await (input.backupCreator ?? createSqliteBackup)();
    }
    let imported = emptyCounts();
    db.transaction(() => {
      if (input.mode === "replace") {
        clearDomainData();
        importData({ ...input.data, auditLog: [] }, input.userEmail);
        imported = preview.counts;
      } else {
        imported = additiveImport(
          input.data,
          preview,
          input.duplicatePolicy,
          input.userEmail
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
      storeReport(report, input.fingerprint, input.userEmail);
      recordMigrationAudit(
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
    })();
    return JSON.parse(
      (db.prepare("SELECT report_json AS report FROM legacy_migration_runs WHERE id = ?")
        .get(reportId) as { report: string }).report
    ) as LegacyMigrationReport;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordMigrationAudit(input.userEmail, "legacy_migration_failed", {
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

export function listLegacyMigrationReports(): LegacyMigrationReport[] {
  return (db.prepare(`
    SELECT report_json AS report FROM legacy_migration_runs
    ORDER BY created_at DESC LIMIT 20
  `).all() as Array<{ report: string }>).map(
    (row) => JSON.parse(row.report) as LegacyMigrationReport
  );
}
