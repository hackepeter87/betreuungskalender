import * as oidc from "openid-client";
import type { AuthenticatedClaims } from "./auth.js";
import { OidcLoginStateStore } from "./services/oidcLoginStates.js";

export interface NativeOidcConfig {
  issuerUrl?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes: string;
  groupsClaim: string;
  loginStateTtlSeconds: number;
}

export type NativeOidcClaims = AuthenticatedClaims;

interface TokenResponseWithClaims {
  claims(): Record<string, unknown> | undefined;
}

export interface OidcLibrary {
  discovery(
    issuer: URL,
    clientId: string,
    clientSecret?: string
  ): Promise<oidc.Configuration>;
  randomState(): string;
  randomNonce(): string;
  randomPKCECodeVerifier(): string;
  calculatePKCECodeChallenge(verifier: string): Promise<string>;
  buildAuthorizationUrl(
    configuration: oidc.Configuration,
    parameters: Record<string, string>
  ): URL;
  authorizationCodeGrant(
    configuration: oidc.Configuration,
    currentUrl: URL,
    checks: {
      pkceCodeVerifier: string;
      expectedState: string;
      expectedNonce: string;
    }
  ): Promise<TokenResponseWithClaims>;
}

const openidClientLibrary: OidcLibrary = {
  discovery: (issuer, clientId, clientSecret) =>
    oidc.discovery(issuer, clientId, clientSecret),
  randomState: oidc.randomState,
  randomNonce: oidc.randomNonce,
  randomPKCECodeVerifier: oidc.randomPKCECodeVerifier,
  calculatePKCECodeChallenge: oidc.calculatePKCECodeChallenge,
  buildAuthorizationUrl: oidc.buildAuthorizationUrl,
  authorizationCodeGrant: oidc.authorizationCodeGrant
};

function stringClaim(claims: Record<string, unknown>, name: string): string | undefined {
  const value = claims[name];
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function groupsClaim(claims: Record<string, unknown>, name: string): string[] {
  const value = claims[name];
  const values = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      values.flatMap((item) => {
        if (typeof item !== "string") return [];
        return item
          .split(/[,\n;]/)
          .map((group) => group.trim())
          .filter(Boolean);
      })
    )
  );
}

export class NativeOidcError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export interface NativeOidcServiceOptions {
  config: NativeOidcConfig;
  loginStates?: OidcLoginStateStore;
  library?: OidcLibrary;
}

export class NativeOidcService {
  readonly #config: NativeOidcConfig;
  readonly #loginStates: OidcLoginStateStore;
  readonly #library: OidcLibrary;
  #discovered?: Promise<oidc.Configuration>;

  constructor(options: NativeOidcServiceOptions) {
    this.#config = options.config;
    this.#loginStates = options.loginStates ?? new OidcLoginStateStore();
    this.#library = options.library ?? openidClientLibrary;
  }

  async createLoginRedirect(): Promise<URL> {
    const configuration = await this.#configuration();
    const codeVerifier = this.#library.randomPKCECodeVerifier();
    const codeChallenge = await this.#library.calculatePKCECodeChallenge(codeVerifier);
    const state = this.#library.randomState();
    const nonce = this.#library.randomNonce();
    const redirectUri = this.#required("redirectUri", this.#config.redirectUri);

    this.#loginStates.create(
      {
        state,
        nonce,
        pkceVerifier: codeVerifier,
        redirectUri
      },
      this.#config.loginStateTtlSeconds
    );

    return this.#library.buildAuthorizationUrl(configuration, {
      redirect_uri: redirectUri,
      scope: this.#config.scopes,
      response_type: "code",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce
    });
  }

  async validateCallback(requestUrl: string): Promise<NativeOidcClaims> {
    const callbackUrl = this.#callbackUrl(requestUrl);
    const state = callbackUrl.searchParams.get("state")?.trim();
    if (!state) {
      throw new NativeOidcError(
        "native_oidc_missing_state",
        400,
        "OIDC callback state is missing."
      );
    }

    const loginState = this.#loginStates.consume(state);
    if (!loginState) {
      throw new NativeOidcError(
        "native_oidc_invalid_state",
        400,
        "OIDC callback state is invalid or expired."
      );
    }

    if (callbackUrl.searchParams.has("error")) {
      throw new NativeOidcError(
        "native_oidc_provider_error",
        400,
        "OIDC provider returned an authentication error."
      );
    }

    const configuration = await this.#configuration();
    let tokenResponse: TokenResponseWithClaims;
    try {
      tokenResponse = await this.#library.authorizationCodeGrant(configuration, callbackUrl, {
        pkceCodeVerifier: loginState.pkceVerifier,
        expectedState: loginState.state,
        expectedNonce: loginState.nonce
      });
    } catch {
      throw new NativeOidcError(
        "native_oidc_callback_rejected",
        400,
        "OIDC callback validation failed."
      );
    }

    const claims = tokenResponse.claims() ?? {};
    const subject = claims.sub;
    if (typeof subject !== "string" || !subject.trim()) {
      throw new NativeOidcError(
        "native_oidc_missing_subject",
        400,
        "OIDC ID token subject is missing."
      );
    }

    const email = stringClaim(claims, "email");
    const displayName = stringClaim(claims, "preferred_username") ?? stringClaim(claims, "name");

    return {
      subject: subject.trim(),
      groups: groupsClaim(claims, this.#config.groupsClaim),
      ...(email ? { email } : {}),
      ...(displayName ? { displayName } : {})
    };
  }

  async #configuration(): Promise<oidc.Configuration> {
    this.#discovered ??= this.#library.discovery(
      new URL(this.#required("issuerUrl", this.#config.issuerUrl)),
      this.#required("clientId", this.#config.clientId),
      this.#config.clientSecret
    );
    return this.#discovered;
  }

  #callbackUrl(requestUrl: string): URL {
    const redirectUri = this.#required("redirectUri", this.#config.redirectUri);
    const request = new URL(requestUrl, redirectUri);
    const callback = new URL(redirectUri);
    callback.search = request.search;
    return callback;
  }

  #required(name: keyof NativeOidcConfig, value: string | undefined): string {
    const normalized = value?.trim();
    if (!normalized) {
      throw new NativeOidcError(
        "native_oidc_config_missing",
        500,
        `Native OIDC configuration value ${name} is missing.`
      );
    }
    return normalized;
  }
}
