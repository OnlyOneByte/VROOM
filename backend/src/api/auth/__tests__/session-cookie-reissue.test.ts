/**
 * An actively used login must not expire while its server-side session is alive. Forces a session
 * past its half-life, makes an authenticated request, and checks that the cookie is re-issued with
 * the extended deadline. An untouched session must not re-issue the cookie.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

/** The acting session's id, parsed out of the harness cookie (`<name>=<id>`). */
function sessionId(): string {
  const value = ctx.cookie.split('=')[1];
  expect(value, 'harness cookie should carry a session id').toBeTruthy();
  return value;
}

/** The session row's stored expiry, in ms since epoch. Lucia's sqlite adapter stores SECONDS. */
function storedExpiry(id: string): number {
  const row = ctx.sqlite.query('SELECT expires_at FROM sessions WHERE id = ?').get(id) as {
    expires_at: number;
  } | null;
  expect(row, 'session row should exist').not.toBeNull();
  return Number(row?.expires_at) * 1000;
}

/** Force a session's stored deadline (ms since epoch) through the adapter's seconds encoding. */
function setStoredExpiry(id: string, atMs: number): void {
  ctx.sqlite.run('UPDATE sessions SET expires_at = ? WHERE id = ?', [Math.floor(atMs / 1000), id]);
}

const HOUR = 60 * 60 * 1000;

describe('session cookie re-issue', () => {
  test('a request on a past-half-life session re-issues the cookie with the extended expiry', async () => {
    const id = sessionId();
    // 20 hours left is well inside the half-life of a 30-day session, so validation extends it.
    const nearExpiry = Date.now() + 20 * HOUR;
    setStoredExpiry(id, nearExpiry);

    const res = await ctx.authed('GET', '/api/v1/vehicles');
    expect(res.status).toBe(200);

    const extended = storedExpiry(id);
    expect(extended).toBeGreaterThan(nearExpiry + 20 * 24 * HOUR);

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(
      setCookie,
      'an extended session must re-issue its cookie, or the browser drops a still-valid login'
    ).toContain(id);
    expect(setCookie).toContain(`Expires=${new Date(extended).toUTCString()}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    expect((await ctx.authed('GET', '/api/v1/vehicles')).status).toBe(200);
  });

  test('POST /auth/refresh on a past-half-life session re-issues the cookie too', async () => {
    const id = sessionId();
    setStoredExpiry(id, Date.now() + 20 * HOUR);

    const res = await ctx.authed('POST', '/api/v1/auth/refresh');
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie, 'the refresh endpoint must be able to extend the browser cookie').toContain(
      id
    );
    expect(setCookie).toContain(`Expires=${new Date(storedExpiry(id)).toUTCString()}`);
  });

  test('a freshly-minted session re-issues nothing', async () => {
    const res = await ctx.authed('GET', '/api/v1/vehicles');
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
