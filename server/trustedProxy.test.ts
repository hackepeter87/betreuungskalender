import assert from "node:assert/strict";
import test from "node:test";
import { isTrustedProxyAddress, parseTrustedProxyRules } from "./trustedProxy.js";

test("an empty trusted proxy allowlist rejects every source", () => {
  assert.equal(isTrustedProxyAddress("127.0.0.1", []), false);
  assert.equal(isTrustedProxyAddress("::1", []), false);
  assert.equal(isTrustedProxyAddress(undefined, []), false);
});

test("trusted proxy allowlists support bounded IPv4 and IPv6 sources", () => {
  const rules = parseTrustedProxyRules(["10.20.0.0/16", "2001:db8:42::/48"]);

  assert.equal(isTrustedProxyAddress("10.20.4.5", rules), true);
  assert.equal(isTrustedProxyAddress("10.21.4.5", rules), false);
  assert.equal(isTrustedProxyAddress("2001:db8:42::7", rules), true);
  assert.equal(isTrustedProxyAddress("2001:db8:43::7", rules), false);
});
