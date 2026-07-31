import "fastify";
import type { RequestUser, WorkspacePermission } from "../auth.js";

declare module "fastify" {
  interface FastifyRequest {
    userEmail: string;
    user?: RequestUser;
  }

  interface FastifyContextConfig {
    permission?: WorkspacePermission;
  }
}
