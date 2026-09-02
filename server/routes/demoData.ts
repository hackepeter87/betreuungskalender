import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { dryRunPortableTransfer, importPortableTransfer } from "../services/dataTransfer.js";
import {
  createEdgeCaseDemoData,
  edgeCaseDemoSummary
} from "../services/demoFixtures.js";

export async function demoDataRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/demo-data/edge-cases", { config: { permission: "admin:destructive" } }, async (request, reply) => {
    if (!config.demoDatasetsEnabled) {
      return reply.code(404).send({
        error: "not_found",
        message: "Ressource nicht gefunden."
      });
    }

    const data = createEdgeCaseDemoData();
    const dryRun = await dryRunPortableTransfer(data, app.persistence);
    await importPortableTransfer({
      package: data,
      fingerprint: dryRun.fingerprint,
      dryRunReceipt: dryRun.dryRunReceipt!,
      confirmWarnings: true,
      actorId: request.userEmail
    }, app.persistence);
    return reply.send(edgeCaseDemoSummary(data));
  });
}
