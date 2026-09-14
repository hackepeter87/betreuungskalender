import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";

export const requestIdHeader = "x-request-id";

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$/;
const errorCodePattern = /^[a-z0-9][a-z0-9_.:-]{0,99}$/i;

export const logRedactionPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.x-auth-request-email",
  "req.headers.x-forwarded-email",
  "req.headers.x-auth-request-user",
  "req.headers.x-forwarded-user",
  "req.headers.x-auth-request-preferred-username",
  "req.headers.x-forwarded-preferred-username",
  "req.headers.x-auth-request-groups",
  "req.headers.x-forwarded-groups",
  "req.url",
  "request.url",
  "headers.authorization",
  "headers.cookie",
  "authorization",
  "cookie",
  "query",
  "body",
  "token",
  "accessToken",
  "refreshToken",
  "idToken",
  "sessionToken",
  "clientSecret",
  "authorizationCode",
  "state",
  "nonce",
  "pkceVerifier",
  "invitationUrl",
  "feedUrl",
  "filename",
  "email",
  "emailHint",
  "displayName",
  "name",
  "notes",
  "title",
  "evidenceReference"
] as const;

export function createRequestId(
  inbound: string | string[] | undefined,
  generate: () => string = randomUUID
): string {
  const candidate = Array.isArray(inbound) ? undefined : inbound?.trim();
  return candidate && requestIdPattern.test(candidate) ? candidate : generate();
}

export function safeErrorCode(error: unknown): string {
  const candidate = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "unknown";
  return errorCodePattern.test(candidate) ? candidate : "unknown";
}

export function normalizedRequestRoute(request: FastifyRequest): string {
  const route = request.routeOptions.url;
  return typeof route === "string" && route.startsWith("/") && route.length <= 200
    ? route
    : "unmatched";
}

export function installRequestDiagnostics(app: FastifyInstance): void {
  app.addHook("onRequest", (request, reply, done) => {
    reply.header(requestIdHeader, request.id);
    done();
  });
  app.addHook("onResponse", (request, reply, done) => {
    request.log.info({
      event: "http.request.completed",
      requestId: request.id,
      route: normalizedRequestRoute(request),
      method: request.method,
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime * 100) / 100
    }, "request completed");
    done();
  });
}
