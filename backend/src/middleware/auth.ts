import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AuthUser } from '../api/auth/lucia';
import { clearSessionCookie, validateAndRefreshSession } from '../api/auth/utils';
import { appContext } from '../app-context';
import { AccountPendingError, AuthenticationError } from '../errors';
import { logger } from '../utils/logger';

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
    session: { id: string; expiresAt: Date };
  }
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const sessionId = getCookie(c, appContext().lucia.sessionCookieName);

  if (!sessionId) {
    throw new AuthenticationError('Authentication required');
  }

  const result = await validateAndRefreshSession(sessionId, appContext().lucia, c);
  if (!result) {
    clearSessionCookie(c, appContext().lucia.sessionCookieName);
    throw new AuthenticationError('Invalid or expired session');
  }

  c.set('session', { id: result.session.id, expiresAt: result.session.expiresAt });
  c.set('user', result.user);
  if (result.user.pendingApprovalAt && !PENDING_ALLOWED.has(`${c.req.method} ${c.req.path}`)) {
    throw new AccountPendingError();
  }
  return next();
};

const PENDING_ALLOWED = new Set([
  'GET /api/v1/auth/me',
  'POST /api/v1/auth/logout',
  'GET /api/v1/auth/capabilities',
]);

// Use validateAndRefreshSession: lucia.validateSession refreshes the sliding expiry only once per request.
export const optionalAuth: MiddlewareHandler = async (c, next) => {
  try {
    const sessionId = getCookie(c, appContext().lucia.sessionCookieName);

    if (sessionId) {
      const result = await validateAndRefreshSession(sessionId, appContext().lucia, c);
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
