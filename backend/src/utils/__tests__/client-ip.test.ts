import { beforeEach, describe, expect, test } from 'bun:test';
import type { Context } from 'hono';
import { getClientIp, getClientRateKey, parseTrustedProxies, rateLimitKeyOf } from '../client-ip';

let socketAddress: string | undefined;
let connInfoThrows = false;

function ctx(headers: Record<string, string> = {}): Context {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  const env = connInfoThrows ? {} : { requestIP: () => ({ address: socketAddress }) };
  return {
    env,
    req: { raw: new Request('http://test/'), header: (name: string) => lower[name.toLowerCase()] },
  } as unknown as Context;
}

beforeEach(() => {
  socketAddress = undefined;
  connInfoThrows = false;
});

describe('getClientIp — no trusted proxies (default, direct exposure)', () => {
  test('ignores a spoofed X-Forwarded-For and uses the socket IP', () => {
    socketAddress = '203.0.113.7';
    expect(getClientIp(ctx({ 'X-Forwarded-For': '1.2.3.4' }), [])).toBe('203.0.113.7');
  });

  test('ignores a client IP header from an untrusted socket', () => {
    socketAddress = '203.0.113.7';
    expect(getClientIp(ctx({ 'CF-Connecting-IP': '1.2.3.4' }), [], 'cf-connecting-ip')).toBe(
      '203.0.113.7'
    );
  });

  test('two requests from one socket with different XFF share the same key', () => {
    socketAddress = '203.0.113.7';
    const a = getClientIp(ctx({ 'X-Forwarded-For': '1.1.1.1' }), []);
    const b = getClientIp(ctx({ 'X-Forwarded-For': '2.2.2.2' }), []);
    expect(a).toBe(b);
  });
});

describe('getClientIp — behind a trusted proxy', () => {
  test('one proxy: the hop it appended is the client', () => {
    socketAddress = '10.0.0.1';
    expect(getClientIp(ctx({ 'X-Forwarded-For': '198.51.100.9' }), ['10.0.0.1'])).toBe(
      '198.51.100.9'
    );
  });

  test('a forged left-most entry is ignored: the nearest untrusted hop wins', () => {
    socketAddress = '10.0.0.1';
    expect(getClientIp(ctx({ 'X-Forwarded-For': '1.2.3.4, 198.51.100.9' }), ['10.0.0.1'])).toBe(
      '198.51.100.9'
    );
  });

  test('two chained proxies: trusted hops are skipped from the right', () => {
    socketAddress = '10.0.0.1';
    expect(
      getClientIp(ctx({ 'X-Forwarded-For': '6.6.6.6, 198.51.100.9, 10.0.0.2' }), [
        '10.0.0.1',
        '10.0.0.2',
      ])
    ).toBe('198.51.100.9');
  });

  test('a CIDR range trusts every proxy inside it', () => {
    socketAddress = '172.18.0.5';
    expect(
      getClientIp(ctx({ 'X-Forwarded-For': '6.6.6.6, 198.51.100.9, 172.18.0.9' }), [
        '172.16.0.0/12',
      ])
    ).toBe('198.51.100.9');
  });

  test('an IPv4-mapped socket address matches an IPv4 range', () => {
    socketAddress = '::ffff:10.0.0.1';
    expect(getClientIp(ctx({ 'X-Forwarded-For': '198.51.100.9' }), ['10.0.0.0/8'])).toBe(
      '198.51.100.9'
    );
  });

  test('the configured client IP header is read only from a trusted proxy', () => {
    socketAddress = '172.18.0.5';
    expect(
      getClientIp(
        ctx({ 'CF-Connecting-IP': '198.51.100.9', 'X-Forwarded-For': '1.2.3.4' }),
        ['172.16.0.0/12'],
        'cf-connecting-ip'
      )
    ).toBe('198.51.100.9');
  });

  test('a client IP header that is not an IP address falls back to X-Forwarded-For', () => {
    socketAddress = '10.0.0.1';
    expect(
      getClientIp(
        ctx({ 'CF-Connecting-IP': 'evil', 'X-Forwarded-For': '198.51.100.9' }),
        ['10.0.0.1'],
        'cf-connecting-ip'
      )
    ).toBe('198.51.100.9');
  });

  test('a malformed hop stops the walk at the nearest valid hop', () => {
    socketAddress = '10.0.0.1';
    expect(
      getClientIp(ctx({ 'X-Forwarded-For': '198.51.100.9, junk, 10.0.0.2' }), ['10.0.0.0/8'])
    ).toBe('10.0.0.2');
  });

  test('ignores X-Forwarded-For when the socket is NOT a trusted proxy', () => {
    socketAddress = '203.0.113.7';
    expect(getClientIp(ctx({ 'X-Forwarded-For': '198.51.100.9' }), ['10.0.0.1'])).toBe(
      '203.0.113.7'
    );
  });

  test('falls back to the socket IP when trusted but no X-Forwarded-For is sent', () => {
    socketAddress = '10.0.0.1';
    expect(getClientIp(ctx({}), ['10.0.0.1'])).toBe('10.0.0.1');
  });

  test('falls back to the socket IP when trusted but X-Forwarded-For is empty/whitespace', () => {
    socketAddress = '10.0.0.1';
    expect(getClientIp(ctx({ 'X-Forwarded-For': '   ' }), ['10.0.0.1'])).toBe('10.0.0.1');
  });
});

describe('getClientIp — no socket IP', () => {
  test('never reads X-Forwarded-For when the socket address is unknown', () => {
    connInfoThrows = true;
    expect(getClientIp(ctx({ 'X-Forwarded-For': '5.6.7.8' }), [])).toBe('unknown');
  });
});

describe('parseTrustedProxies', () => {
  test('accepts addresses and CIDR ranges of both families', () => {
    const list = parseTrustedProxies(['10.0.0.1', '172.16.0.0/12', '2400:cb00::/32', '::1']);
    expect(list.check('172.31.0.1', 'ipv4')).toBe(true);
    expect(list.check('2400:cb00::7', 'ipv6')).toBe(true);
    expect(list.check('8.8.8.8', 'ipv4')).toBe(false);
  });

  test.each(['proxy.lan', '10.0.0.0/33', '10.0.0.0/x', '::/129', ''])('refuses %s', (entry) => {
    expect(() => parseTrustedProxies([entry])).toThrow('TRUSTED_PROXY_IPS entry');
  });
});

describe('rate limit keys', () => {
  test('two IPv6 addresses in one /64 share a key, in any notation', () => {
    expect(rateLimitKeyOf('2001:db8:1:2::1')).toBe(
      rateLimitKeyOf('2001:0db8:0001:0002:ffff::abcd')
    );
    expect(rateLimitKeyOf('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
  });

  test('IPv6 addresses in different /64s get different keys', () => {
    expect(rateLimitKeyOf('2001:db8:1:2::1')).not.toBe(rateLimitKeyOf('2001:db8:1:3::1'));
    expect(rateLimitKeyOf('::1')).toBe('0:0:0:0::/64');
  });

  test('an IPv4-mapped address keys as its IPv4 address, in either notation', () => {
    expect(rateLimitKeyOf('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitKeyOf('::ffff:cb00:7107')).toBe('203.0.113.7');
  });

  test('IPv4 addresses, zones and unknown sockets keep their own key', () => {
    expect(rateLimitKeyOf('203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitKeyOf('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(rateLimitKeyOf('unknown')).toBe('unknown');
  });

  test("a request's key is its client address collapsed to the /64", () => {
    const keyFrom = (address: string) => {
      socketAddress = address;
      return getClientRateKey(ctx());
    };
    expect(keyFrom('2001:db8:1:2::1')).toBe(keyFrom('2001:db8:1:2::99'));
    expect(keyFrom('2001:db8:1:2::1')).not.toBe(keyFrom('2001:db8:1:3::1'));
  });
});
