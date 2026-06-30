import type { FastifyInstance, FastifyReply } from "fastify";
import type { config as appConfig } from "../config.js";
import { NativeOidcError, NativeOidcService } from "../nativeOidc.js";

type NativeOidcRouteConfig = Pick<
  typeof appConfig,
  | "authMode"
  | "oidcIssuerUrl"
  | "oidcClientId"
  | "oidcClientSecret"
  | "oidcRedirectUri"
  | "oidcScopes"
  | "oidcLoginStateTtlSeconds"
  | "rateLimitSensitiveMax"
  | "rateLimitWindowMs"
>;

interface NativeOidcRoutesOptions {
  config: NativeOidcRouteConfig;
  service?: Pick<NativeOidcService, "createLoginRedirect" | "validateCallback">;
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: "not_found",
    message: "Ressource nicht gefunden."
  });
}

function sanitizedError(error: unknown): NativeOidcError {
  if (error instanceof NativeOidcError) return error;
  return new NativeOidcError(
    "native_oidc_request_failed",
    500,
    "Native OIDC request failed."
  );
}

export async function nativeOidcRoutes(
  app: FastifyInstance,
  options: NativeOidcRoutesOptions
): Promise<void> {
  const authRateLimit = {
    config: {
      rateLimit: {
        max: options.config.rateLimitSensitiveMax,
        timeWindow: options.config.rateLimitWindowMs
      }
    }
  };
  const service = options.service ?? new NativeOidcService({
    config: {
      issuerUrl: options.config.oidcIssuerUrl,
      clientId: options.config.oidcClientId,
      clientSecret: options.config.oidcClientSecret,
      redirectUri: options.config.oidcRedirectUri,
      scopes: options.config.oidcScopes,
      loginStateTtlSeconds: options.config.oidcLoginStateTtlSeconds
    }
  });

  app.get("/auth/login", authRateLimit, async (_request, reply) => {
    if (options.config.authMode !== "native-oidc") return notFound(reply);
    try {
      const redirectUrl = await service.createLoginRedirect();
      return reply.redirect(redirectUrl.href);
    } catch (error) {
      const normalized = sanitizedError(error);
      return reply.code(normalized.statusCode).send({
        error: normalized.code,
        message: normalized.message
      });
    }
  });

  app.get("/auth/callback", authRateLimit, async (request, reply) => {
    if (options.config.authMode !== "native-oidc") return notFound(reply);
    try {
      await service.validateCallback(request.url);
      return reply.code(200).send({
        authenticated: false,
        loginValidated: true,
        sessionCreated: false
      });
    } catch (error) {
      const normalized = sanitizedError(error);
      request.log.warn(
        { code: normalized.code, statusCode: normalized.statusCode, requestId: request.id },
        "native oidc callback rejected"
      );
      return reply.code(normalized.statusCode).send({
        error: normalized.code,
        message: normalized.message
      });
    }
  });
}
