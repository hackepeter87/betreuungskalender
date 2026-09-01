import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  ApiAuditEntry,
  ApiCareEntry,
  ApiCareParty,
  ApiChild,
  ApiHolidayPeriod,
  ApiMonthlyClosing,
  ApiReportSnapshot,
  ApiUnavailablePeriod
} from "../../shared/api.js";
import { dateKeysForTimedRange } from "../../shared/temporal.js";
import { exportDomainData } from "./dataTransfer.js";
import { getClientSettings } from "./settings.js";

type DataRecord = Record<string, unknown>;

function touchesDateRange(startDateTime: unknown, endDateTime: unknown, startDate: string, endDate: string): boolean {
  if (typeof startDateTime !== "string" || typeof endDateTime !== "string") return false;
  return dateKeysForTimedRange(startDateTime, endDateTime).some(
    (dateKey) => dateKey >= startDate && dateKey <= endDate
  );
}

function auditEntries(
  database: Database.Database,
  startDate: string,
  endDate: string
): ApiAuditEntry[] {
  return database.prepare(`
    SELECT audit_log.id, audit_log.timestamp, audit_log.user_email AS userEmail,
      COALESCE(app_users.display_name, transfer_actors.display_name) AS userDisplayName,
      audit_log.entity_type AS entityType, audit_log.entity_id AS entityId,
      audit_log.action, audit_log.field_name AS fieldName,
      audit_log.old_value AS oldValue, audit_log.new_value AS newValue,
      audit_log.metadata_json AS metadataJson
    FROM audit_log
    LEFT JOIN app_users ON app_users.id = audit_log.user_email
    LEFT JOIN data_transfer_actors transfer_actors ON transfer_actors.id = audit_log.user_email
    WHERE audit_log.deleted_at IS NULL
      AND audit_log.timestamp >= ?
      AND audit_log.timestamp <= ?
    ORDER BY audit_log.timestamp, audit_log.id
    LIMIT 50000
  `).all(`${startDate}T00:00:00.000Z`, `${endDate}T23:59:59.999Z`).map((row) => {
    const entry = row as ApiAuditEntry;
    return { ...entry, effectiveDate: entry.timestamp.slice(0, 10) };
  });
}

export function createReportSnapshot(input: {
  database: Database.Database;
  startDate: string;
  endDate: string;
  includeAuditHistory: boolean;
}): ApiReportSnapshot {
  return input.database.transaction(() => {
    const exported = exportDomainData(input.database);
    const entries = (exported.entries as DataRecord[]).filter((entry) =>
      touchesDateRange(entry.startDateTime, entry.endDateTime, input.startDate, input.endDate)
    );
    const unavailablePeriods = (exported.unavailablePeriods as DataRecord[]).filter((period) =>
      touchesDateRange(period.startDateTime, period.endDateTime, input.startDate, input.endDate)
    );
    const holidayPeriods = (exported.holidayPeriods as DataRecord[]).filter((period) =>
      typeof period.startDate === "string" && typeof period.endDate === "string" &&
      period.startDate <= input.endDate && period.endDate >= input.startDate
    );
    const monthClosures = (exported.monthClosures as DataRecord[]).filter((closing) =>
      typeof closing.monthKey === "string" &&
      closing.monthKey >= input.startDate.slice(0, 7) &&
      closing.monthKey <= input.endDate.slice(0, 7)
    );
    const generatedAt = new Date().toISOString();

    return {
      reportId: `BK-${generatedAt.slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
      generatedAt,
      startDate: input.startDate,
      endDate: input.endDate,
      dataUpdatedAt: exported.updatedAt,
      data: {
        schemaVersion: exported.schemaVersion,
        children: exported.children as unknown as ApiChild[],
        careParties: exported.careParties as unknown as ApiCareParty[],
        entries: entries as unknown as ApiCareEntry[],
        holidayPeriods: holidayPeriods as unknown as ApiHolidayPeriod[],
        unavailablePeriods: unavailablePeriods as unknown as ApiUnavailablePeriod[],
        settings: getClientSettings(input.database),
        auditLog: input.includeAuditHistory
          ? auditEntries(input.database, input.startDate, input.endDate)
          : [],
        monthClosures: monthClosures as unknown as ApiMonthlyClosing[]
      }
    };
  })();
}
