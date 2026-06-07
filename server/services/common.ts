import { randomUUID } from "node:crypto";
import { db } from "../db/connection.js";

export function makeId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function bool(value: unknown): boolean {
  return value === 1 || value === true;
}

export function assertActiveChildren(childIds: string[]): void {
  const uniqueIds = [...new Set(childIds)];
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM children
    WHERE deleted_at IS NULL AND id IN (${placeholders})
  `).get(...uniqueIds) as { count: number };

  if (row.count !== uniqueIds.length) {
    throw new Error("Mindestens ein zugeordnetes Kind existiert nicht oder wurde gelöscht.");
  }
}

export function syncJunction(
  table: "care_entry_children" | "holiday_period_children" | "contact_pattern_children",
  ownerColumn: "care_entry_id" | "holiday_period_id" | "contact_pattern_id",
  ownerId: string,
  childIds: string[],
  timestamp: string
): void {
  const existing = db.prepare(`
    SELECT child_id AS childId, deleted_at AS deletedAt
    FROM ${table}
    WHERE ${ownerColumn} = ?
  `).all(ownerId) as Array<{ childId: string; deletedAt: string | null }>;
  const selected = new Set(childIds);

  for (const link of existing) {
    if (selected.has(link.childId)) {
      db.prepare(`
        UPDATE ${table}
        SET deleted_at = NULL, updated_at = ?
        WHERE ${ownerColumn} = ? AND child_id = ?
      `).run(timestamp, ownerId, link.childId);
      selected.delete(link.childId);
    } else if (!link.deletedAt) {
      db.prepare(`
        UPDATE ${table}
        SET deleted_at = ?, updated_at = ?
        WHERE ${ownerColumn} = ? AND child_id = ?
      `).run(timestamp, timestamp, ownerId, link.childId);
    }
  }

  const insert = db.prepare(`
    INSERT INTO ${table} (${ownerColumn}, child_id, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  for (const childId of selected) {
    insert.run(ownerId, childId, timestamp, timestamp);
  }
}
