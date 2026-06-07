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
