import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db/connection.js";
import { importData } from "./appData.js";
import {
  createEdgeCaseDemoData,
  edgeCaseDemoSummary
} from "../services/demoFixtures.js";

export async function demoDataRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/demo-data/edge-cases", async (request, reply) => {
    if (!config.demoDatasetsEnabled) {
      return reply.code(404).send({
        error: "not_found",
        message: "Ressource nicht gefunden."
      });
    }

    const data = createEdgeCaseDemoData();
    db.transaction(() => importData(data, request.userEmail))();
    return reply.send(edgeCaseDemoSummary(data));
  });
}
