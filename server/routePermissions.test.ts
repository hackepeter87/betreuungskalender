import assert from "node:assert/strict";
import test from "node:test";
import Fastify, { type FastifyPluginAsync, type RouteOptions } from "fastify";
import { workspacePermissionValues, type WorkspacePermission } from "./auth.js";
import {
  assertApplicationApiRouteAuthorization,
  preAuthenticationApiRouteKeys,
  protectedApplicationRoutePlugins,
  type ProtectedApplicationRoutePlugin
} from "./applicationRoutes.js";

async function collectApiRoutes(plugins: readonly ProtectedApplicationRoutePlugin[]) {
  const app = Fastify({ logger: false });
  const routes: Array<{ method: string; url: string; permission?: WorkspacePermission }> = [];
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === "HEAD" || !route.url.startsWith("/api/")) continue;
      routes.push({ method, url: route.url, permission: route.config?.permission });
    }
  });
  for (const { plugin } of plugins) await app.register(plugin);
  await app.ready();
  await app.close();
  return routes;
}

test("every protected API route declares a known workspace permission", async () => {
  const pluginNames = protectedApplicationRoutePlugins.map(({ name }) => name);
  assert(pluginNames.includes("dataTransferRoutes"));
  assert(pluginNames.includes("reportRoutes"));

  const routes = await collectApiRoutes(protectedApplicationRoutePlugins);
  assert(routes.length > 75);
  assert.deepEqual(routes.filter((route) => !route.permission), []);
  assert.deepEqual(
    routes.filter(
      (route) => route.permission && !workspacePermissionValues.includes(route.permission)
    ),
    []
  );
});

test("new protected route plugins without permission metadata fail completeness", async () => {
  const missingPermissionPlugin: FastifyPluginAsync = async (app) => {
    app.get("/api/missing-permission", async () => ({ ok: true }));
  };
  const routes = await collectApiRoutes([
    ...protectedApplicationRoutePlugins,
    { name: "missingPermissionPlugin", plugin: missingPermissionPlugin }
  ]);
  assert.deepEqual(
    routes.filter((route) => !route.permission).map(({ method, url }) => `${method} ${url}`),
    ["GET /api/missing-permission"]
  );
});

test("pre-authentication API exceptions stay explicit and bounded", () => {
  assert.deepEqual([...preAuthenticationApiRouteKeys].sort(), [
    "GET /api/health",
    "GET /api/ready",
    "GET /api/session",
    "POST /api/setup/first-use"
  ]);
});

test("production route guard rejects unclassified API routes", () => {
  assert.doesNotThrow(() => assertApplicationApiRouteAuthorization({
    method: "GET",
    url: "/api/health",
    config: {}
  } as RouteOptions));
  assert.doesNotThrow(() => assertApplicationApiRouteAuthorization({
    method: "GET",
    url: "/api/children",
    config: { permission: "children:view-sensitive" }
  } as RouteOptions));
  assert.throws(
    () => assertApplicationApiRouteAuthorization({
      method: "GET",
      url: "/api/unclassified",
      config: {}
    } as RouteOptions),
    /authorization metadata is missing/
  );
});
