import { createHash } from "node:crypto";
import type {
  FastifyInstance,
  FastifyRequest,
  RouteOptions,
  preHandlerAsyncHookHandler
} from "fastify";
import { cookieValue } from "./cookies.js";

const writeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const demoWriteBodyLimit = 64 * 1024;
const demoWindowMs = 60_000;

function routePath(request: Parameters<preHandlerAsyncHookHandler>[0]): string {
  const registered = request.routeOptions?.url;
  if (registered) return registered;
  try {
    return new URL(request.url, "http://localhost").pathname;
  } catch {
    return request.url.split("?")[0] ?? request.url;
  }
}

function isMasterDataMutation(method: string, path: string): boolean {
  if (!writeMethods.has(method)) return false;
  return path === "/api/children" ||
    path.startsWith("/api/children/") ||
    path === "/api/care-parties" ||
    path.startsWith("/api/care-parties/");
}

function isOwnerBootstrap(method: string, path: string): boolean {
  return (method === "POST" && path === "/api/setup/first-use") ||
    (method === "GET" && (path === "/setup" || path === "/setup/continue"));
}

function isExternalCalendarMutation(method: string, path: string): boolean {
  return writeMethods.has(method) && path.startsWith("/api/external-calendars");
}

export function isDemoModeRouteForbidden(methodValue: string, path: string): boolean {
  const method = methodValue.toUpperCase();
  if (isMasterDataMutation(method, path) || isOwnerBootstrap(method, path)) return true;
  if (method === "GET" && (path === "/invite" || path === "/invite/continue")) return true;
  if (isExternalCalendarMutation(method, path)) return true;
  if (method === "PUT" && path === "/api/settings") return true;
  if (method === "PUT" && path === "/api/notification-preferences") return true;
  if (path === "/api/push-subscriptions" || path.startsWith("/api/push-subscriptions/")) return true;
  if (path === "/api/invitations" || path.startsWith("/api/invitations/")) return true;
  if (path === "/api/calendar-feed" || path.startsWith("/api/calendar-feed/")) return true;
  if (path === "/calendar" || path.startsWith("/calendar/")) return true;
  return [
    "/api/app-data",
    "/api/data-transfer",
    "/api/migration",
    "/api/demo-data",
    "/api/privacy-actions"
  ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function createDemoModeBoundaryHook(
  enabled: boolean
): preHandlerAsyncHookHandler {
  return async (request) => {
    if (!enabled) return;
    if (!isDemoModeRouteForbidden(request.method, routePath(request))) return;
    throw Object.assign(new Error("Diese Aktion ist im Demo-Modus nicht verfügbar."), {
      code: "forbidden",
      statusCode: 403
    });
  };
}

type RouteRateLimit = false | { max: number; timeWindow: number };

function tighterRateLimit(
  current: RouteRateLimit | undefined,
  max: number
): RouteRateLimit {
  if (current === false || !current) return { max, timeWindow: demoWindowMs };
  return {
    max: Math.min(current.max, max),
    timeWindow: Math.min(current.timeWindow, demoWindowMs)
  };
}

export function applyDemoModeRoutePolicy(route: RouteOptions, enabled: boolean): void {
  if (!enabled) return;
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  const hasWrite = methods.some((method) => writeMethods.has(method.toUpperCase()));
  if (hasWrite) {
    route.bodyLimit = Math.min(route.bodyLimit ?? demoWriteBodyLimit, demoWriteBodyLimit);
  }

  const config = route.config ?? {};
  const current = config.rateLimit as RouteRateLimit | undefined;
  if (route.url === "/api/demo/public") {
    route.config = { ...config, rateLimit: tighterRateLimit(current, 60) };
  } else if (["/auth/login", "/setup/continue", "/invite/continue"].includes(route.url)) {
    route.config = { ...config, rateLimit: tighterRateLimit(current, 10) };
  } else if (hasWrite) {
    route.config = { ...config, rateLimit: tighterRateLimit(current, 30) };
  }
}

export function installDemoModeRoutePolicy(app: FastifyInstance, enabled: boolean): void {
  app.addHook("onRoute", (route) => applyDemoModeRoutePolicy(route, enabled));
}

type DemoRequestKind = "public_read" | "write" | "login";

export interface DemoRequestLimiterOptions {
  windowMs?: number;
  publicReadGlobalMax?: number;
  writeGlobalMax?: number;
  writeSessionMax?: number;
  loginGlobalMax?: number;
}

interface WindowCounter {
  startedAt: number;
  count: number;
}

export class DemoRequestLimiter {
  private readonly windowMs: number;
  private readonly globalLimits: Record<DemoRequestKind, number>;
  private readonly writeSessionMax: number;
  private readonly globalCounters = new Map<DemoRequestKind, WindowCounter>();
  private readonly sessionCounters = new Map<string, WindowCounter>();

  constructor(options: DemoRequestLimiterOptions = {}) {
    this.windowMs = options.windowMs ?? demoWindowMs;
    this.globalLimits = {
      public_read: options.publicReadGlobalMax ?? 600,
      write: options.writeGlobalMax ?? 120,
      login: options.loginGlobalMax ?? 60
    };
    this.writeSessionMax = options.writeSessionMax ?? 30;
  }

  private increment(counter: WindowCounter | undefined, now: number): WindowCounter {
    if (!counter || now - counter.startedAt >= this.windowMs) {
      return { startedAt: now, count: 1 };
    }
    counter.count += 1;
    return counter;
  }

  private reject(counter: WindowCounter, now: number): never {
    const retryAfterSeconds = Math.max(1, Math.ceil(
      (counter.startedAt + this.windowMs - now) / 1000
    ));
    throw Object.assign(new Error("Zu viele Anfragen. Bitte später erneut versuchen."), {
      code: "rate_limit_exceeded",
      statusCode: 429,
      retryAfterSeconds
    });
  }

  consume(kind: DemoRequestKind, sessionKey?: string, now = Date.now()): void {
    const global = this.increment(this.globalCounters.get(kind), now);
    this.globalCounters.set(kind, global);
    if (global.count > this.globalLimits[kind]) this.reject(global, now);

    if (kind !== "write") return;
    const key = sessionKey ?? "missing-session";
    const session = this.increment(this.sessionCounters.get(key), now);
    this.sessionCounters.set(key, session);
    if (session.count > this.writeSessionMax) this.reject(session, now);

    if (this.sessionCounters.size > 64) {
      for (const [storedKey, counter] of this.sessionCounters) {
        if (now - counter.startedAt >= this.windowMs) this.sessionCounters.delete(storedKey);
      }
    }
  }
}

function requestKind(request: FastifyRequest): DemoRequestKind | undefined {
  const path = routePath(request);
  if (request.method === "GET" && path === "/api/demo/public") return "public_read";
  if (request.method === "GET" && [
    "/auth/login",
    "/setup/continue",
    "/invite/continue"
  ].includes(path)) return "login";
  if (writeMethods.has(request.method.toUpperCase())) return "write";
  return undefined;
}

function requestSessionKey(request: FastifyRequest, sessionCookieName: string): string {
  const sessionToken = cookieValue(request.headers.cookie, sessionCookieName);
  const identity = sessionToken || request.user?.id || "missing-session";
  return createHash("sha256").update(identity).digest("base64url");
}

export function createDemoRequestLimitHook(options: {
  enabled: boolean;
  sessionCookieName: string;
  limiter?: DemoRequestLimiter;
}): preHandlerAsyncHookHandler {
  const limiter = options.limiter ?? new DemoRequestLimiter();
  return async (request) => {
    if (!options.enabled) return;
    const kind = requestKind(request);
    if (!kind) return;
    limiter.consume(
      kind,
      kind === "write" ? requestSessionKey(request, options.sessionCookieName) : undefined
    );
  };
}

export function demoModeAllowsExternalSideEffects(enabled: boolean): boolean {
  return !enabled;
}
