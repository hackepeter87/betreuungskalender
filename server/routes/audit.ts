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
    const conditions = ["deleted_at IS NULL"];
    const values: Array<string | number> = [];
    if (request.query.entityType) {
      conditions.push("entity_type = ?");
      values.push(request.query.entityType);
    }
    if (request.query.entityId) {
      conditions.push("entity_id = ?");
      values.push(request.query.entityId);
    }
    if (request.query.startDate) {
      conditions.push("timestamp >= ?");
      values.push(`${request.query.startDate}T00:00:00.000Z`);
    }
    if (request.query.endDate) {
      conditions.push("timestamp <= ?");
      values.push(`${request.query.endDate}T23:59:59.999Z`);
    }
    const requestedLimit = Number(request.query.limit ?? 500);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 500, 1), 50000);
    values.push(limit);

    return db.prepare(`
      SELECT
        id, timestamp, user_email AS userEmail, entity_type AS entityType,
        entity_id AS entityId, action, field_name AS fieldName,
        old_value AS oldValue, new_value AS newValue, metadata_json AS metadataJson
      FROM audit_log
      WHERE ${conditions.join(" AND ")}
      ORDER BY timestamp DESC, id DESC
      LIMIT ?
    `).all(...values);
  });
}
