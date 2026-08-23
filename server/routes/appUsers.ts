import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { db } from "../db/connection.js";
import { recordAudit } from "../services/audit.js";
import { assertActiveCareParty } from "../services/careParties.js";
import { nowIso } from "../services/common.js";
import { invalidateInaccessibleCareConfirmations } from "../services/careConfirmations.js";
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

function activeAssignmentIds(userId: string): string[] {
  return (db.prepare(`
    SELECT care_party_id AS carePartyId
    FROM app_user_care_party_assignments
    WHERE user_id = ? AND deleted_at IS NULL
    ORDER BY care_party_id
  `).all(userId) as Array<{ carePartyId: string }>).map((row) => row.carePartyId);
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

  app.get("/api/app-users", readLimit, async () => listAppUsers(db, userListOptions));

  app.get("/api/members", readLimit, async (request, reply) => {
    try {
      assertCanAdministerMembers(request.user);
      return listMembers(db, userListOptions);
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
      return updateMemberRole(request.user, request.params.userId, parsed.data.role);
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
      return removeMember(request.user, request.params.userId);
    } catch (error) {
      const normalized = normalizeMemberError(error);
      return reply.code(normalized.statusCode).send({
        error: normalized.error,
        message: normalized.message
      });
    }
  });

  app.get("/api/user-care-party-assignments", readLimit, async () =>
    listAppUsers(db, userListOptions).map((user) => ({
      userId: user.id,
      carePartyIds: activeAssignmentIds(user.id)
    }))
  );

  app.put<{ Params: { userId: string } }>("/api/user-care-party-assignments/:userId", writeLimit, async (request, reply) => {
    const parsed = userCarePartyAssignmentInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const user = listAppUsers(db, userListOptions).find((item) => item.id === request.params.userId);
    if (!user) return reply.code(404).send({ error: "not_found" });

    const uniqueIds = [...new Set(parsed.data.carePartyIds)];
    try {
      for (const carePartyId of uniqueIds) assertActiveCareParty(carePartyId);
    } catch (error) {
      return reply.code(400).send({
        error: "invalid_relation",
        message: error instanceof Error ? error.message : String(error)
      });
    }

    const timestamp = nowIso();
    const before = activeAssignmentIds(request.params.userId);
    db.transaction(() => {
      db.prepare(`
        UPDATE app_user_care_party_assignments
        SET deleted_at = ?, updated_by = ?, updated_at = ?
        WHERE user_id = ? AND deleted_at IS NULL
      `).run(timestamp, request.userEmail, timestamp, request.params.userId);

      const insert = db.prepare(`
        INSERT INTO app_user_care_party_assignments (
          id, user_id, care_party_id, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const carePartyId of uniqueIds) {
        insert.run(
          randomUUID(),
          request.params.userId,
          carePartyId,
          request.userEmail,
          request.userEmail,
          timestamp,
          timestamp
        );
      }
      invalidateInaccessibleCareConfirmations(request.params.userId, timestamp);
      recordAudit({
        userEmail: request.userEmail,
        entityType: "user_care_party_assignment",
        entityId: request.params.userId,
        action: "updated",
        oldValue: before,
        newValue: uniqueIds
      });
    })();

    return {
      userId: request.params.userId,
      carePartyIds: activeAssignmentIds(request.params.userId)
    };
  });
}
