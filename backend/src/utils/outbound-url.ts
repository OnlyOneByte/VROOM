import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { CONFIG } from '../config';
import { ValidationError } from '../errors';

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

function assertAllowed(kind: AddressClass, label: string, allowPrivate: boolean): void {
  if (kind === 'forbidden' || (kind === 'private' && !allowPrivate)) {
    throw new ValidationError(`${label} must point to a public host`);
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
  allowPrivate: boolean = !CONFIG.blockPrivateProviderEndpoints
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError(`${label} must be a valid URL`);
  }
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) {
    throw new ValidationError(`${label} must use https`);
  }
  if (url.username || url.password) {
    throw new ValidationError(`${label} must not contain credentials`);
  }
  const literalKind = classifyHostname(url.hostname);
  if (literalKind) assertAllowed(literalKind, label, allowPrivate);
  return url;
}

interface SafeOutboundTarget {
  url: URL;
  addresses: string[];
}

export async function resolveSafeOutboundTarget(
  raw: string,
  label: string,
  allowPrivate: boolean = !CONFIG.blockPrivateProviderEndpoints
): Promise<SafeOutboundTarget> {
  const url = assertSafeOutboundUrl(raw, label, allowPrivate);
  const literal = literalAddress(url.hostname);
  if (literal) return { url, addresses: [literal] };
  let addresses: string[];
  try {
    addresses = await outboundResolver.lookup(url.hostname);
  } catch {
    throw new ValidationError(`${label} host could not be resolved`);
  }
  if (addresses.length === 0) throw new ValidationError(`${label} host could not be resolved`);
  for (const address of addresses) assertAllowed(classifyAddress(address), label, allowPrivate);
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
  label: string
): Promise<Response> {
  const { url, addresses } = await resolveSafeOutboundTarget(raw, label);
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
