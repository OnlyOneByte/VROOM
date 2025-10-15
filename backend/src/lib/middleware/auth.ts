import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AuthUser } from '../auth/lucia';
import { getLucia } from '../auth/lucia-provider.js';

// Extend Hono context to include user
declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
    session: {
      id: string;
      expiresAt: Date;
    };
  }
}

// Authentication middleware - requires valid session
export const requireAuth: MiddlewareHandler = async (c, next) => {
  try {
    const lucia = getLucia();
    const sessionId = lucia.readSessionCookie(c.req.header('Cookie') || '');

    if (!sessionId) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }

    const { session, user } = await lucia.validateSession(sessionId);

    if (!session || !user) {
      // Invalid session, clear cookie
      const sessionCookie = lucia.createBlankSessionCookie();
      c.header('Set-Cookie', sessionCookie.serialize());
      throw new HTTPException(401, { message: 'Invalid or expired session' });
    }

    // If session is close to expiry, refresh it
    const now = new Date();
    const sessionExpiry = new Date(session.expiresAt);
    const timeUntilExpiry = sessionExpiry.getTime() - now.getTime();
    const oneDay = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    if (timeUntilExpiry < oneDay) {
      // Refresh session
      await lucia.invalidateSession(session.id);
      const newSession = await lucia.createSession(user.id, {});
      const sessionCookie = lucia.createSessionCookie(newSession.id);
      c.header('Set-Cookie', sessionCookie.serialize());

      // Update session in context
      c.set('session', {
        id: newSession.id,
        expiresAt: newSession.expiresAt,
      });
    } else {
      c.set('session', {
        id: session.id,
        expiresAt: session.expiresAt,
      });
    }

    // Set user in context
    c.set('user', user);

    return next();
  } catch (error) {
    console.error('Auth middleware error:', error);

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Authentication error' });
  }
};

// Optional authentication middleware - sets user if session exists but doesn't require it
export const optionalAuth: MiddlewareHandler = async (c, next) => {
  try {
    const lucia = getLucia();
    const sessionId = lucia.readSessionCookie(c.req.header('Cookie') || '');

    if (sessionId) {
      const { session, user } = await lucia.validateSession(sessionId);

      if (session && user) {
        c.set('user', user);
        c.set('session', {
          id: session.id,
          expiresAt: session.expiresAt,
        });
      }
    }

    return next();
  } catch (error) {
    console.error('Optional auth middleware error:', error);
    // Don't throw error for optional auth, just continue without user
    return next();
  }
};
