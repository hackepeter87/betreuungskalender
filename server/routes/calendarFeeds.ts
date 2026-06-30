import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";
import {
  buildPersonalCalendarFeed,
  calendarFeedStatus,
  resolveCalendarFeedToken,
  revokeCalendarFeedTokens,
  rotateCalendarFeedToken
} from "../services/calendarFeeds.js";

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
  app.get("/api/calendar-feed", readLimit, async (request) =>
    calendarFeedStatus(request.userEmail)
  );

  app.post("/api/calendar-feed", writeLimit, async (request, reply) => {
    const { token, status } = rotateCalendarFeedToken(request.userEmail);
    return reply.code(201).send({
      ...status,
      feedUrl: feedUrl(request, token)
    });
  });

  app.delete("/api/calendar-feed", writeLimit, async (request, reply) => {
    revokeCalendarFeedTokens(request.userEmail);
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
    const calendar = buildPersonalCalendarFeed({
      userId: token.user_id,
      displayName: token.display_name
    });
    return reply
      .header("content-type", "text/calendar; charset=utf-8")
      .header("cache-control", "no-store")
      .header("content-disposition", 'inline; filename="betreuungskalender.ics"')
      .send(calendar);
  });
}
