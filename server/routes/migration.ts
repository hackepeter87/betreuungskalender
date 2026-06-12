import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  executeLegacyMigration,
  getLegacyDatabaseSummary,
  listLegacyMigrationReports,
  previewLegacyMigration,
  recordLegacyMigrationEvent
} from "../services/legacyMigration.js";
import { appDataImportSchema } from "../validation/schemas.js";

const metadataSchema = z.object({
  fingerprint: z.string().min(1).max(200),
  counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  reason: z.string().max(100).optional()
});

const previewSchema = z.object({
  data: appDataImportSchema,
  fingerprint: z.string().min(1).max(200),
  invalidRecords: z.number().int().nonnegative().default(0),
  warnings: z.array(z.string().max(500)).max(100).default([])
});

const importSchema = previewSchema.extend({
  mode: z.enum(["add", "replace"]),
  duplicatePolicy: z.enum(["skip", "include"]).default("skip")
});

export async function migrationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/migration/legacy-summary", async () => ({
    database: getLegacyDatabaseSummary(),
    reports: listLegacyMigrationReports()
  }));

  app.post("/api/migration/legacy-detected", async (request, reply) => {
    const parsed = metadataSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    }
    recordLegacyMigrationEvent(
      request.userEmail,
      "legacy_migration_detected",
      parsed.data
    );
    return reply.code(204).send();
  });

  app.post("/api/migration/legacy-skip", async (request, reply) => {
    const parsed = metadataSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    }
    recordLegacyMigrationEvent(
      request.userEmail,
      "legacy_migration_skip",
      parsed.data
    );
    return reply.code(204).send();
  });

  app.post("/api/migration/legacy-preview", async (request, reply) => {
    const parsed = previewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    }
    return previewLegacyMigration(
      parsed.data.data,
      request.userEmail,
      parsed.data.fingerprint,
      parsed.data.invalidRecords,
      parsed.data.warnings
    );
  });

  app.post("/api/migration/legacy-import", async (request, reply) => {
    const parsed = importSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    }
    try {
      return await executeLegacyMigration({
        ...parsed.data,
        userEmail: request.userEmail
      });
    } catch (error) {
      return reply.code(400).send({
        error: "migration_failed",
        message: error instanceof Error ? error.message : "Migration fehlgeschlagen."
      });
    }
  });
}
