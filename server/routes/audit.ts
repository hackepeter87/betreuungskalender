import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiActorLabel, ApiAuditEntry, ApiAuditPage } from "../../shared/api.js";
import { config } from "../config.js";
import { db } from "../db/connection.js";

const readLimit = {
  config: { permission: "audit:view" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const actorLabelLimit = {
  config: { permission: "planning:view" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};

interface AuditQuery {
  entityType?: string;
  entityId?: string;
  startDate?: string;
  endDate?: string;
  limit?: string;
  cursor?: string;
}

interface AuditCursor {
  timestamp: string;
  id: number;
}

const actorLabelInputSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(200)).max(200)
}).strict();

const auditSelect = `
  SELECT
    audit_log.id,
    audit_log.timestamp,
    audit_log.user_email AS userEmail,
    COALESCE(app_users.display_name, transfer_actors.display_name) AS userDisplayName,
    audit_log.entity_type AS entityType,
    audit_log.entity_id AS entityId,
    audit_log.action,
    audit_log.field_name AS fieldName,
    audit_log.old_value AS oldValue,
    audit_log.new_value AS newValue,
    audit_log.metadata_json AS metadataJson
  FROM audit_log
  LEFT JOIN app_users ON app_users.id = audit_log.user_email
  LEFT JOIN data_transfer_actors transfer_actors ON transfer_actors.id = audit_log.user_email
`;

function auditFilters(query: AuditQuery): { conditions: string[]; values: Array<string | number> } {
  const conditions = ["audit_log.deleted_at IS NULL"];
  const values: Array<string | number> = [];
  if (query.entityType) {
    conditions.push("audit_log.entity_type = ?");
    values.push(query.entityType);
  }
  if (query.entityId) {
    conditions.push("audit_log.entity_id = ?");
    values.push(query.entityId);
  }
  if (query.startDate) {
    conditions.push("audit_log.timestamp >= ?");
    values.push(`${query.startDate}T00:00:00.000Z`);
  }
  if (query.endDate) {
    conditions.push("audit_log.timestamp <= ?");
    values.push(`${query.endDate}T23:59:59.999Z`);
  }
  return { conditions, values };
}

function encodeCursor(entry: Pick<ApiAuditEntry, "timestamp" | "id">): string {
  return Buffer.from(JSON.stringify([entry.timestamp, entry.id])).toString("base64url");
}

function decodeCursor(value: string | undefined): AuditCursor | undefined {
  if (!value) return undefined;
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid_audit_cursor");
  }
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(decoded).toString("base64url") !== value) throw new Error("invalid_audit_cursor");
    const tuple = JSON.parse(decoded) as unknown;
    if (
      !Array.isArray(tuple) ||
      tuple.length !== 2 ||
      typeof tuple[0] !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(tuple[0]) ||
      !Number.isSafeInteger(tuple[1]) ||
      Number(tuple[1]) < 1
    ) {
      throw new Error("invalid_audit_cursor");
    }
    return { timestamp: tuple[0], id: Number(tuple[1]) };
  } catch {
    throw new Error("invalid_audit_cursor");
  }
}

function requestedLimit(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  return Math.min(Math.max(Number.isFinite(parsed) ? Math.floor(parsed) : fallback, 1), maximum);
}

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: AuditQuery }>("/api/audit-log", readLimit, async (request, reply) => {
    const { conditions, values } = auditFilters(request.query);
    const limit = requestedLimit(request.query.limit, 500, 500);
    values.push(limit);
    reply.header("Cache-Control", "no-store");
    reply.header("Deprecation", "true");
    reply.header("Link", "</api/audit-log/page>; rel=\"successor-version\"");
    return db.prepare(`${auditSelect}
      WHERE ${conditions.join(" AND ")}
      ORDER BY audit_log.timestamp DESC, audit_log.id DESC
      LIMIT ?
    `).all(...values) as ApiAuditEntry[];
  });

  app.get<{ Querystring: AuditQuery }>("/api/audit-log/page", readLimit, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    let cursor: AuditCursor | undefined;
    try {
      cursor = decodeCursor(request.query.cursor);
    } catch {
      return reply.code(400).send({ error: "invalid_request", message: "Ungültige Anfrage." });
    }
    const { conditions, values } = auditFilters(request.query);
    if (cursor) {
      conditions.push("(audit_log.timestamp < ? OR (audit_log.timestamp = ? AND audit_log.id < ?))");
      values.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    const limit = requestedLimit(request.query.limit, 50, 100);
    values.push(limit + 1);
    const rows = db.prepare(`${auditSelect}
      WHERE ${conditions.join(" AND ")}
      ORDER BY audit_log.timestamp DESC, audit_log.id DESC
      LIMIT ?
    `).all(...values) as ApiAuditEntry[];
    const hasNextPage = rows.length > limit;
    const items = hasNextPage ? rows.slice(0, limit) : rows;
    const lastItem = items.at(-1);
    const page: ApiAuditPage = {
      items,
      ...(hasNextPage && lastItem ? { nextCursor: encodeCursor(lastItem) } : {})
    };
    return page;
  });

  app.post("/api/actor-labels/resolve", actorLabelLimit, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const parsed = actorLabelInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", message: "Ungültige Anfrage." });
    }
    const ids = [...new Set(parsed.data.ids)];
    if (!ids.length) {
      return [];
    }
    const placeholders = ids.map(() => "?").join(", ");
    const rows = db.prepare(`
      WITH referenced_actors(id) AS (
        SELECT created_by FROM children WHERE deleted_at IS NULL
        UNION SELECT updated_by FROM children WHERE deleted_at IS NULL
        UNION SELECT created_by FROM care_parties WHERE deleted_at IS NULL
        UNION SELECT updated_by FROM care_parties WHERE deleted_at IS NULL
        UNION SELECT created_by FROM care_entries WHERE deleted_at IS NULL
        UNION SELECT updated_by FROM care_entries WHERE deleted_at IS NULL
        UNION SELECT created_by FROM trips WHERE deleted_at IS NULL
        UNION SELECT updated_by FROM trips WHERE deleted_at IS NULL
        UNION SELECT created_by FROM costs WHERE deleted_at IS NULL
        UNION SELECT updated_by FROM costs WHERE deleted_at IS NULL
        UNION SELECT created_by FROM holiday_periods WHERE deleted_at IS NULL
        UNION SELECT updated_by FROM holiday_periods WHERE deleted_at IS NULL
        UNION SELECT created_by FROM unavailable_periods WHERE deleted_at IS NULL
        UNION SELECT updated_by FROM unavailable_periods WHERE deleted_at IS NULL
        UNION SELECT created_by FROM contact_patterns WHERE deleted_at IS NULL
        UNION SELECT updated_by FROM contact_patterns WHERE deleted_at IS NULL
        UNION SELECT created_by FROM contact_rules WHERE deleted_at IS NULL
        UNION SELECT updated_by FROM contact_rules WHERE deleted_at IS NULL
        UNION SELECT closed_by FROM monthly_closings WHERE deleted_at IS NULL
        UNION SELECT updated_by FROM monthly_closings WHERE deleted_at IS NULL
      )
      SELECT referenced_actors.id,
        COALESCE(app_users.display_name, transfer_actors.display_name) AS displayName
      FROM referenced_actors
      LEFT JOIN app_users ON app_users.id = referenced_actors.id
      LEFT JOIN data_transfer_actors transfer_actors ON transfer_actors.id = referenced_actors.id
      WHERE referenced_actors.id IN (${placeholders})
        AND COALESCE(app_users.display_name, transfer_actors.display_name) IS NOT NULL
    `).all(...ids) as ApiActorLabel[];
    const labelsById = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => labelsById.get(id) ?? []);
  });
}
