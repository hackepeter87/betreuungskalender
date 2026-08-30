import type { FastifyInstance, FastifyPluginAsync, RouteOptions } from "fastify";
import { workspacePermissionValues } from "./auth.js";
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
import { dataTransferRoutes } from "./routes/dataTransfer.js";
import { demoDataRoutes } from "./routes/demoData.js";
import { externalCalendarRoutes } from "./routes/externalCalendars.js";
import { holidayRoutes } from "./routes/holidays.js";
import { instanceReadinessRoutes } from "./routes/instanceReadiness.js";
import { invitationRoutes } from "./routes/invitations.js";
import { migrationRoutes } from "./routes/migration.js";
import { monthClosingRoutes } from "./routes/monthClosings.js";
import { reportRoutes } from "./routes/reports.js";
import { settingsRoutes } from "./routes/settings.js";
import { unavailablePeriodRoutes } from "./routes/unavailablePeriods.js";

export interface ProtectedApplicationRoutePlugin {
  readonly name: string;
  readonly plugin: FastifyPluginAsync;
}

export const protectedApplicationRoutePlugins: readonly ProtectedApplicationRoutePlugin[] = Object.freeze([
  { name: "childrenRoutes", plugin: childrenRoutes },
  { name: "carePartyRoutes", plugin: carePartyRoutes },
  { name: "careEntryRoutes", plugin: careEntryRoutes },
  { name: "careConfirmationRoutes", plugin: careConfirmationRoutes },
  { name: "holidayRoutes", plugin: holidayRoutes },
  { name: "contactPatternRoutes", plugin: contactPatternRoutes },
  { name: "contactRuleRoutes", plugin: contactRuleRoutes },
  { name: "settingsRoutes", plugin: settingsRoutes },
  { name: "instanceReadinessRoutes", plugin: instanceReadinessRoutes },
  { name: "invitationRoutes", plugin: invitationRoutes },
  { name: "unavailablePeriodRoutes", plugin: unavailablePeriodRoutes },
  { name: "externalCalendarRoutes", plugin: externalCalendarRoutes },
  { name: "calendarFeedRoutes", plugin: calendarFeedRoutes },
  { name: "monthClosingRoutes", plugin: monthClosingRoutes },
  { name: "migrationRoutes", plugin: migrationRoutes },
  { name: "auditRoutes", plugin: auditRoutes },
  { name: "appUserRoutes", plugin: appUserRoutes },
  { name: "appDataRoutes", plugin: appDataRoutes },
  { name: "dataTransferRoutes", plugin: dataTransferRoutes },
  { name: "reportRoutes", plugin: reportRoutes },
  { name: "demoDataRoutes", plugin: demoDataRoutes }
]);

export const preAuthenticationApiRouteKeys: readonly string[] = Object.freeze([
  "GET /api/health",
  "GET /api/ready",
  "GET /api/session",
  "POST /api/setup/first-use"
]);

const preAuthenticationApiRoutes = new Set(preAuthenticationApiRouteKeys);

export function assertApplicationApiRouteAuthorization(route: RouteOptions): void {
  if (!route.url.startsWith("/api/")) return;
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  for (const method of methods) {
    if (method === "HEAD" || method === "OPTIONS") continue;
    const routeKey = `${method} ${route.url}`;
    const permission = route.config?.permission;
    if (permission && workspacePermissionValues.includes(permission)) continue;
    if (preAuthenticationApiRoutes.has(routeKey)) continue;
    throw new Error(`API route authorization metadata is missing for ${routeKey}.`);
  }
}

export async function registerProtectedApplicationRoutes(app: FastifyInstance): Promise<void> {
  for (const { plugin } of protectedApplicationRoutePlugins) await app.register(plugin);
}
