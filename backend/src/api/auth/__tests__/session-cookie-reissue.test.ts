/**
 * Regression guard: an actively-used login must not expire while its server-side session is alive.
 *
 * Lucia slides a session's DB `expires_at` forward inside `validateSession` once the session passes
 * its half-life. The browser cookie is written ONLY at login, with a fixed `maxAge`. If nothing
 * re-issues the cookie when the row is extended, the two deadlines diverge: a user who signs in and
 * then uses the app every day is silently signed out on the original deadline, holding a cookie the
 * browser has dropped while the server still considers the session valid. `POST /auth/refresh` cannot
 * rescue that, because it runs the same helper.
 *
 * This drives the REAL stack: force a seeded session's `expires_at` past its half-life, make an
 * ordinary authenticated request, and assert the response re-issues the cookie with the extended
 * deadline — and that an untouched session re-issues nothing (one Set-Cookie per half-life window,
 * not one per request).
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
    // 20 hours left: well past the half-life of a 30-day session, so validateSession will extend it.
    const nearExpiry = Date.now() + 20 * HOUR;
    setStoredExpiry(id, nearExpiry);

    const res = await ctx.authed('GET', '/api/v1/vehicles');
    expect(res.status).toBe(200);

    // Lucia extended the row in place — same session id, a deadline a full session-duration out.
    const extended = storedExpiry(id);
    expect(extended).toBeGreaterThan(nearExpiry + 20 * 24 * HOUR);

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(
      setCookie,
      'an extended session must re-issue its cookie, or the browser drops a still-valid login'
    ).toContain(id);
    // The cookie's own deadline must be the row's NEW deadline, not the original login deadline.
    expect(setCookie).toContain(`Expires=${new Date(extended).toUTCString()}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    // The session keeps working afterwards — this is an extension, never a rotation the client must follow.
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

  test('a freshly-minted session re-issues nothing (no per-request cookie churn)', async () => {
    // The harness session was just created, so it is nowhere near its half-life.
    const res = await ctx.authed('GET', '/api/v1/vehicles');
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
