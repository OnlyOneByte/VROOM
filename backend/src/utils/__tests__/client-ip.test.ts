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
    expect(a).toBe(b);
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

  test('falls back to the socket IP when trusted but no X-Forwarded-For is sent', () => {
    socketAddress = '10.0.0.1';
    expect(getClientIp(ctx({}), ['10.0.0.1'])).toBe('10.0.0.1');
  });

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

  test('takes the leftmost entry of a multi-hop X-Forwarded-For in the fallback', () => {
    connInfoThrows = true;
    expect(getClientIp(ctx({ 'X-Forwarded-For': ' 5.6.7.8 , 9.9.9.9 ' }), [])).toBe('5.6.7.8');
  });
});
