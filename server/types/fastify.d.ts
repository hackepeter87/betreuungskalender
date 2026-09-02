import "fastify";
import type { RequestUser, WorkspacePermission } from "../auth.js";
import type { PersistenceRuntime } from "../db/runtime.js";

declare module "fastify" {
  interface FastifyInstance {
    persistence: PersistenceRuntime;
  }

  interface FastifyRequest {
    userEmail: string;
    user?: RequestUser;
  }

  interface FastifyContextConfig {
    permission?: WorkspacePermission;
  }
}
