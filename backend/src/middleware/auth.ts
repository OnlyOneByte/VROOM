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

// Use validateAndRefreshSession: lucia.validateSession refreshes the sliding expiry only once per request.
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
