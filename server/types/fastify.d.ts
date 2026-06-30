import "fastify";
import type { RequestUser } from "../auth.js";

declare module "fastify" {
  interface FastifyRequest {
    userEmail: string;
    user?: RequestUser;
  }
}
