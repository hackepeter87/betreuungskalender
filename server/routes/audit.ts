import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiActorLabel, ApiAuditEntry, ApiAuditPage } from "../../shared/api.js";
import { config } from "../config.js";
import type { DatabaseExecutor } from "../db/runtime.js";

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

function mapAuditEntry(row: {
  id: number;
  timestamp: string;
  userEmail: string;
  userDisplayName: string | null;
  entityType: string;
  entityId: string;
  action: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  metadataJson: string | null;
}): ApiAuditEntry {
  return {
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
    metadataJson: row.metadataJson
  };
}

async function auditEntries(
  database: DatabaseExecutor,
  query: AuditQuery,
  limit: number,
  cursor?: AuditCursor
): Promise<ApiAuditEntry[]> {
  let statement = database.selectFrom("audit_log")
    .leftJoin("app_users", "app_users.id", "audit_log.user_email")
    .leftJoin("data_transfer_actors as transfer_actors", "transfer_actors.id", "audit_log.user_email")
    .select([
      "audit_log.id",
      "audit_log.timestamp",
      "audit_log.user_email as userEmail",
      (expression) => expression.fn.coalesce(
        "app_users.display_name",
        "transfer_actors.display_name"
      ).as("userDisplayName"),
      "audit_log.entity_type as entityType",
      "audit_log.entity_id as entityId",
      "audit_log.action",
      "audit_log.field_name as fieldName",
      "audit_log.old_value as oldValue",
      "audit_log.new_value as newValue",
      "audit_log.metadata_json as metadataJson"
    ])
    .where("audit_log.deleted_at", "is", null);
  if (query.entityType) statement = statement.where("audit_log.entity_type", "=", query.entityType);
  if (query.entityId) statement = statement.where("audit_log.entity_id", "=", query.entityId);
  if (query.startDate) statement = statement.where("audit_log.timestamp", ">=", `${query.startDate}T00:00:00.000Z`);
  if (query.endDate) statement = statement.where("audit_log.timestamp", "<=", `${query.endDate}T23:59:59.999Z`);
  if (cursor) {
    statement = statement.where((expression) => expression.or([
      expression("audit_log.timestamp", "<", cursor.timestamp),
      expression.and([
        expression("audit_log.timestamp", "=", cursor.timestamp),
        expression("audit_log.id", "<", cursor.id)
      ])
    ]));
  }
  const rows = await statement
    .orderBy("audit_log.timestamp", "desc")
    .orderBy("audit_log.id", "desc")
    .limit(limit)
    .execute();
  return rows.map(mapAuditEntry);
}

async function referencedActorIds(database: DatabaseExecutor): Promise<Set<string>> {
  const rows = await Promise.all([
    database.selectFrom("children").select("created_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("children").select("updated_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("care_parties").select("created_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("care_parties").select("updated_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("care_entries").select("created_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("care_entries").select("updated_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("trips").select("created_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("trips").select("updated_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("costs").select("created_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("costs").select("updated_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("holiday_periods").select("created_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("holiday_periods").select("updated_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("unavailable_periods").select("created_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("unavailable_periods").select("updated_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("contact_patterns").select("created_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("contact_patterns").select("updated_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("contact_rules").select("created_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("contact_rules").select("updated_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("monthly_closings").select("closed_by as id").where("deleted_at", "is", null).execute(),
    database.selectFrom("monthly_closings").select("updated_by as id").where("deleted_at", "is", null).execute()
  ]);
  return new Set(rows.flat().map((row) => row.id));
}

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: AuditQuery }>("/api/audit-log", readLimit, async (request, reply) => {
    const limit = requestedLimit(request.query.limit, 500, 500);
    reply.header("Cache-Control", "no-store");
    reply.header("Deprecation", "true");
    reply.header("Link", "</api/audit-log/page>; rel=\"successor-version\"");
    return auditEntries(app.persistence.query, request.query, limit);
  });

  app.get<{ Querystring: AuditQuery }>("/api/audit-log/page", readLimit, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    let cursor: AuditCursor | undefined;
    try {
      cursor = decodeCursor(request.query.cursor);
    } catch {
      return reply.code(400).send({ error: "invalid_request", message: "Ungültige Anfrage." });
    }
    const limit = requestedLimit(request.query.limit, 50, 100);
    const rows = await auditEntries(app.persistence.query, request.query, limit + 1, cursor);
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
    const referenced = await referencedActorIds(app.persistence.query);
    const visibleIds = ids.filter((id) => referenced.has(id));
    if (!visibleIds.length) return [];
    const [users, actors] = await Promise.all([
      app.persistence.query.selectFrom("app_users")
        .select(["id", "display_name as displayName"])
        .where("id", "in", visibleIds)
        .execute(),
      app.persistence.query.selectFrom("data_transfer_actors")
        .select(["id", "display_name as displayName"])
        .where("id", "in", visibleIds)
        .execute()
    ]);
    const rows: ApiActorLabel[] = [...users, ...actors];
    const labelsById = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => labelsById.get(id) ?? []);
  });
}
