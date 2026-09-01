import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { db } from "../db/connection.js";
import { setMembershipRole } from "../services/memberships.js";
import { installationOwnerId } from "../services/memberManagement.js";
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
      .send(createPortableTransfer());
  });

  app.post("/api/data-transfer/preview", sensitive, async (request, reply) => {
    try {
      const result = dryRunPortableTransfer(request.body);
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
      return noStore(reply).send(dryRunPortableTransfer(request.body));
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
      const result = importPortableTransfer({
        package: body.package,
        fingerprint: body.fingerprint,
        dryRunReceipt: body.dryRunReceipt,
        confirmWarnings: body.confirmWarnings === true,
        actorId: request.userEmail
      });
      return noStore(reply).send(result);
    } catch (error) {
      return noStore(reply).code(400).send(errorReply(error));
    }
  });

  app.get("/api/data-transfer/actors", sensitive, async (_request, reply) => noStore(reply).send(listTransferActors()));

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
      db.transaction(() => {
        const actor = db.prepare("SELECT id FROM data_transfer_actors WHERE id = ?").get(request.params.id);
        const user = db.prepare("SELECT id FROM app_users WHERE id = ? AND deleted_at IS NULL").get(userId);
        if (!actor || !user) throw new Error("Actor or target user was not found.");
        const effectiveRole = userId === installationOwnerId(db) ? "admin" : role;
        setMembershipRole(userId, effectiveRole, actorId, new Date().toISOString(), db);
        const timestamp = new Date().toISOString();
        db.prepare(`
          UPDATE data_transfer_actors
          SET mapped_user_id = ?, updated_by = ?, updated_at = ?
          WHERE id = ?
        `).run(userId, actorId, timestamp, request.params.id);
        db.prepare(`
          UPDATE app_user_care_party_assignments
          SET deleted_at = ?, updated_by = ?, updated_at = ?
          WHERE user_id = ? AND deleted_at IS NULL
        `).run(timestamp, actorId, timestamp, userId);
        const insert = db.prepare(`
          INSERT INTO app_user_care_party_assignments (
            id, user_id, care_party_id, created_by, updated_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const carePartyId of carePartyIds) {
          const exists = db.prepare("SELECT 1 FROM care_parties WHERE id = ? AND deleted_at IS NULL").get(carePartyId);
          if (!exists) throw new Error("Care-party mapping is invalid.");
          insert.run(randomUUID(), userId, carePartyId, actorId, actorId, timestamp, timestamp);
        }
      })();
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
    const actor = db.prepare("SELECT id, email_hint AS email FROM data_transfer_actors WHERE id = ?").get(request.params.id) as { id: string; email: string | null } | undefined;
    if (!actor) return noStore(reply).code(404).send({ error: "not_found", message: "Imported actor was not found." });
    try {
      const created = createInvitation({
        role,
        expiresAt: body.expiresAt,
        actorId: request.userEmail,
        emailHint: typeof body.emailHint === "string" ? body.emailHint : actor.email ?? undefined,
        dataTransferActorId: actor.id
      });
      db.prepare("UPDATE data_transfer_actors SET invitation_id = ?, updated_by = ?, updated_at = ? WHERE id = ?")
        .run(created.invitation.id, request.userEmail, new Date().toISOString(), actor.id);
      return noStore(reply)
        .code(201)
        .send(toApiCreatedInvitation(created, config.invitationPublicBaseUrl));
    } catch (error) {
      return noStore(reply).code(400).send(errorReply(error));
    }
  });
}
