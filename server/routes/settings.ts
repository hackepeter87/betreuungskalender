import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { nowIso } from "../services/common.js";
import {
  getPersistedClientSettings,
  recordDomainFieldChanges
} from "../services/domainPersistence.js";
import { settingsInputSchema } from "../validation/schemas.js";

const readLimit = {
  config: { permission: "settings:view" as const, rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { permission: "settings:manage" as const, rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", readLimit, async () =>
    getPersistedClientSettings(app.persistence.query)
  );

  app.put("/api/settings", writeLimit, async (request, reply) => {
    const parsed = settingsInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const referencedIds = [
      parsed.data.primaryCarePartyId,
      parsed.data.defaultResponsiblePartyId
    ].filter((value): value is string => value !== undefined);
    const activeReferences = referencedIds.length
      ? await app.persistence.query.selectFrom("care_parties")
        .select("id")
        .where("id", "in", referencedIds)
        .where("deleted_at", "is", null)
        .execute()
      : [];
    const activeIds = new Set(activeReferences.map((row) => row.id));
    const inactiveReference = referencedIds.find((value) => !activeIds.has(value));
    if (inactiveReference) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Die ausgewaehlte betreuende Person ist nicht aktiv."
      });
    }
    const before = await getPersistedClientSettings(app.persistence.query);
    const timestamp = nowIso();
    return app.persistence.transaction(async (database) => {
      for (const [key, value] of Object.entries(parsed.data)) {
        await database.insertInto("settings").values({
          key,
          value_json: JSON.stringify(value),
          created_by: request.userEmail,
          updated_by: request.userEmail,
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null
        }).onConflict((conflict) => conflict.column("key").doUpdateSet({
          value_json: JSON.stringify(value),
          updated_by: request.userEmail,
          updated_at: timestamp,
          deleted_at: null
        })).execute();
      }
      await recordDomainFieldChanges(
        database,
        request.userEmail,
        "settings",
        "global",
        before,
        { ...before, ...parsed.data }
      );
      return getPersistedClientSettings(database);
    });
  });
}
