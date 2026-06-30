import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db/connection.js";

const readLimit = {
  config: { rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};

interface AuditQuery {
  entityType?: string;
  entityId?: string;
  startDate?: string;
  endDate?: string;
  limit?: string;
}

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: AuditQuery }>("/api/audit-log", readLimit, async (request) => {
    const conditions = ["audit_log.deleted_at IS NULL"];
    const values: Array<string | number> = [];
    if (request.query.entityType) {
      conditions.push("audit_log.entity_type = ?");
      values.push(request.query.entityType);
    }
    if (request.query.entityId) {
      conditions.push("audit_log.entity_id = ?");
      values.push(request.query.entityId);
    }
    if (request.query.startDate) {
      conditions.push("audit_log.timestamp >= ?");
      values.push(`${request.query.startDate}T00:00:00.000Z`);
    }
    if (request.query.endDate) {
      conditions.push("audit_log.timestamp <= ?");
      values.push(`${request.query.endDate}T23:59:59.999Z`);
    }
    const requestedLimit = Number(request.query.limit ?? 500);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 500, 1), 50000);
    values.push(limit);

    return db.prepare(`
      SELECT
        audit_log.id,
        audit_log.timestamp,
        audit_log.user_email AS userEmail,
        app_users.display_name AS userDisplayName,
        audit_log.entity_type AS entityType,
        audit_log.entity_id AS entityId,
        audit_log.action,
        audit_log.field_name AS fieldName,
        audit_log.old_value AS oldValue,
        audit_log.new_value AS newValue,
        audit_log.metadata_json AS metadataJson
      FROM audit_log
      LEFT JOIN app_users ON app_users.id = audit_log.user_email
      WHERE ${conditions.join(" AND ")}
      ORDER BY audit_log.timestamp DESC, audit_log.id DESC
      LIMIT ?
    `).all(...values);
  });
}
