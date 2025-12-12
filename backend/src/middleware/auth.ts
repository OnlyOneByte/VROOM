/**
 * Authentication Middleware
 *
 * Provides authentication guards for protected routes.
 */

import type { MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import type { AuthUser } from '../api/auth/lucia';
import { getLucia } from '../api/auth/lucia';
import { validateAndRefreshSession } from '../api/auth/utils';
import { CONFIG } from '../config';
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
    throw new HTTPException(401, { message: 'Authentication required' });
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
    throw new HTTPException(401, { message: 'Invalid or expired session' });
  }

  c.set('session', { id: result.session.id, expiresAt: result.session.expiresAt });
  c.set('user', result.user);
  return next();
};

/**
 * Optional authentication middleware
 * Sets user context if authenticated, but doesn't throw if not
 */
export const optionalAuth: MiddlewareHandler = async (c, next) => {
  try {
    const lucia = getLucia();
    const sessionId = getCookie(c, lucia.sessionCookieName);

    if (sessionId) {
      const { session, user } = await lucia.validateSession(sessionId);
      if (session && user) {
        c.set('user', user);
        c.set('session', { id: session.id, expiresAt: session.expiresAt });
      }
    }
  } catch (error) {
    logger.error('Optional auth error', { error });
  }
  return next();
};
