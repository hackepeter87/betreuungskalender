import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance, FastifyRequest, RouteOptions } from "fastify";
import { installRateLimitPolicy, rateLimitIdentity } from "./rateLimitPolicy.js";
import { parseTrustedProxyRules } from "./trustedProxy.js";

const policy = {
  defaultMax: 120,
  writeMax: 20,
  sensitiveMax: 5,
  exportMax: 15,
  timeWindowMs: 60_000
};

function applyPolicy(route: Pick<RouteOptions, "method" | "url" | "config">): RouteOptions {
  let onRoute: ((options: RouteOptions) => void) | undefined;
  const app = {
    addHook(name: string, hook: (options: RouteOptions) => void) {
      assert.equal(name, "onRoute");
      onRoute = hook;
    }
  } as unknown as FastifyInstance;
  installRateLimitPolicy(app, policy);

  const options = route as RouteOptions;
  assert.ok(onRoute);
  onRoute(options);
  return options;
}

function rateLimitFor(route: RouteOptions) {
  assert.ok(route.config);
  return route.config.rateLimit;
}

test("explicit route budgets take precedence over central defaults", () => {
  const explicit = { max: 3, timeWindow: 1_000 };
  const route = applyPolicy({
    method: "POST",
    url: "/api/import",
    config: { rateLimit: explicit }
  });

  assert.equal(rateLimitFor(route), explicit);
});

test("explicit rate-limit exclusions are preserved", () => {
  const route = applyPolicy({
    method: "GET",
    url: "/api/public",
    config: { rateLimit: false }
  });

  assert.equal(rateLimitFor(route), false);
});

test("central policy classifies routes without an explicit budget", () => {
  const write = applyPolicy({ method: "POST", url: "/api/children", config: {} });
  const sensitive = applyPolicy({ method: "PUT", url: "/api/app-data", config: {} });
  const exported = applyPolicy({ method: "GET", url: "/api/report/export", config: {} });
  const feed = applyPolicy({ method: "GET", url: "/calendar/token", config: {} });
  const staticPage = applyPolicy({ method: "GET", url: "/datenschutz", config: {} });

  assert.deepEqual(rateLimitFor(write), { max: 20, timeWindow: 60_000 });
  assert.deepEqual(rateLimitFor(sensitive), { max: 5, timeWindow: 60_000 });
  assert.deepEqual(rateLimitFor(exported), { max: 15, timeWindow: 60_000 });
  assert.deepEqual(rateLimitFor(feed), { max: 15, timeWindow: 60_000 });
  assert.equal(rateLimitFor(staticPage), false);
});

function requestIdentity(remoteAddress: string | undefined, ip: string): string {
  return rateLimitIdentity({
    ip,
    raw: { socket: { remoteAddress } }
  } as unknown as Pick<FastifyRequest, "ip" | "raw">, parseTrustedProxyRules([
    "10.20.0.0/16",
    "2001:db8:42::/48"
  ]));
}

test("untrusted forwarding metadata cannot select the rate-limit identity", () => {
  const direct = requestIdentity("198.51.100.7", "198.51.100.7");
  const forged = requestIdentity("198.51.100.7", "203.0.113.99");

  assert.equal(forged, direct);
  assert.match(direct, /^client:[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(direct, /198\.51\.100\.7/);
});

test("trusted proxies use canonical bounded IPv4 and IPv6 client identities", () => {
  const ipv4 = requestIdentity("10.20.0.5", "198.51.100.7");
  const ipv6Compressed = requestIdentity("2001:db8:42::5", "2001:db8::1");
  const ipv6Expanded = requestIdentity(
    "2001:0db8:0042:0000:0000:0000:0000:0005",
    "2001:0db8:0000:0000:0000:0000:0000:0001"
  );

  assert.notEqual(ipv4, requestIdentity("10.20.0.5", "198.51.100.8"));
  assert.equal(ipv6Compressed, ipv6Expanded);
});

test("invalid or missing socket addresses share a bounded fallback identity", () => {
  assert.equal(requestIdentity(undefined, "203.0.113.9"), requestIdentity("invalid", "198.51.100.4"));
});
