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

function embeddedIpv4(groups: number[]): string {
  const hi = groups[6] ?? 0;
  const lo = groups[7] ?? 0;
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
}

function classifyIpv6(address: string): AddressClass {
  const g = expandIpv6(address);
  const first = g[0] ?? 0;
  const prefixZero = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (prefixZero(8)) return 'forbidden';
  if (prefixZero(7) && g[7] === 1) return 'private';
  if (prefixZero(5) && g[5] === 0xffff) return classifyIpv4(embeddedIpv4(g));
  if (prefixZero(6)) return classifyIpv4(embeddedIpv4(g));
  if (first === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return classifyIpv4(embeddedIpv4(g));
  }
  if (first === 0xfd00 && g[1] === 0x0ec2) return 'forbidden';
  if ((first & 0xffc0) === 0xfe80) return 'forbidden';
  if ((first & 0xff00) === 0xff00) return 'forbidden';
  if ((first & 0xfe00) === 0xfc00) return 'private';
  return 'public';
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

export const outboundResolver = {
  lookup: async (hostname: string): Promise<string[]> =>
    (await lookup(hostname, { all: true, verbatim: true })).map((r) => r.address),
};

export function assertSafeOutboundUrl(
  raw: string,
  label: string,
  allowPrivate: boolean = CONFIG.allowPrivateProviderEndpoints
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

export async function assertSafeOutboundTarget(
  raw: string,
  label: string,
  allowPrivate: boolean = CONFIG.allowPrivateProviderEndpoints
): Promise<URL> {
  const url = assertSafeOutboundUrl(raw, label, allowPrivate);
  if (classifyHostname(url.hostname)) return url;
  let addresses: string[];
  try {
    addresses = await outboundResolver.lookup(url.hostname);
  } catch {
    throw new ValidationError(`${label} host could not be resolved`);
  }
  if (addresses.length === 0) throw new ValidationError(`${label} host could not be resolved`);
  for (const address of addresses) assertAllowed(classifyAddress(address), label, allowPrivate);
  return url;
}
