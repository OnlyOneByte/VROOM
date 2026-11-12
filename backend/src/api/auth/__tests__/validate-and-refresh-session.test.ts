import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { Lucia } from 'lucia';
import { CONFIG } from '../../../config';
import { validateAndRefreshSession } from '../utils';

const USER = { id: 'u-1' } as { id: string };

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

function session(opts: { fresh: boolean; expiresInMs: number }) {
  return {
    id: 'session-1',
    userId: USER.id,
    fresh: opts.fresh,
    expiresAt: new Date(Date.now() + opts.expiresInMs),
  };
}

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
    expect(calls).toEqual(['validate']);
  });

  test('an untouched session is returned as-is (refreshed:false, no churn)', async () => {
    const untouched = session({ fresh: false, expiresInMs: CONFIG.auth.sessionDuration });
    const { lucia, calls } = makeLucia({ validate: { session: untouched, user: USER } });
    const result = await validateAndRefreshSession('ok', lucia);
    expect(result?.refreshed).toBe(false);
    expect(result?.session).toBe(untouched as never);
    expect(calls).toEqual(['validate']);
  });

  test('an untouched session emits no Set-Cookie', async () => {
    const untouched = session({ fresh: false, expiresInMs: CONFIG.auth.sessionDuration });
    const { lucia } = makeLucia({ validate: { session: untouched, user: USER } });
    const { refreshed, setCookie } = await runWithContext(lucia);
    expect(refreshed).toBe(false);
    expect(setCookie).toBe('');
  });

  test('a session Lucia JUST EXTENDED re-issues the cookie with the same id and the NEW expiry', async () => {
    const extended = session({ fresh: true, expiresInMs: CONFIG.auth.sessionDuration });
    const { lucia, calls } = makeLucia({ validate: { session: extended, user: USER } });
    const { refreshed, setCookie } = await runWithContext(lucia);

    expect(refreshed).toBe(true);
    expect(calls).toEqual(['validate']);
    expect(setCookie).toContain(`auth_session=${extended.id}`);
    expect(setCookie).toContain(`Max-Age=${CONFIG.auth.cookieMaxAge}`);
    expect(setCookie).toContain(`Expires=${extended.expiresAt.toUTCString()}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
  });

  test('the extended session is returned with the same id', async () => {
    const extended = session({ fresh: true, expiresInMs: CONFIG.auth.sessionDuration });
    const { lucia } = makeLucia({ validate: { session: extended, user: USER } });
    const result = await validateAndRefreshSession('sid', lucia);
    expect(result?.refreshed).toBe(true);
    expect(result?.session.id).toBe(extended.id);
    expect(result?.session.expiresAt).toEqual(extended.expiresAt);
  });
});
