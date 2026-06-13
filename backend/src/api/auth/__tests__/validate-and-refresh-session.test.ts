/**
 * Unit guard for validateAndRefreshSession (C313 — the auth/utils.ts session-rotation core).
 *
 * This security-critical helper (used by BOTH requireAuth middleware and POST /auth/refresh) had ZERO
 * direct tests — only incidental middleware-integration coverage (auth/utils.ts sat at ~40% line). It
 * carries four safety invariants worth pinning against a mockable Lucia (no DB):
 *   1. an invalid/expired session → null (caller treats as unauthenticated).
 *   2. a FRESH session (time-to-expiry ≥ refreshThreshold) → returned as-is, refreshed:false (no needless
 *      rotation churn — every request would otherwise mint+invalidate a session).
 *   3. a NEAR-EXPIRY session → rotates, and CRITICALLY creates the new session BEFORE invalidating the old
 *      (so a createSession failure never leaves the user with no valid session — the ordering the source
 *      comments call out).
 *   4. if rotation's createSession THROWS → FAILS OPEN to the existing session (refreshed:false), never
 *      logs the user out on a transient hiccup.
 *
 * Lucia is injected, so this drives the REAL function with a hand-built mock recording call order.
 */

import { describe, expect, test } from 'bun:test';
import type { Lucia } from 'lucia';
import { CONFIG } from '../../../config';
import { validateAndRefreshSession } from '../utils';

const USER = { id: 'u-1' } as { id: string };

/** Build a mock Lucia exposing only the methods validateAndRefreshSession touches + a call log. */
function makeLucia(opts: {
  validate: { session: unknown; user: unknown };
  createImpl?: () => { id: string; expiresAt: Date };
}): { lucia: Lucia; calls: string[] } {
  const calls: string[] = [];
  const lucia = {
    sessionCookieName: 'auth_session',
    validateSession: (_id: string) => {
      calls.push('validate');
      return Promise.resolve(opts.validate);
    },
    createSession: (_userId: string, _attrs: unknown) => {
      calls.push('create');
      if (opts.createImpl) return Promise.resolve(opts.createImpl());
      return Promise.resolve({ id: 'new-session', expiresAt: new Date(Date.now() + 999_999_999) });
    },
    invalidateSession: (_id: string) => {
      calls.push('invalidate');
      return Promise.resolve();
    },
  } as unknown as Lucia;
  return { lucia, calls };
}

function sessionExpiringIn(ms: number) {
  return { id: 'old-session', expiresAt: new Date(Date.now() + ms) };
}

describe('validateAndRefreshSession (C313)', () => {
  test('an invalid session → null (no refresh attempted)', async () => {
    const { lucia, calls } = makeLucia({ validate: { session: null, user: null } });
    const result = await validateAndRefreshSession('bad', lucia);
    expect(result).toBeNull();
    expect(calls).toEqual(['validate']); // never tried to create/invalidate
  });

  test('a FRESH session is returned as-is (refreshed:false, no rotation)', async () => {
    // Expiry well beyond the refresh threshold → no rotation.
    const session = sessionExpiringIn(CONFIG.auth.refreshThreshold + 60_000);
    const { lucia, calls } = makeLucia({ validate: { session, user: USER } });
    const result = await validateAndRefreshSession('ok', lucia);
    expect(result?.refreshed).toBe(false);
    expect(result?.session).toBe(session as never); // same session object, untouched
    expect(calls).toEqual(['validate']); // NOT create/invalidate — the no-churn invariant
  });

  test('a NEAR-EXPIRY session rotates: creates the NEW session BEFORE invalidating the old', async () => {
    // Expiry inside the threshold window → rotate.
    const session = sessionExpiringIn(CONFIG.auth.refreshThreshold - 60_000);
    const { lucia, calls } = makeLucia({ validate: { session, user: USER } });
    const result = await validateAndRefreshSession('stale', lucia);
    expect(result?.refreshed).toBe(true);
    expect(result?.session.id).toBe('new-session');
    // The ordering invariant: create must precede invalidate (never lose the session if create fails).
    expect(calls).toEqual(['validate', 'create', 'invalidate']);
  });

  test('if rotation createSession THROWS → FAILS OPEN to the existing session (not logged out)', async () => {
    const session = sessionExpiringIn(CONFIG.auth.refreshThreshold - 60_000);
    const { lucia, calls } = makeLucia({
      validate: { session, user: USER },
      createImpl: () => {
        throw new Error('db down');
      },
    });
    const result = await validateAndRefreshSession('stale', lucia);
    // The old session survives — a transient refresh failure must NOT drop a valid login.
    expect(result?.refreshed).toBe(false);
    expect(result?.session).toBe(session as never);
    expect(calls).toEqual(['validate', 'create']); // create attempted + threw; old NOT invalidated
  });
});
