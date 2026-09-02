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
import type { DatabaseExecutor, PersistenceRuntime } from "../db/runtime.js";
import { exportDomainData } from "./dataTransfer.js";
import { normalizeClientSettings } from "./settings.js";

type DataRecord = Record<string, unknown>;

function touchesDateRange(startDateTime: unknown, endDateTime: unknown, startDate: string, endDate: string): boolean {
  if (typeof startDateTime !== "string" || typeof endDateTime !== "string") return false;
  return dateKeysForTimedRange(startDateTime, endDateTime).some(
    (dateKey) => dateKey >= startDate && dateKey <= endDate
  );
}

async function auditEntries(
  database: DatabaseExecutor,
  startDate: string,
  endDate: string
): Promise<ApiAuditEntry[]> {
  const rows = await database.selectFrom("audit_log")
    .leftJoin("app_users", "app_users.id", "audit_log.user_email")
    .leftJoin("data_transfer_actors as transfer_actors", "transfer_actors.id", "audit_log.user_email")
    .select([
      "audit_log.id", "audit_log.timestamp", "audit_log.user_email as userEmail",
      (expression) => expression.fn.coalesce(
        "app_users.display_name",
        "transfer_actors.display_name"
      ).as("userDisplayName"),
      "audit_log.entity_type as entityType", "audit_log.entity_id as entityId",
      "audit_log.action", "audit_log.field_name as fieldName",
      "audit_log.old_value as oldValue", "audit_log.new_value as newValue",
      "audit_log.metadata_json as metadataJson"
    ])
    .where("audit_log.deleted_at", "is", null)
    .where("audit_log.timestamp", ">=", `${startDate}T00:00:00.000Z`)
    .where("audit_log.timestamp", "<=", `${endDate}T23:59:59.999Z`)
    .orderBy("audit_log.timestamp")
    .orderBy("audit_log.id")
    .limit(50_000)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    userEmail: row.userEmail,
    userDisplayName: row.userDisplayName,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action as ApiAuditEntry["action"],
    fieldName: row.fieldName,
    oldValue: row.oldValue,
    newValue: row.newValue,
    metadataJson: row.metadataJson,
    effectiveDate: row.timestamp.slice(0, 10)
  }));
}

export async function createReportSnapshot(input: {
  persistence: PersistenceRuntime;
  startDate: string;
  endDate: string;
  includeAuditHistory: boolean;
}): Promise<ApiReportSnapshot> {
  return input.persistence.transaction(async (database) => {
    const exported = await exportDomainData(database);
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
        settings: await normalizeClientSettings(exported.settings, database),
        auditLog: input.includeAuditHistory
          ? await auditEntries(database, input.startDate, input.endDate)
          : [],
        monthClosures: monthClosures as unknown as ApiMonthlyClosing[]
      }
    };
  });
}
