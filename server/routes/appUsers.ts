import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { db } from "../db/connection.js";
import { recordAudit } from "../services/audit.js";
import { assertActiveCareParty } from "../services/careParties.js";
import { nowIso } from "../services/common.js";
import { listAppUsers } from "../services/users.js";
import { userCarePartyAssignmentInputSchema } from "../validation/schemas.js";

const readLimit = {
  config: { rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};

function activeAssignmentIds(userId: string): string[] {
  return (db.prepare(`
    SELECT care_party_id AS carePartyId
    FROM app_user_care_party_assignments
    WHERE user_id = ? AND deleted_at IS NULL
    ORDER BY care_party_id
  `).all(userId) as Array<{ carePartyId: string }>).map((row) => row.carePartyId);
}

export async function appUserRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/app-users", readLimit, async () => listAppUsers());

  app.get("/api/user-care-party-assignments", readLimit, async () =>
    listAppUsers().map((user) => ({
      userId: user.id,
      carePartyIds: activeAssignmentIds(user.id)
    }))
  );

  app.put<{ Params: { userId: string } }>("/api/user-care-party-assignments/:userId", writeLimit, async (request, reply) => {
    const parsed = userCarePartyAssignmentInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const user = listAppUsers().find((item) => item.id === request.params.userId);
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
