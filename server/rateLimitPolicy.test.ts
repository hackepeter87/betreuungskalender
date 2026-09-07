import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance, RouteOptions } from "fastify";
import { installRateLimitPolicy } from "./rateLimitPolicy.js";

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
