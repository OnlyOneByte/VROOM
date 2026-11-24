import { afterEach, describe, expect, test } from 'bun:test';
import { ValidationError } from '../../errors';
import { blockPrivateProviderEndpoints } from '../../test-helpers/outbound';
import {
  ALLOW_PRIVATE,
  assertSafeOutboundUrl,
  BLOCK_PRIVATE,
  classifyAddress,
  fetchOutbound,
  outboundResolver,
  parsePrivateEndpointPolicy,
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
    expect(
      assertSafeOutboundUrl('https://s3.example.com', 'S3 endpoint', BLOCK_PRIVATE).hostname
    ).toBe('s3.example.com');
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
    expect(() => assertSafeOutboundUrl(raw, 'S3 endpoint', BLOCK_PRIVATE)).toThrow(ValidationError);
  });

  test('by default, LAN and loopback hosts are refused', () => {
    const defaults = parsePrivateEndpointPolicy('', false);
    for (const raw of ['http://localhost:11434/v1', 'https://192.168.1.20:9000', 'https://[::1]']) {
      expect(() => assertSafeOutboundUrl(raw, 'LLM', defaults)).toThrow(
        "LLM must point to a public host: this server doesn't allow private network addresses"
      );
    }
  });

  test('by default, metadata and link-local hosts are rejected', () => {
    const defaults = parsePrivateEndpointPolicy('', false);
    expect(() => assertSafeOutboundUrl('http://169.254.169.254', 'S3', defaults)).toThrow(
      ValidationError
    );
    expect(() => assertSafeOutboundUrl('http://metadata.google.internal', 'S3', defaults)).toThrow(
      ValidationError
    );
  });

  test('a public host must use https even when private hosts are allowed', () => {
    expect(() => assertSafeOutboundUrl('http://93.184.215.14', 'LLM', ALLOW_PRIVATE)).toThrow(
      'LLM must use https'
    );
    expect(() =>
      assertSafeOutboundUrl('http://api.example.com', 'LLM', parsePrivateEndpointPolicy('', false))
    ).toThrow('LLM must use https');
  });

  test('allowing private hosts permits http and LAN hosts', () => {
    expect(() =>
      assertSafeOutboundUrl('http://localhost:11434/v1', 'LLM', ALLOW_PRIVATE)
    ).not.toThrow();
    expect(() =>
      assertSafeOutboundUrl('http://192.168.1.20:9000', 'S3', ALLOW_PRIVATE)
    ).not.toThrow();
  });

  test('allowing private hosts still rejects metadata and link-local hosts', () => {
    expect(() => assertSafeOutboundUrl('http://169.254.169.254', 'S3', ALLOW_PRIVATE)).toThrow(
      ValidationError
    );
    expect(() => assertSafeOutboundUrl('http://[fd00:ec2::254]', 'S3', ALLOW_PRIVATE)).toThrow(
      ValidationError
    );
    expect(() =>
      assertSafeOutboundUrl('http://metadata.google.internal', 'S3', ALLOW_PRIVATE)
    ).toThrow(ValidationError);
  });
});

describe('resolveSafeOutboundTarget', () => {
  test('rejects a public-looking name that resolves to a private address', async () => {
    outboundResolver.lookup = async () => ['10.0.0.7'];
    await expect(
      resolveSafeOutboundTarget('https://files.example.com', 'S3 endpoint', BLOCK_PRIVATE)
    ).rejects.toThrow(ValidationError);
  });

  test('rejects when any resolved address is disallowed', async () => {
    outboundResolver.lookup = async () => ['93.184.215.14', '169.254.169.254'];
    await expect(
      resolveSafeOutboundTarget('https://files.example.com', 'S3 endpoint', ALLOW_PRIVATE)
    ).rejects.toThrow(ValidationError);
  });

  test('rejects a host that does not resolve', async () => {
    outboundResolver.lookup = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(
      resolveSafeOutboundTarget('https://files.example.com', 'S3 endpoint', BLOCK_PRIVATE)
    ).rejects.toThrow(ValidationError);
  });

  test('accepts a name that resolves only to public addresses', async () => {
    outboundResolver.lookup = async () => ['93.184.215.14', '2606:4700::1111'];
    const target = await resolveSafeOutboundTarget(
      'https://files.example.com',
      'S3 endpoint',
      BLOCK_PRIVATE
    );
    expect(target.url.hostname).toBe('files.example.com');
    expect(target.addresses).toEqual(['93.184.215.14', '2606:4700::1111']);
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

  function failingFetch(codes: (string | null)[]): string[] {
    const urls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const code = codes[urls.length];
      urls.push(String(input));
      if (code) throw Object.assign(new Error(code), { code });
      return new Response('ok');
    }) as typeof fetch;
    return urls;
  }

  test('a refused connection falls back to the next validated address', async () => {
    outboundResolver.lookup = async () => ['93.184.215.14', '93.184.215.15'];
    outboundResolver.connectUrl = urlForAddress;
    const urls = failingFetch(['ConnectionRefused', null]);
    const res = await fetchOutbound('https://s3.example.com/b', { method: 'GET' }, 'S3');
    expect(await res.text()).toBe('ok');
    expect(urls).toEqual(['https://93.184.215.14/b', 'https://93.184.215.15/b']);
  });

  test('a failure after connecting is not retried on another address', async () => {
    outboundResolver.lookup = async () => ['93.184.215.14', '93.184.215.15'];
    outboundResolver.connectUrl = urlForAddress;
    const urls = failingFetch(['ECONNRESET', null]);
    await expect(
      fetchOutbound('https://models.example.com/v1', { method: 'POST' }, 'LLM')
    ).rejects.toThrow('ECONNRESET');
    expect(urls).toHaveLength(1);
  });

  test('when every address refuses, the last connection error is thrown', async () => {
    outboundResolver.lookup = async () => ['93.184.215.14', '93.184.215.15'];
    outboundResolver.connectUrl = urlForAddress;
    const urls = failingFetch(['FailedToOpenSocket', 'ConnectionRefused']);
    await expect(fetchOutbound('https://s3.example.com/', { method: 'GET' }, 'S3')).rejects.toThrow(
      'ConnectionRefused'
    );
    expect(urls).toHaveLength(2);
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

describe('private endpoint policy', () => {
  const allowOllama = parsePrivateEndpointPolicy('192.168.1.10:11434, nas.lan, fd00:1::/64', false);

  test('"allow" permits every private target, and the block switch wins over it', () => {
    expect(parsePrivateEndpointPolicy('allow', false)).toEqual(ALLOW_PRIVATE);
    expect(parsePrivateEndpointPolicy('allow', true)).toEqual(BLOCK_PRIVATE);
    expect(parsePrivateEndpointPolicy('', false).allowAll).toBe(false);
  });

  test.each(['http://192.168.1.10:11434/v1', 'http://nas.lan:9000', 'https://[fd00:1::5]:9000'])(
    'an allowlisted target %s is allowed',
    (raw) => {
      expect(() => assertSafeOutboundUrl(raw, 'LLM', allowOllama)).not.toThrow();
    }
  );

  test.each([
    'http://192.168.1.10:80',
    'http://192.168.1.11:11434',
    'http://localhost:11434',
    'https://[fd00:2::5]',
    'https://10.0.0.1',
  ])('a private target outside the allowlist, %s, is refused', (raw) => {
    expect(() => assertSafeOutboundUrl(raw, 'LLM', allowOllama)).toThrow(ValidationError);
  });

  test('an allowlist never permits metadata or link-local addresses', () => {
    const wide = parsePrivateEndpointPolicy('128.0.0.0/1', false);
    expect(() => assertSafeOutboundUrl('http://169.254.169.254', 'S3', wide)).toThrow(
      'S3 must point to a public host'
    );
  });

  test('an IPv4 rule does not match a 6to4 address that embeds it', () => {
    const one = parsePrivateEndpointPolicy('192.168.1.20', false);
    expect(() => assertSafeOutboundUrl('http://192.168.1.20', 'S3', one)).not.toThrow();
    expect(() => assertSafeOutboundUrl('http://[2002:c0a8:114::]', 'S3', one)).toThrow(
      ValidationError
    );
  });

  test.each([
    '10.0.0.0/33',
    '10.0.0.0/',
    '10.0.0.0/ 8',
    '10.0.0.0/0x8',
    '10.0.0.0/1e1',
    '10.0.0.0/8/9',
    '0.0.0.0/0',
    '::/0',
    '[fd00::1',
    '[fd00::1]junk',
    '[fd00::]/8:9000',
    'allow,10.0.0.1',
    'not a host!',
    '192.168.1.10:0',
    'nas.lan:99999',
    'fd00::/129',
  ])('a malformed entry %s is refused at parse time', (entry) => {
    expect(() => parsePrivateEndpointPolicy(entry, false)).toThrow(
      'PRIVATE_PROVIDER_ENDPOINTS entry'
    );
  });

  test('a name that resolves to a non-allowlisted private address is refused', async () => {
    outboundResolver.lookup = async () => ['192.168.1.99'];
    await expect(
      resolveSafeOutboundTarget('https://files.example.com', 'S3', allowOllama)
    ).rejects.toThrow(ValidationError);
  });

  test('an http name that resolves to a public address is refused', async () => {
    outboundResolver.lookup = async () => ['93.184.215.14'];
    await expect(resolveSafeOutboundTarget('http://nas.lan', 'S3', allowOllama)).rejects.toThrow(
      'S3 must use https'
    );
  });

  describe('with the default policy', () => {
    blockPrivateProviderEndpoints();

    test('every request re-resolves, so a name rebound to a private address is refused', async () => {
      const answers = [['93.184.215.14'], ['10.0.0.7']];
      outboundResolver.lookup = async () => answers.shift() ?? [];
      globalThis.fetch = (async () => new Response('{}')) as unknown as typeof fetch;
      const policy = parsePrivateEndpointPolicy('', false);
      await expect(
        resolveSafeOutboundTarget('https://files.example.com', 'S3', policy)
      ).resolves.toBeDefined();
      await expect(
        fetchOutbound('https://files.example.com/', { method: 'GET' }, 'S3')
      ).rejects.toThrow(ValidationError);
    });
  });

  test('a redirect to a private address is returned, never followed', async () => {
    outboundResolver.lookup = async () => ['93.184.215.14'];
    const seen: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push(`${String(input)} ${init?.redirect}`);
      return new Response(null, { status: 302, headers: { location: 'http://10.0.0.7/' } });
    }) as typeof fetch;
    const res = await fetchOutbound('https://files.example.com/', { method: 'GET' }, 'S3');
    expect(res.status).toBe(302);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEndWith(' manual');
  });
});
