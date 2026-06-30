import { db } from "../db/connection.js";

type AuditAction = "created" | "updated" | "deleted" | "post_close_change";

interface AuditInput {
  userEmail: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  fieldName?: string;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: unknown;
  timestamp?: string;
}

function serialize(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function recordAudit(input: AuditInput): void {
  const timestamp = input.timestamp ?? new Date().toISOString();
  db.prepare(`
    INSERT INTO audit_log (
      timestamp, user_email, entity_type, entity_id, action, field_name,
      old_value, new_value, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    timestamp,
    input.userEmail,
    input.entityType,
    input.entityId,
    input.action,
    input.fieldName ?? null,
    serialize(input.oldValue),
    serialize(input.newValue),
    serialize(input.metadata),
    timestamp,
    timestamp
  );
}

export function recordFieldChanges(
  userEmail: string,
  entityType: string,
  entityId: string,
  before: object,
  after: object,
  ignoredFields: string[] = []
): void {
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const ignored = new Set(ignoredFields);
  for (const field of new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])) {
    if (ignored.has(field)) continue;
    const oldValue = serialize(beforeRecord[field]);
    const newValue = serialize(afterRecord[field]);
    if (oldValue === newValue) continue;
    recordAudit({
      userEmail,
      entityType,
      entityId,
      action: "updated",
      fieldName: field,
      oldValue: beforeRecord[field],
      newValue: afterRecord[field]
    });
  }
}

function monthKeysForRange(startDate: string, endDate: string): string[] {
  const [startYear, startMonth] = startDate.slice(0, 7).split("-").map(Number);
  const [endYear, endMonth] = endDate.slice(0, 7).split("-").map(Number);
  const current = new Date(Date.UTC(startYear ?? 1970, (startMonth ?? 1) - 1, 1));
  const end = new Date(Date.UTC(endYear ?? 1970, (endMonth ?? 1) - 1, 1));
  const result: string[] = [];
  while (current <= end) {
    result.push(
      `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}`
    );
    current.setUTCMonth(current.getUTCMonth() + 1);
  }
  return result;
}

export function markClosedMonthsChanged(
  userEmail: string,
  entityType: string,
  entityId: string,
  startDate: string,
  endDate: string,
  timestamp = new Date().toISOString()
): void {
  for (const monthKey of monthKeysForRange(startDate, endDate)) {
    const result = db.prepare(`
      UPDATE monthly_closings
      SET changed_after_close_at = ?, updated_by = ?, updated_at = ?
      WHERE month_key = ? AND deleted_at IS NULL
    `).run(timestamp, userEmail, timestamp, monthKey);
    if (result.changes > 0) {
      recordAudit({
        userEmail,
        entityType,
        entityId,
        action: "post_close_change",
        fieldName: monthKey,
        newValue: timestamp
      });
    }
  }
}

export function markAllClosedMonthsChanged(
  userEmail: string,
  entityType: string,
  entityId: string,
  timestamp = new Date().toISOString()
): void {
  const rows = db.prepare(`
    SELECT month_key AS monthKey
    FROM monthly_closings
    WHERE deleted_at IS NULL
  `).all() as Array<{ monthKey: string }>;
  for (const row of rows) {
    db.prepare(`
      UPDATE monthly_closings
      SET changed_after_close_at = ?, updated_by = ?, updated_at = ?
      WHERE month_key = ?
    `).run(timestamp, userEmail, timestamp, row.monthKey);
    recordAudit({
      userEmail,
      entityType,
      entityId,
      action: "post_close_change",
      fieldName: row.monthKey,
      newValue: timestamp
    });
  }
}
