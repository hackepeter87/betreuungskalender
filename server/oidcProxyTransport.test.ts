import assert from "node:assert/strict";
import test from "node:test";
import {
  createPinnedOidcFetch,
  OidcProxyTransportError
} from "./oidcProxyTransport.js";

type FetchCall = { url: string; redirect: RequestRedirect | undefined };

const requestOptions = {
  method: "GET",
  headers: {},
  body: undefined,
  redirect: "manual" as const
};

function response(status: number, location?: string): Response {
  return new Response(null, {
    status,
    ...(location ? { headers: { location } } : {})
  });
}

test("pinned OIDC fetch allows only the configured HTTPS authority", async () => {
  const calls: FetchCall[] = [];
  const transport = createPinnedOidcFetch({
    issuerUrl: "https://idp.example.test/realms/demo",
    proxyUrl: "http://oidc-proxy.internal:3128",
    fetchViaProxy: async (input, init) => {
      calls.push({ url: String(input), redirect: init?.redirect });
      return response(200);
    }
  });

  await transport.fetch(
    "https://idp.example.test/realms/demo/.well-known/openid-configuration",
    requestOptions
  );
  assert.deepEqual(calls, [{
    url: "https://idp.example.test/realms/demo/.well-known/openid-configuration",
    redirect: "manual"
  }]);

  await assert.rejects(
    () => transport.fetch(
      "https://other.example.test/.well-known/openid-configuration",
      requestOptions
    ),
    (error: unknown) => error instanceof OidcProxyTransportError
      && error.code === "oidc_proxy_target_rejected"
  );
  assert.equal(calls.length, 1);
  await transport.close();
});

test("pinned OIDC fetch follows bounded same-authority redirects", async () => {
  const calls: string[] = [];
  const transport = createPinnedOidcFetch({
    issuerUrl: "https://idp.example.test/realms/demo",
    proxyUrl: "http://oidc-proxy.internal:3128",
    fetchViaProxy: async (input) => {
      const url = String(input);
      calls.push(url);
      return calls.length === 1
        ? response(302, "/realms/demo/discovery")
        : response(200);
    }
  });

  assert.equal((await transport.fetch(
    "https://idp.example.test/realms/demo/.well-known/openid-configuration",
    requestOptions
  )).status, 200);
  assert.deepEqual(calls, [
    "https://idp.example.test/realms/demo/.well-known/openid-configuration",
    "https://idp.example.test/realms/demo/discovery"
  ]);
  await transport.close();
});

test("pinned OIDC fetch rejects cross-authority redirects before following", async () => {
  let calls = 0;
  const transport = createPinnedOidcFetch({
    issuerUrl: "https://idp.example.test/realms/demo",
    proxyUrl: "http://oidc-proxy.internal:3128",
    fetchViaProxy: async () => {
      calls += 1;
      return response(302, "https://other.example.test/discovery");
    }
  });

  await assert.rejects(
    () => transport.fetch(
      "https://idp.example.test/realms/demo/.well-known/openid-configuration",
      requestOptions
    ),
    (error: unknown) => error instanceof OidcProxyTransportError
      && error.code === "oidc_proxy_redirect_rejected"
  );
  assert.equal(calls, 1);
  await transport.close();
});

test("pinned OIDC fetch rejects redirect loops", async () => {
  let calls = 0;
  const transport = createPinnedOidcFetch({
    issuerUrl: "https://idp.example.test/realms/demo",
    proxyUrl: "http://oidc-proxy.internal:3128",
    maxRedirects: 2,
    fetchViaProxy: async () => {
      calls += 1;
      return response(302, `/loop/${calls}`);
    }
  });

  await assert.rejects(
    () => transport.fetch("https://idp.example.test/start", requestOptions),
    (error: unknown) => error instanceof OidcProxyTransportError
      && error.code === "oidc_proxy_redirect_limit"
  );
  assert.equal(calls, 3);
  await transport.close();
});
