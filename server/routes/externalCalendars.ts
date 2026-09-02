import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { ExternalCalendarError, deleteExternalCalendarSource, deriveHolidayPeriodsFromExternalCalendar, importExternalCalendar, importExternalCalendarFeed, listExternalCalendarBackupEvents, listExternalCalendarSources, refreshExternalCalendarFeed, updateExternalCalendarSource, visibleExternalCalendarEvents } from "../services/externalCalendars.js";
import { externalCalendarFeedSchema, externalCalendarHolidayDeriveSchema, externalCalendarImportSchema, externalCalendarUpdateSchema } from "../validation/schemas.js";

function errorReply(reply: { code(status: number): { send(payload: unknown): unknown } }, error: unknown) {
  if (error instanceof ExternalCalendarError) return reply.code(error.code === "external_calendar_not_found" ? 404 : 400).send({ error: error.code });
  throw error;
}

export async function externalCalendarRoutes(app: FastifyInstance): Promise<void> {
  const readLimit = {
    config: {
      permission: "planning:view" as const,
      rateLimit: {
        max: config.rateLimitMax,
        timeWindow: config.rateLimitWindowMs
      }
    }
  };
  const exportLimit = {
    config: {
      permission: "exports:run" as const,
      rateLimit: {
        max: config.rateLimitExportMax,
        timeWindow: config.rateLimitWindowMs
      }
    }
  };
  const writeLimit = {
    config: {
      permission: "planning:manage" as const,
      rateLimit: {
        max: config.rateLimitWriteMax,
        timeWindow: config.rateLimitWindowMs
      }
    }
  };
  app.get("/api/external-calendars", readLimit, async () => listExternalCalendarSources(app.persistence.query));
  app.get("/api/external-calendar-events/export", exportLimit, async () => listExternalCalendarBackupEvents(app.persistence.query));
  app.post("/api/external-calendars/import", writeLimit, async (request, reply) => {
    const parsed = externalCalendarImportSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "external_calendar_invalid" });
    try { return reply.code(201).send(await importExternalCalendar(app.persistence, parsed.data)); } catch (error) { return errorReply(reply, error); }
  });
  app.put<{ Params: { id: string } }>("/api/external-calendars/:id/import", writeLimit, async (request, reply) => {
    const parsed = externalCalendarImportSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "external_calendar_invalid" });
    try { return await importExternalCalendar(app.persistence, parsed.data, request.params.id); } catch (error) { return errorReply(reply, error); }
  });
  app.post("/api/external-calendars/feed", writeLimit, async (request, reply) => {
    const parsed = externalCalendarFeedSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "external_calendar_invalid" });
    try { return reply.code(201).send(await importExternalCalendarFeed(app.persistence, parsed.data)); } catch (error) { return errorReply(reply, error); }
  });
  app.put<{ Params: { id: string } }>("/api/external-calendars/:id/feed", writeLimit, async (request, reply) => {
    const parsed = externalCalendarFeedSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "external_calendar_invalid" });
    try { return await importExternalCalendarFeed(app.persistence, parsed.data, request.params.id); } catch (error) { return errorReply(reply, error); }
  });
  app.post<{ Params: { id: string } }>("/api/external-calendars/:id/refresh", writeLimit, async (request, reply) => {
    try { return await refreshExternalCalendarFeed(app.persistence, request.params.id); } catch (error) { return errorReply(reply, error); }
  });
  app.patch<{ Params: { id: string } }>("/api/external-calendars/:id", writeLimit, async (request, reply) => {
    const parsed = externalCalendarUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "external_calendar_invalid" });
    try { return await updateExternalCalendarSource(app.persistence.query, request.params.id, parsed.data); } catch (error) { return errorReply(reply, error); }
  });
  app.post<{ Params: { id: string } }>("/api/external-calendars/:id/derive-holidays", writeLimit, async (request, reply) => {
    const parsed = externalCalendarHolidayDeriveSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    try {
      return await deriveHolidayPeriodsFromExternalCalendar(app.persistence, request.params.id, {
        ...parsed.data,
        userEmail: request.userEmail
      });
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.delete<{ Params: { id: string } }>("/api/external-calendars/:id", writeLimit, async (request, reply) => {
    if (!await deleteExternalCalendarSource(app.persistence.query, request.params.id)) return reply.code(404).send({ error: "external_calendar_not_found" });
    return reply.code(204).send();
  });
  app.get<{ Querystring: { from?: string; to?: string } }>("/api/external-calendar-events", readLimit, async (request, reply) => {
    const { from, to } = request.query;
    if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 370 * 86_400_000) {
      return reply.code(400).send({ error: "external_calendar_invalid" });
    }
    return visibleExternalCalendarEvents(app.persistence.query, from, to);
  });
}
