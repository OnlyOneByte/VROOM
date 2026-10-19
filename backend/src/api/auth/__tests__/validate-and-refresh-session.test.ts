/**
 * Unit guard for validateAndRefreshSession (the auth/utils.ts session-lifetime core).
 *
 * This security-critical helper (used by BOTH the requireAuth middleware and POST /auth/refresh)
 * carries three invariants worth pinning against a mockable Lucia (no DB):
 *  1. an invalid/expired session → null (caller treats as unauthenticated).
 *  2. a session Lucia did NOT touch (`fresh: false`) → returned as-is, refreshed:false, and NO
 *  Set-Cookie — otherwise every single request would rewrite the session cookie.
 *  3. a session Lucia JUST EXTENDED (`fresh: true`, which it sets inside validateSession once the
 *  session passes its half-life) → the browser cookie is re-issued with the SAME session id and the
 *  NEW expiry. This is the only thing keeping the cookie's deadline and the DB row's deadline
 *  together: the cookie is otherwise written once at login with a fixed maxAge, so without the
 *  re-issue an actively-used login is dropped on its original deadline while the server-side
 *  session is still valid, and /auth/refresh cannot save it because it runs this same code.
 *
 * Lucia is injected, so this drives the REAL function with a hand-built mock recording call order.
 * The cookie assertions run the function inside a real Hono handler, because the Set-Cookie header
 * is the actual user-visible output being guarded.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { Lucia } from 'lucia';
import { CONFIG } from '../../../config';
import { validateAndRefreshSession } from '../utils';

const USER = { id: 'u-1' } as { id: string };

/** Build a mock Lucia exposing only the methods validateAndRefreshSession touches + a call log. */
function makeLucia(opts: { validate: { session: unknown; user: unknown } }): {
  lucia: Lucia;
  calls: string[];
} {
  const calls: string[] = [];
  const lucia = {
    sessionCookieName: 'auth_session',
    validateSession: (_id: string) => {
      calls.push('validate');
      return Promise.resolve(opts.validate);
    },
    createSession: (_userId: string, _attrs: unknown) => {
      calls.push('create');
      return Promise.resolve({ id: 'new-session', expiresAt: new Date(Date.now() + 999_999_999) });
    },
    invalidateSession: (_id: string) => {
      calls.push('invalidate');
      return Promise.resolve();
    },
  } as unknown as Lucia;
  return { lucia, calls };
}

/** A session row as Lucia's validateSession returns it: `fresh` says whether it just slid the expiry. */
function session(opts: { fresh: boolean; expiresInMs: number }) {
  return {
    id: 'session-1',
    userId: USER.id,
    fresh: opts.fresh,
    expiresAt: new Date(Date.now() + opts.expiresInMs),
  };
}

/** Run the helper inside a real Hono request so the Set-Cookie header can be asserted. */
async function runWithContext(lucia: Lucia): Promise<{ refreshed: boolean; setCookie: string }> {
  const app = new Hono();
  let refreshed = false;
  app.get('/', async (c) => {
    const result = await validateAndRefreshSession('sid', lucia, c);
    refreshed = result?.refreshed ?? false;
    return c.body(null, 204);
  });
  const res = await app.request('/');
  return { refreshed, setCookie: res.headers.get('set-cookie') ?? '' };
}

describe('validateAndRefreshSession', () => {
  test('an invalid session → null (no refresh attempted)', async () => {
    const { lucia, calls } = makeLucia({ validate: { session: null, user: null } });
    const result = await validateAndRefreshSession('bad', lucia);
    expect(result).toBeNull();
    expect(calls).toEqual(['validate']); // never tried to create/invalidate
  });

  test('an untouched session is returned as-is (refreshed:false, no churn)', async () => {
    const untouched = session({ fresh: false, expiresInMs: CONFIG.auth.sessionDuration });
    const { lucia, calls } = makeLucia({ validate: { session: untouched, user: USER } });
    const result = await validateAndRefreshSession('ok', lucia);
    expect(result?.refreshed).toBe(false);
    expect(result?.session).toBe(untouched as never); // same session object, untouched
    expect(calls).toEqual(['validate']); // NOT create/invalidate — the no-churn invariant
  });

  test('an untouched session emits NO Set-Cookie (one re-issue per half-life, not per request)', async () => {
    const untouched = session({ fresh: false, expiresInMs: CONFIG.auth.sessionDuration });
    const { lucia } = makeLucia({ validate: { session: untouched, user: USER } });
    const { refreshed, setCookie } = await runWithContext(lucia);
    expect(refreshed).toBe(false);
    expect(setCookie).toBe('');
  });

  test('a session Lucia JUST EXTENDED re-issues the cookie with the same id and the NEW expiry', async () => {
    // `fresh: true` is what validateSession sets when it slides expiresAt forward past the half-life.
    // The session id does NOT change — Lucia extended the row rather than minting a new one.
    const extended = session({ fresh: true, expiresInMs: CONFIG.auth.sessionDuration });
    const { lucia, calls } = makeLucia({ validate: { session: extended, user: USER } });
    const { refreshed, setCookie } = await runWithContext(lucia);

    expect(refreshed).toBe(true);
    expect(calls).toEqual(['validate']); // no rotation: the extended row is the session
    expect(setCookie).toContain(`auth_session=${extended.id}`);
    expect(setCookie).toContain(`Max-Age=${CONFIG.auth.cookieMaxAge}`);
    // The cookie's own deadline must be the session's NEW deadline, or the browser still drops it early.
    expect(setCookie).toContain(`Expires=${extended.expiresAt.toUTCString()}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
  });

  test('the extended session is returned unchanged (same id — callers must not see a rotation)', async () => {
    const extended = session({ fresh: true, expiresInMs: CONFIG.auth.sessionDuration });
    const { lucia } = makeLucia({ validate: { session: extended, user: USER } });
    const result = await validateAndRefreshSession('sid', lucia);
    expect(result?.refreshed).toBe(true);
    expect(result?.session.id).toBe(extended.id);
    expect(result?.session.expiresAt).toEqual(extended.expiresAt);
  });
});
