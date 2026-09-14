import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  isTrustedProxyAddress,
  normalizeIpAddress,
  type TrustedProxyRule
} from "./trustedProxy.js";

export interface RateLimitPolicyConfig {
  defaultMax: number;
  writeMax: number;
  sensitiveMax: number;
  exportMax: number;
  timeWindowMs: number;
}

export function rateLimitIdentity(
  request: Pick<FastifyRequest, "ip" | "raw">,
  trustedProxyRules: readonly TrustedProxyRule[]
): string {
  const socketAddress = normalizeIpAddress(request.raw.socket.remoteAddress);
  const clientAddress = socketAddress && isTrustedProxyAddress(socketAddress, trustedProxyRules)
    ? normalizeIpAddress(request.ip) ?? socketAddress
    : socketAddress;
  const boundedAddress = clientAddress ?? "unknown";
  return `client:${createHash("sha256").update(boundedAddress).digest("base64url")}`;
}

function hasWriteMethod(method: string | string[]): boolean {
  const methods = Array.isArray(method) ? method : [method];
  return methods.some((value) => ["POST", "PUT", "DELETE", "PATCH"].includes(value));
}

function hasSensitiveOperation(url: string): boolean {
  return (
    url === "/api/app-data" ||
    url.startsWith("/api/migration/") ||
    url.includes("/import")
  );
}

function isExport(url: string): boolean {
  return url.endsWith("/export");
}

function routeLimit(
  method: string | string[],
  url: string,
  config: RateLimitPolicyConfig
) {
  if (hasSensitiveOperation(url)) {
    return { max: config.sensitiveMax, timeWindow: config.timeWindowMs };
  }
  if (isExport(url)) {
    return { max: config.exportMax, timeWindow: config.timeWindowMs };
  }
  if (hasWriteMethod(method)) {
    return { max: config.writeMax, timeWindow: config.timeWindowMs };
  }
  return undefined;
}

export function installRateLimitPolicy(
  app: FastifyInstance,
  config: RateLimitPolicyConfig
): void {
  app.addHook("onRoute", (routeOptions) => {
    if (routeOptions.config?.rateLimit !== undefined) return;

    if (routeOptions.url.startsWith("/calendar/")) {
      routeOptions.config = {
        ...routeOptions.config,
        rateLimit: { max: config.exportMax, timeWindow: config.timeWindowMs }
      };
      return;
    }

    if (!routeOptions.url.startsWith("/api/")) {
      routeOptions.config = { ...routeOptions.config, rateLimit: false };
      return;
    }

    const limit = routeLimit(routeOptions.method, routeOptions.url, config);
    if (limit) {
      routeOptions.config = { ...routeOptions.config, rateLimit: limit };
    }
  });
}
