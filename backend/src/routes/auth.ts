import { createId } from '@paralleldrive/cuid2';
import { generateCodeVerifier, generateState } from 'arctic';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';

import { users } from '../db/schema';
import { google } from '../lib/auth/lucia';
import { getLucia } from '../lib/auth/lucia-provider.js';
import { config } from '../lib/config';
import { databaseService } from '../lib/database';

const auth = new Hono();

// Temporary storage for OAuth state (in production, use Redis or database)
const oauthStateStore = new Map<string, { codeVerifier: string; createdAt: number }>();

// Clean up expired states (older than 10 minutes)
const cleanupExpiredStates = () => {
  const now = Date.now();
  const tenMinutes = 10 * 60 * 1000;
  for (const [state, data] of oauthStateStore.entries()) {
    if (now - data.createdAt > tenMinutes) {
      oauthStateStore.delete(state);
    }
  }
};

// Google OAuth login initiation
auth.get('/login/google', async (c) => {
  try {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const url = await google.createAuthorizationURL(state, codeVerifier, {
      scopes: [
        'openid',
        'profile',
        'email',
        'https://www.googleapis.com/auth/drive.file', // For Google Drive integration
      ],
    });

    // Store state and code verifier in memory (for development)
    // In production, use Redis or a database with TTL
    oauthStateStore.set(state, {
      codeVerifier,
      createdAt: Date.now(),
    });

    // Clean up old states
    cleanupExpiredStates();

    return c.redirect(url.toString());
  } catch (error) {
    console.error('OAuth initiation error:', error);
    throw new HTTPException(500, { message: 'Failed to initiate OAuth flow' });
  }
});

// Google OAuth callback
auth.get('/callback/google', async (c) => {
  try {
    const url = new URL(c.req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) {
      throw new HTTPException(400, { message: 'Missing code or state parameter' });
    }

    // Verify state and get code verifier from memory store
    const storedData = oauthStateStore.get(state);

    if (!storedData) {
      throw new HTTPException(400, {
        message: 'Invalid or expired state parameter. Please try logging in again.',
      });
    }

    const { codeVerifier } = storedData;

    // Clean up used state
    oauthStateStore.delete(state);

    // Exchange code for tokens
    const tokens = await google.validateAuthorizationCode(code, codeVerifier);

    // Get user info from Google
    const googleUserResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    });

    if (!googleUserResponse.ok) {
      throw new HTTPException(500, { message: 'Failed to fetch user info from Google' });
    }

    const googleUser = (await googleUserResponse.json()) as {
      sub: string;
      email: string;
      name: string;
      picture?: string;
    };

    // Get database instance
    const db = databaseService.getDatabase();

    // Check if user exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.providerId, googleUser.sub))
      .limit(1);

    let userId: string;

    if (existingUser.length === 0) {
      // Create new user
      const newUserId = createId();
      await db.insert(users).values({
        id: newUserId,
        email: googleUser.email,
        displayName: googleUser.name,
        provider: 'google',
        providerId: googleUser.sub,
        googleRefreshToken: tokens.refreshToken || null,
      });
      userId = newUserId;
    } else {
      // Update existing user with fresh refresh token if available
      userId = existingUser[0].id;
      if (tokens.refreshToken) {
        await db
          .update(users)
          .set({
            googleRefreshToken: tokens.refreshToken,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));
      }
    }

    // Create session
    const lucia = getLucia();
    const session = await lucia.createSession(userId, {});

    // Set session cookie
    setCookie(c, lucia.sessionCookieName, session.id, {
      path: '/',
      secure: config.env === 'production',
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30, // 30 days
      expires: session.expiresAt,
      sameSite: 'Lax',
    });

    // Redirect to frontend
    const frontendUrl =
      process.env.NODE_ENV === 'production' ? 'https://your-domain.com' : 'http://localhost:5173';

    return c.redirect(`${frontendUrl}/vehicles`);
  } catch (error) {
    console.error('OAuth callback error:', error);

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Authentication failed' });
  }
});

// Get current user
auth.get('/me', async (c) => {
  try {
    const lucia = getLucia();
    const sessionId = getCookie(c, lucia.sessionCookieName);

    if (!sessionId) {
      throw new HTTPException(401, { message: 'No session found' });
    }

    const { session, user } = await lucia.validateSession(sessionId);

    if (!session) {
      throw new HTTPException(401, { message: 'Invalid session' });
    }

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        provider: user.provider,
      },
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Failed to get user info' });
  }
});

// Logout
auth.post('/logout', async (c) => {
  try {
    const lucia = getLucia();
    const sessionId = getCookie(c, lucia.sessionCookieName);

    if (sessionId) {
      await lucia.invalidateSession(sessionId);
    }

    deleteCookie(c, lucia.sessionCookieName, {
      path: '/',
      secure: config.env === 'production',
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30,
      sameSite: 'Lax',
    });

    return c.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    throw new HTTPException(500, { message: 'Failed to logout' });
  }
});

// Refresh session (extend session if valid)
auth.post('/refresh', async (c) => {
  try {
    const lucia = getLucia();
    const sessionId = getCookie(c, lucia.sessionCookieName);

    if (!sessionId) {
      throw new HTTPException(401, { message: 'No session found' });
    }

    const { session, user } = await lucia.validateSession(sessionId);

    if (!session) {
      throw new HTTPException(401, { message: 'Invalid session' });
    }

    // If session is fresh (not close to expiry), return current session
    const now = new Date();
    const sessionExpiry = new Date(session.expiresAt);
    const timeUntilExpiry = sessionExpiry.getTime() - now.getTime();
    const oneDay = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    if (timeUntilExpiry > oneDay) {
      return c.json({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          provider: user.provider,
        },
        session: {
          id: session.id,
          expiresAt: session.expiresAt,
        },
      });
    }

    // Create new session - create first to avoid losing session if creation fails
    const newSession = await lucia.createSession(user.id, {});

    setCookie(c, lucia.sessionCookieName, newSession.id, {
      path: '/',
      secure: config.env === 'production',
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30, // 30 days
      expires: newSession.expiresAt,
      sameSite: 'Lax',
    });

    // Only invalidate old session after new one is successfully created
    await lucia.invalidateSession(session.id);

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        provider: user.provider,
      },
      session: {
        id: newSession.id,
        expiresAt: newSession.expiresAt,
      },
    });
  } catch (error) {
    console.error('Refresh session error:', error);

    if (error instanceof HTTPException) {
      throw error;
    }

    throw new HTTPException(500, { message: 'Failed to refresh session' });
  }
});

export { auth };
