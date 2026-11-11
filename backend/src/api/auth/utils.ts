/**
 * Authentication Utilities
 *
 * Shared authentication helper functions to reduce duplication
 * between middleware and route handlers.
 */

import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import type { Lucia, Session, User } from 'lucia';
import { CONFIG } from '../../config';
import { logger } from '../../utils/logger';

export interface SessionRefreshResult {
  session: Session;
  user: User;
  refreshed: boolean;
}

/** The OAuth-state entries stored while a login/link/provider flow is in flight. */
export interface OAuthStateEntry {
  codeVerifier?: string;
  createdAt: number;
  returnTo?: string;
  userId?: string;
  flowType?: 'provider' | 'auth-link';
  nonce?: string;
}

/**
 * SINGLE-USE consumption of an OAuth `state` from the in-flight store, with flow isolation.
 *
 * The OAuth `state` parameter is the CSRF token of the login/link/provider round-trip: it must be
 * (1) single-use — a replayed callback can't re-consume it; (2) flow-isolated — a state minted for the
 * login flow (no `flowType`) must NOT be accepted by the link/provider callback and vice-versa, else a
 * fixation/confusion attack could cross flows; (3) anti-fixation — a mismatched/unknown state is DELETED
 * on the failed lookup, so a planted value can't linger. This was previously inlined byte-near-identically
 * in `validateLoginState`/`validateLinkState` and pinned only by brittle SOURCE-STRING scans
 * (auth-routes.property.test.ts); extracting it makes the behavior unit-testable (the pattern). The
 * provider flow keeps its own inline consume (it adds a PKCE codeVerifier assertion) — same contract.
 *
 * @param expectedFlow the `flowType` this caller requires: `undefined` for the LOGIN flow (entry must
 *  have NO flowType), or `'auth-link'`/`'provider'` for those flows.
 * @returns the entry on a valid single-use match, else null. EITHER WAY the state is deleted from the
 *  store (consumed on success; evicted on any failure) — never replayable.
 */
export function consumeOAuthState(
  store: Map<string, OAuthStateEntry>,
  stateParam: string | null,
  expectedFlow: OAuthStateEntry['flowType']
): OAuthStateEntry | null {
  const entry = stateParam ? store.get(stateParam) : undefined;
  // Login flow: entry must have NO flowType. Link/provider: flowType must match exactly.
  const flowOk = expectedFlow ? entry?.flowType === expectedFlow : !entry?.flowType;
  if (!stateParam || !entry || !flowOk) {
    if (stateParam) store.delete(stateParam);
    return null;
  }
  store.delete(stateParam);
  return entry;
}

/**
 * Validate a session and, when Lucia has just slid its server-side expiry forward, re-issue the
 * browser cookie so the two deadlines stay together.
 *
 * `lucia.validateSession` is not a pure read: once a session passes its half-life it writes a new
 * `expiresAt` and reports `fresh: true`. The browser cookie, by contrast, is written ONLY at login
 * with a fixed `maxAge`. Nothing else re-writes it, so without this re-issue an actively-used login
 * expires on its original deadline while the server-side session is still perfectly valid — the user
 * is signed out mid-use and `POST /auth/refresh` cannot prevent it, because it runs this same code.
 *
 * `fresh` is the only signal that does not lie about when the DB expiry moved, and it is
 * self-limiting: Lucia flips it in the same call that writes the row, so it is true at most once per
 * half-life window — one `Set-Cookie` per window, not one per request. The session id is REUSED
 * (Lucia extended that row; it did not mint a new one), so there is no rotation to mirror here.
 *
 * Used by both the requireAuth middleware and the POST /auth/refresh route.
 */
export async function validateAndRefreshSession(
  sessionId: string,
  lucia: Lucia,
  c?: Context
): Promise<SessionRefreshResult | null> {
  const { session, user } = await lucia.validateSession(sessionId);

  if (!session || !user) {
    return null;
  }

  if (!session.fresh) {
    return {
      session,
      user,
      refreshed: false,
    };
  }

  // Keep this attribute block literal and identical to the login cookie — a session cookie written
  // with weaker attributes on one auth path is invisible to every happy-path test.
  if (c) {
    setCookie(c, lucia.sessionCookieName, session.id, {
      path: '/',
      secure: CONFIG.env === 'production',
      httpOnly: true,
      maxAge: CONFIG.auth.cookieMaxAge,
      expires: session.expiresAt,
      sameSite: 'Lax',
    });
  }

  logger.info('Session cookie re-issued for an extended session', {
    userId: user.id,
    sessionId: session.id,
    expiresAt: session.expiresAt.toISOString(),
  });

  return {
    session,
    user,
    refreshed: true,
  };
}
