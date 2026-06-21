import type { FastifyInstance } from "fastify";
import { ExternalCalendarError, deleteExternalCalendarSource, importExternalCalendar, listExternalCalendarSources, updateExternalCalendarSource, visibleExternalCalendarEvents } from "../services/externalCalendars.js";
import { externalCalendarImportSchema, externalCalendarUpdateSchema } from "../validation/schemas.js";

function errorReply(reply: { code(status: number): { send(payload: unknown): unknown } }, error: unknown) {
  if (error instanceof ExternalCalendarError) return reply.code(error.code === "external_calendar_not_found" ? 404 : 400).send({ error: error.code });
  throw error;
}

export async function externalCalendarRoutes(app: FastifyInstance): Promise<void> {
  const readLimit = { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } };
  const writeLimit = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };
  app.get("/api/external-calendars", readLimit, async () => listExternalCalendarSources());
  app.post("/api/external-calendars/import", writeLimit, async (request, reply) => {
    const parsed = externalCalendarImportSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "external_calendar_invalid" });
    try { return reply.code(201).send(importExternalCalendar(parsed.data)); } catch (error) { return errorReply(reply, error); }
  });
  app.put<{ Params: { id: string } }>("/api/external-calendars/:id/import", writeLimit, async (request, reply) => {
    const parsed = externalCalendarImportSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "external_calendar_invalid" });
    try { return importExternalCalendar(parsed.data, request.params.id); } catch (error) { return errorReply(reply, error); }
  });
  app.patch<{ Params: { id: string } }>("/api/external-calendars/:id", writeLimit, async (request, reply) => {
    const parsed = externalCalendarUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "external_calendar_invalid" });
    try { return updateExternalCalendarSource(request.params.id, parsed.data); } catch (error) { return errorReply(reply, error); }
  });
  app.delete<{ Params: { id: string } }>("/api/external-calendars/:id", writeLimit, async (request, reply) => {
    if (!deleteExternalCalendarSource(request.params.id)) return reply.code(404).send({ error: "external_calendar_not_found" });
    return reply.code(204).send();
  });
  app.get<{ Querystring: { from?: string; to?: string } }>("/api/external-calendar-events", readLimit, async (request, reply) => {
    const { from, to } = request.query;
    if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 370 * 86_400_000) {
      return reply.code(400).send({ error: "external_calendar_invalid" });
    }
    return visibleExternalCalendarEvents(from, to);
  });
}
