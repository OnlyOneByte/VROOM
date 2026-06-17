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

  // C265: a request can arrive AT the trusted proxy's socket IP with NO X-Forwarded-For (e.g. a
  // direct hit to the LB, or a probe). The trusted branch is entered but `xff` is undefined, so it
  // must fall through to the socket IP — never crash, never key on 'unknown' (which would pool all
  // such requests into one shared bucket).
  test('falls back to the socket IP when trusted but no X-Forwarded-For is sent', () => {
    socketAddress = '10.0.0.1';
    expect(getClientIp(ctx({}), ['10.0.0.1'])).toBe('10.0.0.1');
  });

  // C265: an empty / whitespace-only X-Forwarded-For from a trusted proxy parses to undefined
  // (clientFromForwardedFor's `first || undefined`), so it must fall through to the socket IP — not
  // return '' as the rate-limit key (an empty key would pool every empty-XFF request together).
  test('falls back to the socket IP when trusted but X-Forwarded-For is empty/whitespace', () => {
    socketAddress = '10.0.0.1';
    expect(getClientIp(ctx({ 'X-Forwarded-For': '   ' }), ['10.0.0.1'])).toBe('10.0.0.1');
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

  // C265: the no-socket fallback (:62) takes the LEFTMOST XFF entry + trims, mirroring the
  // trusted-proxy parse — pin that a multi-entry header keys on the original client, not the raw
  // string (so two in-process requests behind the same first-hop client share a bucket).
  test('takes the leftmost entry of a multi-hop X-Forwarded-For in the fallback', () => {
    connInfoThrows = true;
    expect(getClientIp(ctx({ 'X-Forwarded-For': ' 5.6.7.8 , 9.9.9.9 ' }), [])).toBe('5.6.7.8');
  });
});
