import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import type { PersistenceExecutor } from "../db/runtime.js";
import { nowIso } from "../services/common.js";
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

async function activeAssignmentIds(
  userId: string,
  database: PersistenceExecutor
): Promise<string[]> {
  return (await database.all<{ carePartyId: string }>(`
    SELECT care_party_id AS carePartyId
    FROM app_user_care_party_assignments
    WHERE user_id = ? AND deleted_at IS NULL
    ORDER BY care_party_id
  `, [userId])).map((row) => row.carePartyId);
}

function normalizeMemberError(error: unknown) {
  if (error instanceof MemberManagementError) {
    return {
      statusCode: error.statusCode,
      error: error.code,
      message: error.message
    };
  }
  return {
    statusCode: 500,
    error: "member_update_failed",
    message: "Mitglied konnte nicht aktualisiert werden."
  };
}

export async function appUserRoutes(app: FastifyInstance): Promise<void> {
  const userListOptions = {
    includeLocalDevelopmentIdentity: config.authMode === "local"
  };

  app.get("/api/app-users", readLimit, async () =>
    listAppUsers(app.persistence, userListOptions)
  );

  app.get("/api/members", readLimit, async (request, reply) => {
    try {
      await assertCanAdministerMembers(request.user, app.persistence);
      return listMembers(app.persistence, userListOptions);
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
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
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
    const users = await listAppUsers(app.persistence, userListOptions);
    return Promise.all(users.map(async (user) => ({
      userId: user.id,
      carePartyIds: await activeAssignmentIds(user.id, app.persistence)
    })));
  });

  app.put<{ Params: { userId: string } }>("/api/user-care-party-assignments/:userId", writeLimit, async (request, reply) => {
    const parsed = userCarePartyAssignmentInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const user = (await listAppUsers(app.persistence, userListOptions))
      .find((item) => item.id === request.params.userId);
    if (!user) return reply.code(404).send({ error: "not_found" });

    const uniqueIds = [...new Set(parsed.data.carePartyIds)];
    try {
      for (const carePartyId of uniqueIds) {
        const active = await app.persistence.one(
          "SELECT 1 FROM care_parties WHERE id = ? AND deleted_at IS NULL",
          [carePartyId]
        );
        if (!active) throw new Error("Betreuende Person nicht gefunden.");
      }
    } catch (error) {
      return reply.code(400).send({
        error: "invalid_relation",
        message: error instanceof Error ? error.message : String(error)
      });
    }

    const timestamp = nowIso();
    const before = await activeAssignmentIds(request.params.userId, app.persistence);
    await app.persistence.transaction(async (transaction) => {
      await transaction.run(`
        UPDATE app_user_care_party_assignments
        SET deleted_at = ?, updated_by = ?, updated_at = ?
        WHERE user_id = ? AND deleted_at IS NULL
      `, [timestamp, request.userEmail, timestamp, request.params.userId]);

      for (const carePartyId of uniqueIds) {
        await transaction.run(`
          INSERT INTO app_user_care_party_assignments (
            id, user_id, care_party_id, created_by, updated_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          randomUUID(), request.params.userId, carePartyId, request.userEmail,
          request.userEmail, timestamp, timestamp
        ]);
      }
      await transaction.run(`
        UPDATE care_confirmation_requests
        SET deleted_at = ?, updated_at = ?
        WHERE user_id = ? AND deleted_at IS NULL AND answered_at IS NULL
          AND care_entry_id IN (
            SELECT entries.id FROM care_entries entries
            WHERE entries.responsible_party_id IS NOT NULL
              AND entries.responsible_party_id NOT IN (
                SELECT care_party_id FROM app_user_care_party_assignments
                WHERE user_id = ? AND deleted_at IS NULL
              )
          )
      `, [timestamp, timestamp, request.params.userId, request.params.userId]);
      await transaction.run(`
        INSERT INTO audit_log (
          timestamp, user_email, entity_type, entity_id, action,
          old_value, new_value, created_at, updated_at
        ) VALUES (?, ?, 'user_care_party_assignment', ?, 'updated', ?, ?, ?, ?)
      `, [
        timestamp, request.userEmail, request.params.userId,
        JSON.stringify(before), JSON.stringify(uniqueIds), timestamp, timestamp
      ]);
    });

    return {
      userId: request.params.userId,
      carePartyIds: await activeAssignmentIds(request.params.userId, app.persistence)
    };
  });
}
