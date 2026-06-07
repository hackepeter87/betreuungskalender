import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    userEmail: string;
  }
}
