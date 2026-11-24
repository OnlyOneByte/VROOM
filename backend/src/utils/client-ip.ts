// X-Forwarded-For is client-controlled: honor it only from trusted proxy sockets, or a limiter keyed on it is bypassable.

import { BlockList, isIP } from 'node:net';
import type { Context } from 'hono';
import { getConnInfo } from 'hono/bun';
import { CONFIG } from '../config';

function getSocketIp(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

function familyOf(address: string): 'ipv4' | 'ipv6' {
  return isIP(address) === 6 ? 'ipv6' : 'ipv4';
}

export function parseTrustedProxies(entries: readonly string[]): BlockList {
  const list = new BlockList();
  for (const entry of entries) {
    const [address = '', prefix] = entry.split('/');
    const family = isIP(address);
    const bits = prefix === undefined ? undefined : Number(prefix);
    const width = family === 6 ? 128 : 32;
    if (
      family === 0 ||
      (bits !== undefined && (!/^\d+$/.test(prefix ?? '') || bits < 0 || bits > width))
    ) {
      throw new Error(`TRUSTED_PROXY_IPS entry "${entry}" must be an IP address or CIDR range`);
    }
    if (bits === undefined) list.addAddress(address, familyOf(address));
    else list.addSubnet(address, bits, familyOf(address));
  }
  return list;
}

let cachedTrusted: { key: string; list: BlockList } | null = null;

function trustedProxies(entries: readonly string[]): BlockList {
  const key = entries.join(',');
  if (cachedTrusted?.key !== key) cachedTrusted = { key, list: parseTrustedProxies(entries) };
  return cachedTrusted.list;
}

export function validateTrustedProxies(): void {
  trustedProxies(CONFIG.rateLimit.trustedProxyIps);
}

function isTrusted(list: BlockList, address: string): boolean {
  return isIP(address) !== 0 && list.check(address, familyOf(address));
}

function nearestUntrustedHop(xff: string, list: BlockList, socketIp: string): string {
  const hops = xff
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  let client = socketIp;
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i] ?? '';
    if (isIP(hop) === 0) return client;
    client = hop;
    if (!isTrusted(list, hop)) return hop;
  }
  return client;
}

export function getClientIp(
  c: Context,
  trustedProxyIps: readonly string[] = CONFIG.rateLimit.trustedProxyIps,
  clientIpHeader: string | undefined = CONFIG.rateLimit.trustedClientIpHeader
): string {
  const socketIp = getSocketIp(c);
  if (!socketIp) return 'unknown';
  const list = trustedProxies(trustedProxyIps);
  if (!isTrusted(list, socketIp)) return socketIp;

  if (clientIpHeader) {
    const named = c.req.header(clientIpHeader)?.trim();
    if (named && isIP(named) !== 0) return named;
  }
  const xff = c.req.header('x-forwarded-for');
  return xff ? nearestUntrustedHop(xff, list, socketIp) : socketIp;
}
