import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";
import {
  buildPersonalCalendarFeed,
  calendarFeedStatus,
  parseCalendarFeedScope,
  resolveCalendarFeedToken,
  revokeCalendarFeedTokens,
  rotateCalendarFeedToken
} from "../services/calendarFeeds.js";
import { calendarFeedRequestSchema } from "../validation/schemas.js";

const readLimit = {
  config: { rateLimit: { max: config.rateLimitMax, timeWindow: config.rateLimitWindowMs } }
};
const writeLimit = {
  config: { rateLimit: { max: config.rateLimitWriteMax, timeWindow: config.rateLimitWindowMs } }
};
const feedLimit = {
  config: { rateLimit: { max: config.rateLimitExportMax, timeWindow: config.rateLimitWindowMs } }
};

function firstHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(",")[0]?.trim();
}

function requestOrigin(request: FastifyRequest): string {
  const proto = firstHeader(request.headers["x-forwarded-proto"]) ?? request.protocol;
  const host = firstHeader(request.headers["x-forwarded-host"]) ?? request.headers.host;
  return `${proto}://${host ?? "localhost"}`;
}

function feedUrl(request: FastifyRequest, token: string): string {
  return `${requestOrigin(request)}/calendar/${encodeURIComponent(token)}.ics`;
}

function tokenFromParam(value: string): string {
  return value.endsWith(".ics") ? value.slice(0, -4) : value;
}

export async function calendarFeedRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { scope?: string } }>("/api/calendar-feed", readLimit, async (request) => {
    const scope = parseCalendarFeedScope(request.query.scope).scope;
    return calendarFeedStatus(request.userEmail, scope);
  });

  app.post("/api/calendar-feed", writeLimit, async (request, reply) => {
    const parsed = calendarFeedRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    try {
      const scope = parseCalendarFeedScope(parsed.data.scope).scope;
      const { token, status } = rotateCalendarFeedToken(request.userEmail, scope);
      return reply.code(201).send({
        ...status,
        feedUrl: feedUrl(request, token)
      });
    } catch (error) {
      return reply.code(400).send({
        error: "invalid_feed_scope",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.delete<{ Querystring: { scope?: string } }>("/api/calendar-feed", writeLimit, async (request, reply) => {
    const scope = request.query.scope ? parseCalendarFeedScope(request.query.scope).scope : undefined;
    revokeCalendarFeedTokens(request.userEmail, scope);
    return reply.code(204).send();
  });

  app.get<{ Params: { token: string } }>("/calendar/:token", feedLimit, async (request, reply) => {
    const token = resolveCalendarFeedToken(tokenFromParam(request.params.token));
    if (!token) {
      return reply.code(404).send({
        error: "not_found",
        message: "Kalenderfeed nicht gefunden."
      });
    }
    const calendar = buildPersonalCalendarFeed({ token });
    return reply
      .header("content-type", "text/calendar; charset=utf-8")
      .header("cache-control", "no-store")
      .header("content-disposition", 'inline; filename="betreuungskalender.ics"')
      .send(calendar);
  });
}
