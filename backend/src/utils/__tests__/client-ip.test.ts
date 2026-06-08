/**
 * getClientIp — the trusted client-IP resolver behind rate-limit keys.
 *
 * SECURITY regression guard: an attacker must NOT be able to get a fresh rate-limit
 * bucket by spoofing X-Forwarded-For. These tests pin the trust rules:
 *   - no trusted proxies (default)          → ignore XFF, use socket IP
 *   - socket IS a trusted proxy             → honor leftmost XFF (the real client)
 *   - socket is NOT a trusted proxy         → ignore XFF even if present
 *   - no socket IP (in-process app.request) → fall back to XFF, else 'unknown'
 *
 * The trusted-proxy list is injected (getClientIp's 2nd arg) so the trust logic is
 * tested deterministically without env/module-cache gymnastics. `getConnInfo`
 * (hono/bun) is the only external dep; it's mock.module'd here (nothing else imports
 * client-ip, so the process-global stub can't leak usefully).
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Context } from 'hono';

let socketAddress: string | undefined;
let connInfoThrows = false;

mock.module('hono/bun', () => ({
  getConnInfo: () => {
    if (connInfoThrows) throw new TypeError('env has to include the 2nd argument of fetch.');
    return { remote: { address: socketAddress } };
  },
}));

import { getClientIp } from '../client-ip';

/** Minimal Context stub exposing only what getClientIp reads: req.header(). */
function ctx(headers: Record<string, string> = {}): Context {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    req: { header: (name: string) => lower[name.toLowerCase()] },
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

  test('two requests from one socket with different XFF share the same key', () => {
    socketAddress = '203.0.113.7';
    const a = getClientIp(ctx({ 'X-Forwarded-For': '1.1.1.1' }), []);
    const b = getClientIp(ctx({ 'X-Forwarded-For': '2.2.2.2' }), []);
    expect(a).toBe(b); // bypass closed: same bucket regardless of header
  });
});

describe('getClientIp — behind a trusted proxy', () => {
  test('honors the leftmost X-Forwarded-For when the socket is a trusted proxy', () => {
    socketAddress = '10.0.0.1';
    expect(getClientIp(ctx({ 'X-Forwarded-For': '198.51.100.9, 10.0.0.1' }), ['10.0.0.1'])).toBe(
      '198.51.100.9'
    );
  });

  test('ignores X-Forwarded-For when the socket is NOT a trusted proxy', () => {
    socketAddress = '203.0.113.7';
    expect(getClientIp(ctx({ 'X-Forwarded-For': '198.51.100.9' }), ['10.0.0.1'])).toBe(
      '203.0.113.7'
    );
  });
});

describe('getClientIp — no socket IP (in-process app.request)', () => {
  test('falls back to X-Forwarded-For when present', () => {
    connInfoThrows = true;
    expect(getClientIp(ctx({ 'X-Forwarded-For': '5.6.7.8' }), [])).toBe('5.6.7.8');
  });

  test("returns 'unknown' when neither socket nor header is available", () => {
    connInfoThrows = true;
    expect(getClientIp(ctx({}), [])).toBe('unknown');
  });
});
