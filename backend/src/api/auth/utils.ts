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
