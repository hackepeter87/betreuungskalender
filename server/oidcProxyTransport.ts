import type * as oidc from "openid-client";
import { fetch as undiciFetch, ProxyAgent } from "undici";

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export class OidcProxyTransportError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

type ProxyFetch = (
  url: string,
  options: oidc.CustomFetchOptions
) => Promise<Response>;

export interface PinnedOidcTransport {
  fetch: oidc.CustomFetch;
  close(): Promise<void>;
}

export interface PinnedOidcFetchOptions {
  issuerUrl: string;
  proxyUrl: string;
  maxRedirects?: number;
  fetchViaProxy?: ProxyFetch;
}

function effectivePort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === "https:" ? "443" : "80";
}

function sameAuthority(candidate: URL, issuer: URL): boolean {
  return candidate.protocol === "https:"
    && candidate.hostname === issuer.hostname
    && effectivePort(candidate) === effectivePort(issuer)
    && !candidate.username
    && !candidate.password;
}

function redirectOptions(
  status: number,
  options: oidc.CustomFetchOptions
): oidc.CustomFetchOptions {
  const method = options.method.toUpperCase();
  if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
    const headers = { ...options.headers };
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === "content-type" || name.toLowerCase() === "content-length") {
        delete headers[name];
      }
    }
    return {
      ...options,
      method: "GET",
      body: undefined,
      headers
    };
  }
  return options;
}

export function createPinnedOidcFetch(
  options: PinnedOidcFetchOptions
): PinnedOidcTransport {
  const issuer = new URL(options.issuerUrl);
  const maxRedirects = options.maxRedirects ?? 3;
  const agent = options.fetchViaProxy ? undefined : new ProxyAgent(options.proxyUrl);
  const fetchViaProxy: ProxyFetch = options.fetchViaProxy ?? (async (url, init) => {
    const { body, ...rest } = init;
    const request = {
      ...rest,
      ...(body === undefined ? {} : { body }),
      dispatcher: agent!
    } as unknown as Parameters<typeof undiciFetch>[1];
    const response = await undiciFetch(url, request);
    return response as unknown as Response;
  });

  const pinnedFetch: oidc.CustomFetch = async (input, initialOptions) => {
    let current = new URL(input);
    let requestOptions = initialOptions;
    for (let redirects = 0; ; redirects += 1) {
      if (!sameAuthority(current, issuer)) {
        throw new OidcProxyTransportError("oidc_proxy_target_rejected");
      }
      const response = await fetchViaProxy(current.href, {
        ...requestOptions,
        redirect: "manual"
      });
      if (!redirectStatuses.has(response.status)) return response;
      if (redirects >= maxRedirects) {
        await response.body?.cancel();
        throw new OidcProxyTransportError("oidc_proxy_redirect_limit");
      }
      const location = response.headers.get("location");
      if (!location) return response;
      const redirected = new URL(location, current);
      if (!sameAuthority(redirected, issuer)) {
        await response.body?.cancel();
        throw new OidcProxyTransportError("oidc_proxy_redirect_rejected");
      }
      await response.body?.cancel();
      requestOptions = redirectOptions(response.status, requestOptions);
      current = redirected;
    }
  };

  return {
    fetch: pinnedFetch,
    close: async () => {
      if (agent) await agent.close();
    }
  };
}
