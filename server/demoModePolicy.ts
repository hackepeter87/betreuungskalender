import type { preHandlerAsyncHookHandler } from "fastify";

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
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) return false;
  return path === "/api/children" ||
    path.startsWith("/api/children/") ||
    path === "/api/care-parties" ||
    path.startsWith("/api/care-parties/");
}

function isOwnerBootstrap(method: string, path: string): boolean {
  return (method === "POST" && path === "/api/setup/first-use") ||
    (method === "GET" && (path === "/setup" || path === "/setup/continue"));
}

export function createDemoModeBoundaryHook(
  enabled: boolean
): preHandlerAsyncHookHandler {
  return async (request) => {
    if (!enabled) return;
    const method = request.method.toUpperCase();
    const path = routePath(request);
    if (!isMasterDataMutation(method, path) && !isOwnerBootstrap(method, path)) return;
    throw Object.assign(new Error("Diese Aktion ist im Demo-Modus nicht verfügbar."), {
      code: "forbidden",
      statusCode: 403
    });
  };
}
