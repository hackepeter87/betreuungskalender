export const preAuthenticationApiRouteKeys: readonly string[] = Object.freeze([
  "GET /api/health",
  "GET /api/ready",
  "GET /api/session",
  "POST /api/setup/first-use"
]);

const preAuthenticationApiRoutes = new Set(preAuthenticationApiRouteKeys);

export function isPreAuthenticationApiRoute(method: string, url: string): boolean {
  return preAuthenticationApiRoutes.has(`${method.toUpperCase()} ${url}`);
}
