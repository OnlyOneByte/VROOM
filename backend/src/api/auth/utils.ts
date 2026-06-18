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
 * SINGLE-USE consumption of an OAuth `state` from the in-flight store, with flow isolation (C39).
 *
 * The OAuth `state` parameter is the CSRF token of the login/link/provider round-trip: it must be
 * (1) single-use — a replayed callback can't re-consume it; (2) flow-isolated — a state minted for the
 * login flow (no `flowType`) must NOT be accepted by the link/provider callback and vice-versa, else a
 * fixation/confusion attack could cross flows; (3) anti-fixation — a mismatched/unknown state is DELETED
 * on the failed lookup, so a planted value can't linger. This was previously inlined byte-near-identically
 * in `validateLoginState`/`validateLinkState` and pinned only by brittle SOURCE-STRING scans
 * (auth-routes.property.test.ts); extracting it makes the behavior unit-testable (the C38 pattern). The
 * provider flow keeps its own inline consume (it adds a PKCE codeVerifier assertion) — same contract.
 *
 * @param expectedFlow  the `flowType` this caller requires: `undefined` for the LOGIN flow (entry must
 *                      have NO flowType), or `'auth-link'`/`'provider'` for those flows.
 * @returns the entry on a valid single-use match, else null. EITHER WAY the state is deleted from the
 *          store (consumed on success; evicted on any failure) — never replayable.
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
 * Validate session and refresh if close to expiry
 *
 * This function handles the common pattern of:
 * 1. Validating a session
 * 2. Checking if it's close to expiry
 * 3. Creating a new session if needed
 * 4. Invalidating the old session
 *
 * Used by both requireAuth middleware and POST /auth/refresh route
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

  // Check if session is close to expiry
  const now = new Date();
  const sessionExpiry = new Date(session.expiresAt);
  const timeUntilExpiry = sessionExpiry.getTime() - now.getTime();

  // If session is fresh, return as-is
  if (timeUntilExpiry >= CONFIG.auth.refreshThreshold) {
    return {
      session,
      user,
      refreshed: false,
    };
  }

  // Session is close to expiry, refresh it
  try {
    // Create new session first to avoid losing session if creation fails
    const newSession = await lucia.createSession(user.id, {});

    // Invalidate old session immediately after creating new one
    // This prevents having two active sessions if cookie update fails
    await lucia.invalidateSession(session.id);

    // Update cookie if context is provided (after both DB operations succeed)
    if (c) {
      setCookie(c, lucia.sessionCookieName, newSession.id, {
        path: '/',
        secure: CONFIG.env === 'production',
        httpOnly: true,
        maxAge: CONFIG.auth.cookieMaxAge,
        expires: newSession.expiresAt,
        sameSite: 'Lax',
      });
    }

    logger.info('Session refreshed', {
      userId: user.id,
      oldSessionId: session.id,
      newSessionId: newSession.id,
    });

    return {
      session: newSession,
      user,
      refreshed: true,
    };
  } catch (error) {
    logger.warn('Session refresh failed, keeping existing session', { error });
    // Return existing session if refresh fails
    return {
      session,
      user,
      refreshed: false,
    };
  }
}
