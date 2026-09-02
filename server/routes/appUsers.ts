import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import type { DatabaseExecutor } from "../db/runtime.js";
import {
  assertCanAdministerMembers,
  listMembers,
  MemberManagementError,
  removeMember,
  updateMemberRole
} from "../services/memberManagement.js";
import { listAppUsers } from "../services/users.js";
import {
  memberRoleInputSchema,
  userCarePartyAssignmentInputSchema
} from "../validation/schemas.js";

const readLimit = {
  config: { permission: "members:manage" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { permission: "members:manage" as const, rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};

class AssignmentError extends Error {
  constructor(
    readonly code: "unknown_user" | "invalid_relation",
    readonly statusCode: 400 | 404,
    message: string
  ) {
    super(message);
  }
}

async function activeAssignmentIds(userId: string, database: DatabaseExecutor): Promise<string[]> {
  const rows = await database.selectFrom("app_user_care_party_assignments")
    .select("care_party_id")
    .where("user_id", "=", userId)
    .where("deleted_at", "is", null)
    .orderBy("care_party_id")
    .execute();
  return rows.map((row) => row.care_party_id);
}

function normalizeMemberError(error: unknown) {
  if (error instanceof MemberManagementError) {
    return { statusCode: error.statusCode, error: error.code, message: error.message };
  }
  return {
    statusCode: 500,
    error: "member_update_failed",
    message: "Mitglied konnte nicht aktualisiert werden."
  };
}

export async function appUserRoutes(app: FastifyInstance): Promise<void> {
  const userListOptions = { includeLocalDevelopmentIdentity: config.authMode === "local" };

  app.get("/api/app-users", readLimit, async () =>
    listAppUsers(app.persistence.query, userListOptions)
  );

  app.get("/api/members", readLimit, async (request, reply) => {
    try {
      await assertCanAdministerMembers(request.user, app.persistence.query);
      return await listMembers(app.persistence.query, userListOptions);
    } catch (error) {
      const normalized = normalizeMemberError(error);
      return reply.code(normalized.statusCode).send({
        error: normalized.error,
        message: normalized.message
      });
    }
  });

  app.put<{ Params: { userId: string } }>("/api/members/:userId/role", writeLimit, async (request, reply) => {
    const parsed = memberRoleInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    }
    if (!request.user) {
      return reply.code(401).send({
        error: "authentication_required",
        message: "Authentifizierung erforderlich."
      });
    }
    try {
      return await updateMemberRole(
        request.user,
        request.params.userId,
        parsed.data.role,
        app.persistence
      );
    } catch (error) {
      const normalized = normalizeMemberError(error);
      return reply.code(normalized.statusCode).send({
        error: normalized.error,
        message: normalized.message
      });
    }
  });

  app.delete<{ Params: { userId: string } }>("/api/members/:userId", writeLimit, async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({
        error: "authentication_required",
        message: "Authentifizierung erforderlich."
      });
    }
    try {
      return await removeMember(request.user, request.params.userId, app.persistence);
    } catch (error) {
      const normalized = normalizeMemberError(error);
      return reply.code(normalized.statusCode).send({
        error: normalized.error,
        message: normalized.message
      });
    }
  });

  app.get("/api/user-care-party-assignments", readLimit, async () => {
    const users = await listAppUsers(app.persistence.query, userListOptions);
    return Promise.all(users.map(async (user) => ({
      userId: user.id,
      carePartyIds: await activeAssignmentIds(user.id, app.persistence.query)
    })));
  });

  app.put<{ Params: { userId: string } }>("/api/user-care-party-assignments/:userId", writeLimit, async (request, reply) => {
    const parsed = userCarePartyAssignmentInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    }
    const uniqueIds = [...new Set(parsed.data.carePartyIds)];
    const timestamp = new Date().toISOString();
    try {
      const result = await app.persistence.transaction(async (database) => {
        const user = await database.selectFrom("app_users")
          .select("id")
          .where("id", "=", request.params.userId)
          .where("deleted_at", "is", null)
          .executeTakeFirst();
        if (!user) {
          throw new AssignmentError("unknown_user", 404, "Mitglied nicht gefunden.");
        }
        for (const carePartyId of uniqueIds) {
          const careParty = await database.selectFrom("care_parties")
            .select("id")
            .where("id", "=", carePartyId)
            .where("deleted_at", "is", null)
            .executeTakeFirst();
          if (!careParty) {
            throw new AssignmentError(
              "invalid_relation",
              400,
              "Betreuende Person ist nicht vorhanden."
            );
          }
        }
        const before = await activeAssignmentIds(request.params.userId, database);
        await database.updateTable("app_user_care_party_assignments")
          .set({ deleted_at: timestamp, updated_by: request.userEmail, updated_at: timestamp })
          .where("user_id", "=", request.params.userId)
          .where("deleted_at", "is", null)
          .execute();
        for (const carePartyId of uniqueIds) {
          await database.insertInto("app_user_care_party_assignments").values({
            id: randomUUID(),
            user_id: request.params.userId,
            care_party_id: carePartyId,
            created_by: request.userEmail,
            updated_by: request.userEmail,
            created_at: timestamp,
            updated_at: timestamp,
            deleted_at: null
          }).execute();
        }
        await database.updateTable("care_confirmation_requests")
          .set({ deleted_at: timestamp, updated_at: timestamp })
          .where("user_id", "=", request.params.userId)
          .where("deleted_at", "is", null)
          .where("answered_at", "is", null)
          .execute();
        await database.insertInto("audit_log").values({
          timestamp,
          user_email: request.userEmail,
          entity_type: "user_care_party_assignment",
          entity_id: request.params.userId,
          action: "updated",
          field_name: null,
          old_value: JSON.stringify(before),
          new_value: JSON.stringify(uniqueIds),
          metadata_json: null,
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null
        }).execute();
        return activeAssignmentIds(request.params.userId, database);
      });
      return { userId: request.params.userId, carePartyIds: result };
    } catch (error) {
      const normalized = error instanceof AssignmentError
        ? error
        : new AssignmentError("invalid_relation", 400, "Zuordnung konnte nicht gespeichert werden.");
      return reply.code(normalized.statusCode).send({
        error: normalized.code,
        message: normalized.message
      });
    }
  });
}
