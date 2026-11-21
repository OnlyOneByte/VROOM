import { afterEach, describe, expect, test } from 'bun:test';
import { ValidationError } from '../../errors';
import {
  assertSafeOutboundUrl,
  classifyAddress,
  fetchOutbound,
  outboundResolver,
  resolveSafeOutboundTarget,
  urlForAddress,
} from '../outbound-url';

const stubLookup = outboundResolver.lookup;
const stubConnectUrl = outboundResolver.connectUrl;
const realFetch = globalThis.fetch;

afterEach(() => {
  outboundResolver.lookup = stubLookup;
  outboundResolver.connectUrl = stubConnectUrl;
  globalThis.fetch = realFetch;
});

describe('classifyAddress', () => {
  test.each<[string, ReturnType<typeof classifyAddress>]>([
    ['8.8.8.8', 'public'],
    ['93.184.215.14', 'public'],
    ['2606:4700::1111', 'public'],
    ['10.1.2.3', 'private'],
    ['127.0.0.1', 'private'],
    ['172.20.0.4', 'private'],
    ['192.168.1.10', 'private'],
    ['100.64.0.1', 'private'],
    ['::1', 'private'],
    ['fd12:3456::1', 'private'],
    ['::ffff:10.0.0.1', 'private'],
    ['::ffff:7f00:1', 'private'],
    ['169.254.169.254', 'forbidden'],
    ['100.100.100.200', 'forbidden'],
    ['168.63.129.16', 'forbidden'],
    ['0.0.0.0', 'forbidden'],
    ['::', 'forbidden'],
    ['fe80::1', 'forbidden'],
    ['fd00:ec2::254', 'forbidden'],
    ['::ffff:169.254.169.254', 'forbidden'],
    ['64:ff9b::a9fe:a9fe', 'forbidden'],
    ['64:ff9b::808:808', 'public'],
    ['64:ff9b:1::a9fe:a9fe', 'forbidden'],
    ['::ffff:0:a9fe:a9fe', 'forbidden'],
    ['2002:a9fe:a9fe::1', 'forbidden'],
    ['2002:0a00:0001::1', 'private'],
    ['2002:0808:0808::1', 'public'],
    ['fec0::1', 'private'],
    ['224.0.0.1', 'forbidden'],
    ['not-an-ip', 'forbidden'],
  ])('%s is %s', (address, expected) => {
    expect(classifyAddress(address)).toBe(expected);
  });
});

describe('assertSafeOutboundUrl', () => {
  test('accepts a public https URL', () => {
    expect(assertSafeOutboundUrl('https://s3.example.com', 'S3 endpoint', false).hostname).toBe(
      's3.example.com'
    );
  });

  test.each([
    'http://s3.example.com',
    'ftp://s3.example.com',
    'file:///etc/passwd',
    'https://user:pass@s3.example.com',
    'https://127.0.0.1',
    'https://2130706433',
    'https://0x7f.1',
    'https://[::1]',
    'https://[::ffff:127.0.0.1]',
    'https://10.0.0.5:9000',
    'https://localhost:9000',
    'https://minio.localhost',
    'https://169.254.169.254',
    'https://metadata.google.internal',
    'not a url',
  ])('rejects %s when private hosts are blocked', (raw) => {
    expect(() => assertSafeOutboundUrl(raw, 'S3 endpoint', false)).toThrow(ValidationError);
  });

  test('by default, http and LAN or loopback hosts are allowed', () => {
    expect(() => assertSafeOutboundUrl('http://localhost:11434/v1', 'LLM')).not.toThrow();
    expect(() => assertSafeOutboundUrl('http://192.168.1.20:9000', 'S3')).not.toThrow();
  });

  test('by default, metadata and link-local hosts are rejected', () => {
    expect(() => assertSafeOutboundUrl('http://169.254.169.254', 'S3')).toThrow(ValidationError);
    expect(() => assertSafeOutboundUrl('http://metadata.google.internal', 'S3')).toThrow(
      ValidationError
    );
  });

  test('allowing private hosts permits http and LAN hosts', () => {
    expect(() => assertSafeOutboundUrl('http://localhost:11434/v1', 'LLM', true)).not.toThrow();
    expect(() => assertSafeOutboundUrl('http://192.168.1.20:9000', 'S3', true)).not.toThrow();
  });

  test('allowing private hosts still rejects metadata and link-local hosts', () => {
    expect(() => assertSafeOutboundUrl('http://169.254.169.254', 'S3', true)).toThrow(
      ValidationError
    );
    expect(() => assertSafeOutboundUrl('http://[fd00:ec2::254]', 'S3', true)).toThrow(
      ValidationError
    );
    expect(() => assertSafeOutboundUrl('http://metadata.google.internal', 'S3', true)).toThrow(
      ValidationError
    );
  });
});

describe('resolveSafeOutboundTarget', () => {
  test('rejects a public-looking name that resolves to a private address', async () => {
    outboundResolver.lookup = async () => ['10.0.0.7'];
    await expect(
      resolveSafeOutboundTarget('https://files.example.com', 'S3 endpoint', false)
    ).rejects.toThrow(ValidationError);
  });

  test('rejects when any resolved address is disallowed', async () => {
    outboundResolver.lookup = async () => ['93.184.215.14', '169.254.169.254'];
    await expect(
      resolveSafeOutboundTarget('https://files.example.com', 'S3 endpoint', true)
    ).rejects.toThrow(ValidationError);
  });

  test('rejects a host that does not resolve', async () => {
    outboundResolver.lookup = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(
      resolveSafeOutboundTarget('https://files.example.com', 'S3 endpoint', false)
    ).rejects.toThrow(ValidationError);
  });

  test('accepts a name that resolves only to public addresses', async () => {
    outboundResolver.lookup = async () => ['93.184.215.14'];
    const target = await resolveSafeOutboundTarget(
      'https://files.example.com',
      'S3 endpoint',
      false
    );
    expect(target.url.hostname).toBe('files.example.com');
    expect(target.address).toBe('93.184.215.14');
  });
});

describe('urlForAddress', () => {
  test('puts an IPv4 address in place of the host and keeps the rest', () => {
    expect(
      urlForAddress(new URL('https://s3.example.com:9000/b/k?x=1'), '93.184.215.14').href
    ).toBe('https://93.184.215.14:9000/b/k?x=1');
  });

  test('brackets an IPv6 address', () => {
    expect(urlForAddress(new URL('https://s3.example.com:9000/b/k'), '2606:4700::1111').href).toBe(
      'https://[2606:4700::1111]:9000/b/k'
    );
  });
});

describe('fetchOutbound', () => {
  interface CapturedCall {
    url: string;
    init: RequestInit & { tls?: { serverName?: string }; headers?: Record<string, string> };
  }

  function captureFetch(): CapturedCall[] {
    const calls: CapturedCall[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: (init ?? {}) as CapturedCall['init'] });
      return new Response('{}');
    }) as typeof fetch;
    return calls;
  }

  test('an https request connects to the validated address and verifies the original hostname', async () => {
    outboundResolver.lookup = async () => ['93.184.215.14'];
    outboundResolver.connectUrl = urlForAddress;
    const calls = captureFetch();
    await fetchOutbound(
      'https://models.example.com/v1/chat',
      { method: 'POST', headers: { a: 'b' } },
      'LLM'
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://93.184.215.14/v1/chat');
    expect(calls[0]?.init.tls?.serverName).toBe('models.example.com');
    expect(calls[0]?.init.headers).toEqual({ a: 'b', host: 'models.example.com' });
    expect(calls[0]?.init.redirect).toBe('manual');
  });

  test('an IPv6 validated address is bracketed and the host header keeps the port', async () => {
    outboundResolver.lookup = async () => ['2606:4700::1111'];
    outboundResolver.connectUrl = urlForAddress;
    const calls = captureFetch();
    await fetchOutbound('https://s3.example.com:9000/photos', { method: 'GET' }, 'S3 endpoint');
    expect(calls[0]?.url).toBe('https://[2606:4700::1111]:9000/photos');
    expect(calls[0]?.init.tls?.serverName).toBe('s3.example.com');
    expect(calls[0]?.init.headers?.host).toBe('s3.example.com:9000');
  });

  test('an IP-literal URL is fetched as is, without a TLS name override', async () => {
    const calls = captureFetch();
    await fetchOutbound('https://93.184.215.14/v1', { method: 'GET' }, 'LLM');
    expect(calls[0]?.url).toBe('https://93.184.215.14/v1');
    expect(calls[0]?.init.tls).toBeUndefined();
  });

  test('an IPv6 metadata address is refused before any request', async () => {
    outboundResolver.lookup = async () => ['fd00:ec2::254'];
    const calls = captureFetch();
    await expect(fetchOutbound('https://s3.example.com/', { method: 'GET' }, 'S3')).rejects.toThrow(
      ValidationError
    );
    expect(calls).toHaveLength(0);
  });
});
