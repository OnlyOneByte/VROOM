import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { and, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { DEMO_USER_ID } from '../api/auth/demo-account';
import { CONFIG } from '../config';
import { getDb } from '../db/connection';
import { users } from '../db/schema';
import { ValidationError } from '../errors';
import { resolverFor } from '../permissions/grants';

type AddressClass = 'public' | 'private' | 'forbidden';

interface Ipv4Range {
  base: number;
  bits: number;
  kind: Exclude<AddressClass, 'public'>;
}

function ipv4ToInt(address: string): number {
  return address.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

function cidr(base: string, bits: number, kind: Ipv4Range['kind']): Ipv4Range {
  return { base: ipv4ToInt(base), bits, kind };
}

const IPV4_RANGES: readonly Ipv4Range[] = [
  cidr('0.0.0.0', 8, 'forbidden'),
  cidr('169.254.0.0', 16, 'forbidden'),
  cidr('100.100.100.200', 32, 'forbidden'),
  cidr('192.0.0.0', 24, 'forbidden'),
  cidr('168.63.129.16', 32, 'forbidden'),
  cidr('224.0.0.0', 4, 'forbidden'),
  cidr('240.0.0.0', 4, 'forbidden'),
  cidr('10.0.0.0', 8, 'private'),
  cidr('100.64.0.0', 10, 'private'),
  cidr('127.0.0.0', 8, 'private'),
  cidr('172.16.0.0', 12, 'private'),
  cidr('192.168.0.0', 16, 'private'),
  cidr('198.18.0.0', 15, 'private'),
];

function classifyIpv4(address: string): AddressClass {
  const value = ipv4ToInt(address);
  for (const range of IPV4_RANGES) {
    const size = 2 ** (32 - range.bits);
    if (Math.floor(value / size) === Math.floor(range.base / size)) return range.kind;
  }
  return 'public';
}

function expandIpv6(address: string): number[] {
  let text = address.toLowerCase();
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted?.[1]) {
    const v4 = ipv4ToInt(dotted[1]);
    text = `${text.slice(0, -dotted[1].length)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const [head = '', tail] = text.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const fill =
    tail === undefined ? [] : new Array(8 - headParts.length - tailParts.length).fill('0');
  return [...headParts, ...fill, ...tailParts].map((h) => Number.parseInt(h, 16));
}

function ipv4FromGroups(hi = 0, lo = 0): string {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
}

function startsWith(g: number[], prefix: readonly number[]): boolean {
  return prefix.every((value, i) => g[i] === value);
}

function embeddedIpv4(g: number[]): string | null {
  const tail = ipv4FromGroups(g[6], g[7]);
  if (startsWith(g, [0, 0, 0, 0, 0, 0xffff])) return tail;
  if (startsWith(g, [0, 0, 0, 0, 0xffff, 0])) return tail;
  if (startsWith(g, [0, 0, 0, 0, 0, 0])) return tail;
  if (startsWith(g, [0x64, 0xff9b, 0, 0, 0, 0])) return tail;
  if (g[0] === 0x2002) return ipv4FromGroups(g[1], g[2]);
  return null;
}

const IPV6_PREFIXES: readonly {
  mask: number;
  value: number;
  kind: Exclude<AddressClass, 'public'>;
}[] = [
  { mask: 0xffc0, value: 0xfe80, kind: 'forbidden' },
  { mask: 0xff00, value: 0xff00, kind: 'forbidden' },
  { mask: 0xffc0, value: 0xfec0, kind: 'private' },
  { mask: 0xfe00, value: 0xfc00, kind: 'private' },
];

function classifyIpv6(address: string): AddressClass {
  const g = expandIpv6(address);
  if (g.every((x) => x === 0)) return 'forbidden';
  if (startsWith(g, [0, 0, 0, 0, 0, 0, 0, 1])) return 'private';
  const v4 = embeddedIpv4(g);
  if (v4) return classifyIpv4(v4);
  if (startsWith(g, [0x64, 0xff9b, 1])) return 'forbidden';
  if (startsWith(g, [0xfd00, 0x0ec2])) return 'forbidden';
  const first = g[0] ?? 0;
  return IPV6_PREFIXES.find((p) => (first & p.mask) === p.value)?.kind ?? 'public';
}

export function classifyAddress(address: string): AddressClass {
  const family = isIP(address);
  if (family === 4) return classifyIpv4(address);
  if (family === 6) return classifyIpv6(address);
  return 'forbidden';
}

const FORBIDDEN_HOSTNAMES = new Set(['metadata', 'metadata.google.internal', 'instance-data']);

function classifyHostname(hostname: string): AddressClass | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const literal = host.startsWith('[') ? host.slice(1, -1) : host;
  if (isIP(literal)) return classifyAddress(literal);
  if (FORBIDDEN_HOSTNAMES.has(host)) return 'forbidden';
  if (host === 'localhost' || host.endsWith('.localhost')) return 'private';
  return null;
}

interface PrivateTargetRule {
  host?: string;
  range?: BlockList;
  port?: number;
}

export interface PrivateEndpointPolicy {
  allowAll: boolean;
  rules: readonly PrivateTargetRule[];
}

export const BLOCK_PRIVATE: PrivateEndpointPolicy = { allowAll: false, rules: [] };
export const ALLOW_PRIVATE: PrivateEndpointPolicy = { allowAll: true, rules: [] };

function familyOf(address: string): 'ipv4' | 'ipv6' {
  return isIP(address) === 6 ? 'ipv6' : 'ipv4';
}

const RANGE_PATTERN = /^([0-9a-f.:]+)(?:\/(\d{1,3}))?$/;

function parseRange(text: string): BlockList | null {
  const match = RANGE_PATTERN.exec(text);
  const address = match?.[1] ?? '';
  const family = isIP(address);
  if (!match || family === 0) return null;
  const range = new BlockList();
  if (match[2] === undefined) {
    range.addAddress(address, familyOf(address));
    return range;
  }
  const bits = Number(match[2]);
  if (bits < 1 || bits > (family === 6 ? 128 : 32)) return null;
  range.addSubnet(address, bits, familyOf(address));
  return range;
}

const BRACKETED = /^\[([^\]]+)\](?::(\d+))?$/;
const HOSTNAME_RULE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

function splitPort(entry: string): { target: string; port?: string } | null {
  if (entry.startsWith('[')) {
    const match = BRACKETED.exec(entry);
    return match ? { target: match[1] ?? '', port: match[2] } : null;
  }
  const colons = entry.split(':').length - 1;
  if (colons !== 1) return { target: entry };
  const [target = '', port] = entry.split(':');
  return { target, port };
}

function parseRule(entry: string): PrivateTargetRule {
  const invalid = new Error(
    `PRIVATE_PROVIDER_ENDPOINTS entry "${entry}" must be a host, IP address or CIDR range with an optional :port, or "allow" on its own`
  );
  const split = splitPort(entry.toLowerCase());
  if (!split) throw invalid;
  let port: number | undefined;
  if (split.port !== undefined) {
    port = Number(split.port);
    if (!/^\d{1,5}$/.test(split.port) || port < 1 || port > 65535) throw invalid;
  }
  const range = parseRange(split.target);
  if (range) return { range, port };
  if (split.target === 'allow' || !HOSTNAME_RULE.test(split.target)) throw invalid;
  return { host: split.target, port };
}

export function parsePrivateEndpointPolicy(allow: string, block: boolean): PrivateEndpointPolicy {
  if (block) return BLOCK_PRIVATE;
  const entries = allow
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 1 && entries[0]?.toLowerCase() === 'allow') return ALLOW_PRIVATE;
  return { allowAll: false, rules: entries.map(parseRule) };
}

let cachedPolicy: { key: string; policy: PrivateEndpointPolicy } | null = null;

function hasSecondAccount(): boolean {
  const row = getDb()
    .select({ accounts: count() })
    .from(users)
    .where(ne(users.id, DEMO_USER_ID))
    .get();
  return (row?.accounts ?? 0) > 1;
}

export function privateEndpointPolicy(): PrivateEndpointPolicy {
  const { allow, block } = CONFIG.privateProviderEndpoints;
  if (!block && allow.trim() === '') return hasSecondAccount() ? BLOCK_PRIVATE : ALLOW_PRIVATE;
  const key = `${block}|${allow}`;
  if (cachedPolicy?.key !== key) {
    cachedPolicy = { key, policy: parsePrivateEndpointPolicy(allow, block) };
  }
  return cachedPolicy.policy;
}

export const PRIVATE_NETWORK_PERMISSION = 'server.private_network.use';

export function isNetworkAdmin(userId: string): boolean {
  const db = getDb();
  const email = db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .get()?.email;
  if (email && CONFIG.adminEmails.includes(email.toLowerCase())) return true;
  return resolverFor(db, userId).can(PRIVATE_NETWORK_PERMISSION, { kind: 'server' }).allow;
}

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function adminEmailWarnings(adminEmails: readonly string[]): string[] {
  if (adminEmails.length === 0) return [];
  const warnings = adminEmails
    .filter((email) => !EMAIL_SHAPE.test(email))
    .map((email) => `ADMIN_EMAILS entry "${email}" is not an email address, so it matches nobody`);
  const listedAccount = getDb()
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(sql`lower(${users.email})`, [...adminEmails]),
        isNull(users.disabledAt),
        ne(users.id, DEMO_USER_ID)
      )
    )
    .limit(1)
    .get();
  if (!listedAccount) {
    warnings.push(
      'No active account uses an ADMIN_EMAILS address yet: until that person signs in, only users whose role grants private network access can use private network targets'
    );
  }
  return warnings;
}

export function privateEndpointPolicyFor(ownerId: string): PrivateEndpointPolicy {
  const { allow, block } = CONFIG.privateProviderEndpoints;
  if (block) return BLOCK_PRIVATE;
  if (CONFIG.adminEmails.length === 0) return privateEndpointPolicy();
  if (!isNetworkAdmin(ownerId)) return BLOCK_PRIVATE;
  return allow.trim() === '' ? ALLOW_PRIVATE : privateEndpointPolicy();
}

function normalizedHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '');
}

function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

function isLocalhostName(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost');
}

function privateTargetAllowed(
  policy: PrivateEndpointPolicy,
  url: URL,
  address: string | null
): boolean {
  if (policy.allowAll) return true;
  const host = normalizedHost(url.hostname);
  const port = effectivePort(url);
  return policy.rules.some(
    (rule) =>
      (rule.port === undefined || rule.port === port) &&
      (rule.host !== undefined
        ? rule.host === host
        : rule.range !== undefined &&
          address !== null &&
          rule.range.check(address, familyOf(address)))
  );
}

function mayReachPrivateByName(policy: PrivateEndpointPolicy, url: URL): boolean {
  const host = normalizedHost(url.hostname);
  return (
    policy.allowAll || policy.rules.some((rule) => rule.range !== undefined || rule.host === host)
  );
}

export class EndpointNotAllowedError extends ValidationError {}

function assertTargetAllowed(
  kind: AddressClass,
  url: URL,
  address: string | null,
  label: string,
  policy: PrivateEndpointPolicy
): void {
  if (kind === 'forbidden')
    throw new EndpointNotAllowedError(`${label} must point to a public host`);
  if (kind === 'private' && !privateTargetAllowed(policy, url, address)) {
    throw new EndpointNotAllowedError(
      `${label} must point to a public host: this server doesn't allow private network addresses`
    );
  }
  if (kind === 'public' && url.protocol !== 'https:') {
    throw new EndpointNotAllowedError(`${label} must use https`);
  }
}

function literalAddress(hostname: string): string | null {
  const literal = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  return isIP(literal) ? literal : null;
}

export function urlForAddress(url: URL, address: string): URL {
  const pinned = new URL(url);
  pinned.hostname = isIP(address) === 6 ? `[${address}]` : address;
  return pinned;
}

export const outboundResolver = {
  lookup: async (hostname: string): Promise<string[]> =>
    (await lookup(hostname, { all: true, verbatim: true })).map((r) => r.address),
  connectUrl: urlForAddress,
};

export function assertSafeOutboundUrl(
  raw: string,
  label: string,
  policy: PrivateEndpointPolicy
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError(`${label} must be a valid URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ValidationError(`${label} must use https`);
  }
  if (url.username || url.password) {
    throw new ValidationError(`${label} must not contain credentials`);
  }
  const kind = classifyHostname(url.hostname);
  if (kind) {
    const host = normalizedHost(url.hostname);
    const address = literalAddress(host) ?? (isLocalhostName(host) ? '127.0.0.1' : null);
    assertTargetAllowed(kind, url, address, label, policy);
  } else if (url.protocol !== 'https:' && !mayReachPrivateByName(policy, url)) {
    throw new EndpointNotAllowedError(`${label} must use https`);
  }
  return url;
}

interface SafeOutboundTarget {
  url: URL;
  addresses: string[];
}

export async function resolveSafeOutboundTarget(
  raw: string,
  label: string,
  policy: PrivateEndpointPolicy
): Promise<SafeOutboundTarget> {
  const url = assertSafeOutboundUrl(raw, label, policy);
  const literal = literalAddress(url.hostname);
  if (literal) return { url, addresses: [literal] };
  if (isLocalhostName(normalizedHost(url.hostname))) return { url, addresses: ['127.0.0.1'] };
  let addresses: string[];
  try {
    addresses = await outboundResolver.lookup(url.hostname);
  } catch {
    throw new ValidationError(`${label} host could not be resolved`);
  }
  if (addresses.length === 0) throw new ValidationError(`${label} host could not be resolved`);
  for (const address of addresses) {
    assertTargetAllowed(classifyAddress(address), url, address, label, policy);
  }
  return { url, addresses };
}

const CONNECT_FAILURE_CODES = new Set(['ConnectionRefused', 'FailedToOpenSocket']);

function isConnectFailure(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CONNECT_FAILURE_CODES.has(code);
}

export async function fetchOutbound(
  raw: string,
  init: RequestInit & { headers?: Record<string, string> },
  label: string,
  policy: PrivateEndpointPolicy
): Promise<Response> {
  const { url, addresses } = await resolveSafeOutboundTarget(raw, label, policy);
  if (literalAddress(url.hostname)) return fetch(url, { ...init, redirect: 'manual' });
  let lastError: unknown;
  for (const address of addresses) {
    try {
      return await fetch(outboundResolver.connectUrl(url, address), {
        ...init,
        headers: { ...init.headers, host: url.host },
        redirect: 'manual',
        tls: { serverName: url.hostname },
      });
    } catch (err) {
      if (!isConnectFailure(err)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}
