import type { FastifyInstance } from "fastify";
import { db } from "../db/connection.js";
import { recordFieldChanges } from "../services/audit.js";
import { nowIso } from "../services/common.js";
import { settingsInputSchema } from "../validation/schemas.js";

const defaults: Record<string, unknown> = {
  kilometerRate: 0.3,
  defaultLocation: "commuterApartment",
  defaultHandoverFrom: "mother",
  defaultHandoverTo: "mother"
};

function getSettings(): Record<string, unknown> {
  const rows = db.prepare(`
    SELECT key, value_json AS valueJson
    FROM settings
    WHERE deleted_at IS NULL
  `).all() as Array<{ key: string; valueJson: string }>;
  const stored = Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.valueJson) as unknown]));
  return { ...defaults, ...stored };
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", async () => getSettings());

  app.put("/api/settings", async (request, reply) => {
    const parsed = settingsInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    const before = getSettings();
    const timestamp = nowIso();
    db.transaction(() => {
      const upsert = db.prepare(`
        INSERT INTO settings (key, value_json, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at,
          deleted_at = NULL
      `);
      for (const [key, value] of Object.entries(parsed.data)) {
        upsert.run(key, JSON.stringify(value), timestamp, timestamp);
      }
      recordFieldChanges(
        request.userEmail,
        "settings",
        "global",
        before,
        { ...before, ...parsed.data }
      );
    })();
    return getSettings();
  });
}
