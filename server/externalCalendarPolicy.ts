import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { isUnknownRecord } from "../shared/objects.js";

export interface ExternalCalendarPrivateTarget {
  readonly hostname: string;
  readonly addresses: readonly string[];
}

const invalidPolicy = () => new Error(
  "EXTERNAL_CALENDAR_PRIVATE_TARGETS must be a JSON array of unique exact DNS hostnames and exact private IP addresses."
);

/** IPv4 RFC1918 and IPv6 ULA only; never accept mapped, scoped or ranged addresses. */
function privateAddress(value: unknown): string | undefined {
  if (typeof value !== "string" || !isIP(value) || value.includes("%")) return undefined;
  const address = ipaddr.parse(value);
  if (address.range() !== "private" && address.range() !== "uniqueLocal") return undefined;
  return address.toString();
}

export function parseExternalCalendarPrivateTargets(
  value: string | undefined
): readonly ExternalCalendarPrivateTarget[] {
  if (value === undefined) return Object.freeze([]);
  let rules: unknown;
  try { rules = JSON.parse(value); } catch { throw invalidPolicy(); }
  if (!Array.isArray(rules) || rules.length > 32) throw invalidPolicy();
  const hosts = new Set<string>();
  const parsed = rules.map((rule: unknown) => {
    if (!isUnknownRecord(rule) || Object.keys(rule).length !== 2 ||
      typeof rule.hostname !== "string" || !Array.isArray(rule.addresses)) throw invalidPolicy();
    const hostname = rule.hostname.toLowerCase();
    if (hostname.length > 253 || !hostname.includes(".") || isIP(hostname) ||
      !hostname.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      hostname.endsWith(".localhost") || hostname.endsWith(".local") || hosts.has(hostname)) throw invalidPolicy();
    // WHATWG URL parsing must not reinterpret legacy numeric IPs or change the host.
    try {
      if (new URL(`https://${hostname}`).hostname !== hostname) throw invalidPolicy();
    } catch { throw invalidPolicy(); }
    hosts.add(hostname);
    if (!rule.addresses.length || rule.addresses.length > 16) throw invalidPolicy();
    const addresses = rule.addresses.map((address: unknown) => {
      const normalized = privateAddress(address);
      if (!normalized) throw invalidPolicy();
      return normalized;
    });
    if (new Set(addresses).size !== addresses.length) throw invalidPolicy();
    return Object.freeze({ hostname, addresses: Object.freeze(addresses) });
  });
  return Object.freeze(parsed);
}
