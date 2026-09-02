import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { setMembershipRole } from "../services/memberships.js";
import { createInvitation } from "../services/invitations.js";
import { toApiCreatedInvitation } from "../services/invitationResponses.js";
import {
  createPortableTransfer,
  dryRunPortableTransfer,
  importPortableTransfer,
  listTransferActors
} from "../services/dataTransfer.js";
import type { WorkspaceRole } from "../auth.js";

const sensitive = {
  bodyLimit: config.dataTransferMaxBytes,
  config: {
    permission: "admin:destructive" as const,
    rateLimit: { max: config.rateLimitSensitiveMax, timeWindow: config.rateLimitWindowMs }
  }
};

function noStore<T extends { header(name: string, value: string): unknown }>(reply: T): T {
  reply.header("cache-control", "no-store, max-age=0");
  reply.header("pragma", "no-cache");
  reply.header("expires", "0");
  return reply;
}

function errorReply(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const code = message.includes("checksum") || message.includes("differs from the tested package")
    ? "data_transfer_package_changed"
    : message.includes("format version")
      ? "data_transfer_incompatible_format"
      : message.includes("current successful dry run")
        ? "data_transfer_dry_run_expired"
        : "data_transfer_failed";
  return {
    error: code,
    message: "Data transfer could not be completed. Review the package and dry-run result."
  };
}

function workspaceRole(value: unknown): WorkspaceRole | undefined {
  return value === "admin" || value === "editor" || value === "scheduler" || value === "viewer"
    ? value
    : undefined;
}

export async function dataTransferRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/data-transfer/export", sensitive, async (_request, reply) => {
    return noStore(reply)
      .header("content-disposition", `attachment; filename="betreuungskalender-transfer-${new Date().toISOString().slice(0, 10)}.json"`)
      .send(await createPortableTransfer(app.persistence));
  });

  app.post("/api/data-transfer/preview", sensitive, async (request, reply) => {
    try {
      const result = await dryRunPortableTransfer(request.body, app.persistence);
      return noStore(reply).send({
        fingerprint: result.fingerprint,
        formatVersion: result.formatVersion,
        sourceVersion: result.sourceVersion,
        counts: result.counts,
        actors: result.actors
      });
    } catch (error) {
      return noStore(reply).code(400).send(errorReply(error));
    }
  });

  app.post("/api/data-transfer/dry-run", sensitive, async (request, reply) => {
    try {
      return noStore(reply).send(await dryRunPortableTransfer(request.body, app.persistence));
    } catch (error) {
      return noStore(reply).code(400).send(errorReply(error));
    }
  });

  app.put("/api/data-transfer/import", sensitive, async (request, reply) => {
    const body = request.body as {
      package?: unknown;
      fingerprint?: unknown;
      dryRunReceipt?: unknown;
      confirmWarnings?: unknown;
    };
    if (!body || typeof body.fingerprint !== "string" || typeof body.dryRunReceipt !== "string" || !("package" in body)) {
      return noStore(reply).code(400).send({ error: "validation_error", message: "Import request is incomplete." });
    }
    try {
      const result = await importPortableTransfer({
        package: body.package,
        fingerprint: body.fingerprint,
        dryRunReceipt: body.dryRunReceipt,
        confirmWarnings: body.confirmWarnings === true,
        actorId: request.userEmail
      }, app.persistence);
      return noStore(reply).send(result);
    } catch (error) {
      return noStore(reply).code(400).send(errorReply(error));
    }
  });

  app.get("/api/data-transfer/actors", sensitive, async (_request, reply) =>
    noStore(reply).send(await listTransferActors(app.persistence.query))
  );

  app.put<{ Params: { id: string } }>("/api/data-transfer/actors/:id/mapping", sensitive, async (request, reply) => {
    const body = request.body as { userId?: unknown; role?: unknown; carePartyIds?: unknown };
    const role = workspaceRole(body?.role);
    const carePartyIds = Array.isArray(body?.carePartyIds)
      ? body.carePartyIds.filter((value): value is string => typeof value === "string")
      : [];
    if (typeof body?.userId !== "string" || !role) {
      return noStore(reply).code(400).send({ error: "validation_error", message: "Mapping request is incomplete." });
    }
    const userId = body.userId;
    const actorId = request.userEmail;
    try {
      await app.persistence.transaction(async (database) => {
        const actor = await database.selectFrom("data_transfer_actors")
          .select("id")
          .where("id", "=", request.params.id)
          .executeTakeFirst();
        const user = await database.selectFrom("app_users")
          .select("id")
          .where("id", "=", userId)
          .where("deleted_at", "is", null)
          .executeTakeFirst();
        if (!actor || !user) throw new Error("Actor or target user was not found.");
        const ownerSetting = await database.selectFrom("settings")
          .select("value_json")
          .where("key", "=", "setup.ownerUserId")
          .where("deleted_at", "is", null)
          .executeTakeFirst();
        const ownerId = ownerSetting
          ? JSON.parse(ownerSetting.value_json) as unknown
          : undefined;
        const effectiveRole = userId === ownerId ? "admin" : role;
        const timestamp = new Date().toISOString();
        await setMembershipRole(userId, effectiveRole, actorId, database, timestamp);
        await database.updateTable("data_transfer_actors")
          .set({ mapped_user_id: userId, updated_by: actorId, updated_at: timestamp })
          .where("id", "=", request.params.id)
          .execute();
        await database.updateTable("app_user_care_party_assignments")
          .set({ deleted_at: timestamp, updated_by: actorId, updated_at: timestamp })
          .where("user_id", "=", userId)
          .where("deleted_at", "is", null)
          .execute();
        for (const carePartyId of carePartyIds) {
          const exists = await database.selectFrom("care_parties")
            .select("id")
            .where("id", "=", carePartyId)
            .where("deleted_at", "is", null)
            .executeTakeFirst();
          if (!exists) throw new Error("Care-party mapping is invalid.");
          await database.insertInto("app_user_care_party_assignments").values({
            id: randomUUID(),
            user_id: userId,
            care_party_id: carePartyId,
            created_by: actorId,
            updated_by: actorId,
            created_at: timestamp,
            updated_at: timestamp,
            deleted_at: null
          }).execute();
        }
      });
      return noStore(reply).send({ mapped: true });
    } catch (error) {
      return noStore(reply).code(400).send(errorReply(error));
    }
  });

  app.post<{ Params: { id: string } }>("/api/data-transfer/actors/:id/invitation", sensitive, async (request, reply) => {
    const body = request.body as { role?: unknown; expiresAt?: unknown; emailHint?: unknown };
    const role = workspaceRole(body?.role);
    if (!role || typeof body?.expiresAt !== "string") {
      return noStore(reply).code(400).send({ error: "validation_error", message: "Invitation request is incomplete." });
    }
    const actor = await app.persistence.query.selectFrom("data_transfer_actors")
      .select(["id", "email_hint as email"])
      .where("id", "=", request.params.id)
      .executeTakeFirst();
    if (!actor) return noStore(reply).code(404).send({ error: "not_found", message: "Imported actor was not found." });
    try {
      const created = await createInvitation({
        role,
        expiresAt: body.expiresAt,
        actorId: request.userEmail,
        emailHint: typeof body.emailHint === "string" ? body.emailHint : actor.email ?? undefined,
        dataTransferActorId: actor.id
      }, app.persistence.query);
      await app.persistence.query.updateTable("data_transfer_actors")
        .set({
          invitation_id: created.invitation.id,
          updated_by: request.userEmail,
          updated_at: new Date().toISOString()
        })
        .where("id", "=", actor.id)
        .execute();
      return noStore(reply)
        .code(201)
        .send(toApiCreatedInvitation(created, config.invitationPublicBaseUrl));
    } catch (error) {
      return noStore(reply).code(400).send(errorReply(error));
    }
  });
}
