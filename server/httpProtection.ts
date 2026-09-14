import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";

export function preventSensitiveResponseCaching(reply: FastifyReply): FastifyReply {
  return reply
    .header("cache-control", "no-store, max-age=0")
    .header("pragma", "no-cache")
    .header("expires", "0");
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function originFromReferer(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function originError(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error("origin_not_allowed"), {
    code: "origin_not_allowed",
    statusCode: 403
  });
}

export function assertBrowserRequestOrigin(
  request: Pick<FastifyRequest, "headers">,
  allowedOrigin: string
): void {
  const origin = firstHeader(request.headers.origin)?.trim();
  if (origin && origin !== allowedOrigin) throw originError();

  const referer = firstHeader(request.headers.referer)?.trim();
  if (referer && originFromReferer(referer) !== allowedOrigin) throw originError();

  const fetchSite = firstHeader(request.headers["sec-fetch-site"])?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") throw originError();
}

export function browserRequestOriginGuard(allowedOrigin: string): preHandlerAsyncHookHandler {
  return async (request) => assertBrowserRequestOrigin(request, allowedOrigin);
}
