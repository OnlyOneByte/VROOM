/**
 * Authentication Middleware
 *
 * Provides authentication guards for protected routes.
 */

import type { MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import type { AuthUser } from '../api/auth/lucia';
import { getLucia } from '../api/auth/lucia';
import { validateAndRefreshSession } from '../api/auth/utils';
import { CONFIG } from '../config';
import { AuthenticationError } from '../errors';
import { logger } from '../utils/logger';

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
    session: { id: string; expiresAt: Date };
  }
}

/**
 * Require authentication middleware
 * Throws 401 if user is not authenticated
 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const lucia = getLucia();
  const sessionId = getCookie(c, lucia.sessionCookieName);

  if (!sessionId) {
    throw new AuthenticationError('Authentication required');
  }

  const result = await validateAndRefreshSession(sessionId, lucia, c);
  if (!result) {
    deleteCookie(c, lucia.sessionCookieName, {
      path: '/',
      secure: CONFIG.env === 'production',
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30,
      sameSite: 'Lax',
    });
    throw new AuthenticationError('Invalid or expired session');
  }

  c.set('session', { id: result.session.id, expiresAt: result.session.expiresAt });
  c.set('user', result.user);
  return next();
};

/**
 * Optional authentication middleware
 * Sets user context if authenticated, but doesn't throw if not
 *
 * Goes through validateAndRefreshSession rather than calling lucia directly, because
 * `lucia.validateSession` is the write that slides a past-half-life session's expiry forward and
 * reports it ONCE via `session.fresh`. This middleware runs on every `/api/*` request ahead of
 * requireAuth, so calling lucia here would consume that one signal and leave the browser cookie
 * stranded on its original login deadline — the session lifetime must be handled by whoever
 * observes the extension first.
 */
export const optionalAuth: MiddlewareHandler = async (c, next) => {
  try {
    const lucia = getLucia();
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
