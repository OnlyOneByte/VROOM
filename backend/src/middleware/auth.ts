import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { type AuthUser, lucia } from '../api/auth/lucia';
import { clearSessionCookie, validateAndRefreshSession } from '../api/auth/utils';
import { AuthenticationError } from '../errors';
import { logger } from '../utils/logger';

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
    session: { id: string; expiresAt: Date };
  }
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const sessionId = getCookie(c, lucia.sessionCookieName);

  if (!sessionId) {
    throw new AuthenticationError('Authentication required');
  }

  const result = await validateAndRefreshSession(sessionId, lucia, c);
  if (!result) {
    clearSessionCookie(c, lucia.sessionCookieName);
    throw new AuthenticationError('Invalid or expired session');
  }

  c.set('session', { id: result.session.id, expiresAt: result.session.expiresAt });
  c.set('user', result.user);
  return next();
};

// Must go through validateAndRefreshSession, not lucia.validateSession. validateSession reports a
// sliding-expiry refresh only once, and this middleware runs on every /api request ahead of requireAuth,
// so calling it here would leave the browser cookie on its original deadline.
export const optionalAuth: MiddlewareHandler = async (c, next) => {
  try {
    const sessionId = getCookie(c, lucia.sessionCookieName);

    if (sessionId) {
      const result = await validateAndRefreshSession(sessionId, lucia, c);
      if (result) {
        c.set('user', result.user);
        c.set('session', { id: result.session.id, expiresAt: result.session.expiresAt });
      }
    }
  } catch (error) {
    logger.error('Optional auth error', { error });
  }
  return next();
};
