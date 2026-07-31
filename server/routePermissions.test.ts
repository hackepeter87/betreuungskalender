import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { WorkspacePermission } from "./auth.js";
import { appDataRoutes } from "./routes/appData.js";
import { appUserRoutes } from "./routes/appUsers.js";
import { auditRoutes } from "./routes/audit.js";
import { calendarFeedRoutes } from "./routes/calendarFeeds.js";
import { careConfirmationRoutes } from "./routes/careConfirmations.js";
import { careEntryRoutes } from "./routes/careEntries.js";
import { carePartyRoutes } from "./routes/careParties.js";
import { childrenRoutes } from "./routes/children.js";
import { contactPatternRoutes } from "./routes/contactPatterns.js";
import { contactRuleRoutes } from "./routes/contactRules.js";
import { demoDataRoutes } from "./routes/demoData.js";
import { externalCalendarRoutes } from "./routes/externalCalendars.js";
import { holidayRoutes } from "./routes/holidays.js";
import { instanceReadinessRoutes } from "./routes/instanceReadiness.js";
import { invitationRoutes } from "./routes/invitations.js";
import { migrationRoutes } from "./routes/migration.js";
import { monthClosingRoutes } from "./routes/monthClosings.js";
import { settingsRoutes } from "./routes/settings.js";
import { unavailablePeriodRoutes } from "./routes/unavailablePeriods.js";

const knownPermissions = new Set<WorkspacePermission>([
  "appointments:view",
  "appointments:create",
  "appointments:edit",
  "appointments:delete",
  "appointments:confirm",
  "children:view-basic",
  "children:view-sensitive",
  "children:manage",
  "notes:view",
  "planning:view",
  "planning:manage",
  "reports:view",
  "settings:view",
  "settings:manage",
  "notifications:manage-own",
  "feeds:manage-own",
  "audit:view",
  "instance:inspect",
  "members:manage",
  "exports:run",
  "admin:destructive"
]);

test("every protected API route declares a known workspace permission", async () => {
  const app = Fastify({ logger: false });
  const routes: Array<{ method: string; url: string; permission?: WorkspacePermission }> = [];
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === "HEAD") continue;
      routes.push({
        method,
        url: route.url,
        permission: route.config?.permission
      });
    }
  });

  for (const plugin of [
    childrenRoutes,
    carePartyRoutes,
    careEntryRoutes,
    careConfirmationRoutes,
    holidayRoutes,
    contactPatternRoutes,
    contactRuleRoutes,
    settingsRoutes,
    instanceReadinessRoutes,
    invitationRoutes,
    unavailablePeriodRoutes,
    externalCalendarRoutes,
    calendarFeedRoutes,
    monthClosingRoutes,
    migrationRoutes,
    auditRoutes,
    appUserRoutes,
    appDataRoutes,
    demoDataRoutes
  ]) {
    await app.register(plugin);
  }
  await app.ready();
  await app.close();

  const protectedRoutes = routes.filter((route) => route.url.startsWith("/api/"));
  assert(protectedRoutes.length > 50);
  assert.deepEqual(
    protectedRoutes.filter((route) => !route.permission),
    []
  );
  assert.deepEqual(
    protectedRoutes.filter(
      (route) => route.permission && !knownPermissions.has(route.permission)
    ),
    []
  );
});
