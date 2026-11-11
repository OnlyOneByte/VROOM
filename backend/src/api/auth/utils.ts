import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import type { Lucia, Session, User } from 'lucia';
import { CONFIG } from '../../config';
import { logger } from '../../utils/logger';

export interface SessionRefreshResult {
  session: Session;
  user: User;
  refreshed: boolean;
}

export interface OAuthStateEntry {
  codeVerifier?: string;
  createdAt: number;
  returnTo?: string;
  userId?: string;
  flowType?: 'provider' | 'auth-link';
  nonce?: string;
}

// Shared by every write and delete: a browser only clears a cookie whose attributes match the write.
function sessionCookieOptions(): CookieOptions {
  return {
    path: '/',
    secure: CONFIG.env === 'production',
    httpOnly: true,
    maxAge: CONFIG.auth.cookieMaxAge,
    sameSite: 'Lax',
  };
}

export function setSessionCookie(
  c: Context,
  cookieName: string,
  session: Pick<Session, 'id' | 'expiresAt'>
): void {
  setCookie(c, cookieName, session.id, { ...sessionCookieOptions(), expires: session.expiresAt });
}

export function clearSessionCookie(c: Context, cookieName: string): void {
  deleteCookie(c, cookieName, sessionCookieOptions());
}

/**
 * Single-use, flow-isolated consume of an OAuth state. The entry is deleted whether or not it
 * matches, so a failed or replayed state cannot be retried. `expectedFlow` is `undefined` for the
 * login flow, which requires an entry with no flowType.
 */
export function consumeOAuthState(
  store: Map<string, OAuthStateEntry>,
  stateParam: string | null,
  expectedFlow: OAuthStateEntry['flowType']
): OAuthStateEntry | null {
  const entry = stateParam ? store.get(stateParam) : undefined;
  const flowOk = expectedFlow ? entry?.flowType === expectedFlow : !entry?.flowType;
  if (!stateParam || !entry || !flowOk) {
    if (stateParam) store.delete(stateParam);
    return null;
  }
  store.delete(stateParam);
  return entry;
}

/**
 * Validates a session and re-issues the browser cookie when Lucia extends the session. Lucia moves
 * the DB expiry during validateSession (signalled by `fresh`), but the cookie is only written at
 * login, so without this the browser drops a still-valid session on the original deadline.
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

  if (c) setSessionCookie(c, lucia.sessionCookieName, session);

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
