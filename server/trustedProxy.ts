import { BlockList, isIP } from "node:net";

export interface TrustedProxyRule {
  source: string;
  address: string;
  prefix?: number;
  family: "ipv4" | "ipv6";
}

export function csvListEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRemoteAddress(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.startsWith("::ffff:")) return normalized.slice("::ffff:".length);
  return normalized;
}

function addressFamily(address: string): "ipv4" | "ipv6" | undefined {
  const family = isIP(address);
  if (family === 4) return "ipv4";
  if (family === 6) return "ipv6";
  return undefined;
}

export function parseTrustedProxyRule(source: string): TrustedProxyRule {
  const [rawAddress, rawPrefix] = source.split("/");
  const address = normalizeRemoteAddress(rawAddress);
  const family = address ? addressFamily(address) : undefined;
  if (!address || !family) {
    throw new Error(`Invalid trusted proxy address or CIDR: ${source}`);
  }
  if (rawPrefix === undefined) {
    return { source, address, family };
  }
  const prefix = Number(rawPrefix);
  const maxPrefix = family === "ipv4" ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
    throw new Error(`Invalid trusted proxy CIDR prefix: ${source}`);
  }
  return { source, address, prefix, family };
}

export function parseTrustedProxyRules(sources: string[]): TrustedProxyRule[] {
  return sources.map(parseTrustedProxyRule);
}

export function isTrustedProxyAddress(
  remoteAddress: string | undefined,
  rules: readonly TrustedProxyRule[]
): boolean {
  if (rules.length === 0) return true;
  const address = normalizeRemoteAddress(remoteAddress);
  const family = address ? addressFamily(address) : undefined;
  if (!address || !family) return false;
  const allowList = new BlockList();
  for (const rule of rules) {
    if (rule.prefix === undefined) {
      allowList.addAddress(rule.address, rule.family);
    } else {
      allowList.addSubnet(rule.address, rule.prefix, rule.family);
    }
  }
  return allowList.check(address, family);
}
