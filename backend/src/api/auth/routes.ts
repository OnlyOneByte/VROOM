import { generateCodeVerifier, generateState } from 'arctic';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import { users } from '../../db/schema';
import { getLucia, google } from './lucia';
import { validateAndRefreshSession } from './utils';

const routes = new Hono();

/**
 * OAuth State Storage
 *
 * IMPORTANT: This is an in-memory store and will be lost on server restart.
 *
 * For production deployments:
 * - Use Redis for distributed systems
 * - Use database with TTL for single-instance deployments
 * - Consider encrypted cookies for stateless approach
 *
 * Current implementation is suitable for:
 * - Development environments
 * - Single-instance deployments with infrequent restarts
 * - Low-traffic applications where occasional OAuth retry is acceptable
 */
const oauthStateStore = new Map<string, { codeVerifier: string; createdAt: number }>();

// Clean up expired states (older than 10 minutes)
const cleanupExpiredStates = () => {
  const now = Date.now();
  for (const [state, data] of oauthStateStore.entries()) {
    if (now - data.createdAt > CONFIG.auth.oauthStateExpiry) {
      oauthStateStore.delete(state);
    }
  }
};

// Google OAuth login initiation
routes.get('/login/google', async (c) => {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = await google.createAuthorizationURL(state, codeVerifier, [
    'openid',
    'profile',
    'email',
    'https://www.googleapis.com/auth/drive.file', // Access only files created by this app
  ]);

  // Add access_type=offline to get refresh token
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');

  // Store state and code verifier in memory (for development)
  // In production, use Redis or a database with TTL
  oauthStateStore.set(state, {
    codeVerifier,
    createdAt: Date.now(),
  });

  cleanupExpiredStates();
  return c.redirect(url.toString());
});

routes.get('/callback/google', async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    throw new HTTPException(400, { message: 'Missing code or state parameter' });
  }

  const storedData = oauthStateStore.get(state);
  if (!storedData) {
    throw new HTTPException(400, {
      message: 'Invalid or expired state. Please try logging in again.',
    });
  }

  const { codeVerifier } = storedData;
  oauthStateStore.delete(state);

  // Exchange code for tokens
  const tokens = await google.validateAuthorizationCode(code, codeVerifier);

  // Get user info from Google
  const googleUserResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      Authorization: `Bearer ${tokens.accessToken()}`,
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
  const db = getDb();

  // Check if user exists by providerId (handles both old and new user records)
  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.providerId, googleUser.sub))
    .limit(1);

  let userId: string;

  if (existingUser.length === 0) {
    // Create new user - use providerId as the userId for consistency
    // This ensures the same OAuth account always gets the same userId
    userId = `google_${googleUser.sub}`;
    await db.insert(users).values({
      id: userId,
      email: googleUser.email,
      displayName: googleUser.name,
      provider: 'google',
      providerId: googleUser.sub,
      googleRefreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : null,
    });
  } else {
    // Update existing user with fresh refresh token if available
    userId = existingUser[0].id;
    if (tokens.hasRefreshToken()) {
      await db
        .update(users)
        .set({
          googleRefreshToken: tokens.refreshToken(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    }
  }

  // Create session
  const lucia = getLucia();
  const session = await lucia.createSession(userId, {});

  setCookie(c, lucia.sessionCookieName, session.id, {
    path: '/',
    secure: CONFIG.env === 'production',
    httpOnly: true,
    maxAge: CONFIG.auth.cookieMaxAge,
    expires: session.expiresAt,
    sameSite: 'Lax',
  });

  // Redirect to frontend
  return c.redirect(`${CONFIG.frontend.url}/dashboard`);
});

// Get current user
routes.get('/me', async (c) => {
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
    success: true,
    data: {
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
    },
  });
});

// Logout
routes.post('/logout', async (c) => {
  const lucia = getLucia();
  const sessionId = getCookie(c, lucia.sessionCookieName);

  if (sessionId) {
    await lucia.invalidateSession(sessionId);
  }

  deleteCookie(c, lucia.sessionCookieName, {
    path: '/',
    secure: CONFIG.env === 'production',
    httpOnly: true,
    maxAge: CONFIG.auth.cookieMaxAge,
    sameSite: 'Lax',
  });

  return c.json({ success: true, message: 'Logged out successfully' });
});

// Refresh session (extend session if valid)
routes.post('/refresh', async (c) => {
  const lucia = getLucia();
  const sessionId = getCookie(c, lucia.sessionCookieName);

  if (!sessionId) {
    throw new HTTPException(401, { message: 'No session found' });
  }

  const result = await validateAndRefreshSession(sessionId, lucia, c);

  if (!result) {
    throw new HTTPException(401, { message: 'Invalid session' });
  }

  return c.json({
    success: true,
    data: {
      user: {
        id: result.user.id,
        email: result.user.email,
        displayName: result.user.displayName,
        provider: result.user.provider,
      },
      session: {
        id: result.session.id,
        expiresAt: result.session.expiresAt,
      },
    },
  });
});

// Re-authenticate with Google (force new OAuth flow to get fresh tokens)
routes.get('/reauth/google', async (c) => {
  const lucia = getLucia();
  const sessionId = getCookie(c, lucia.sessionCookieName);

  if (!sessionId) {
    throw new HTTPException(401, { message: 'No session found' });
  }

  const { session } = await lucia.validateSession(sessionId);

  if (!session) {
    throw new HTTPException(401, { message: 'Invalid session' });
  }

  // Generate new OAuth state and code verifier
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = await google.createAuthorizationURL(state, codeVerifier, [
    'openid',
    'profile',
    'email',
    'https://www.googleapis.com/auth/drive', // For Google Drive integration (full access needed to create folders)
  ]);

  // Add prompt=consent to force re-consent and get new refresh token
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('access_type', 'offline');

  // Store state and code verifier
  oauthStateStore.set(state, {
    codeVerifier,
    createdAt: Date.now(),
  });

  // Clean up old states
  cleanupExpiredStates();

  return c.redirect(url.toString());
});

export { routes };
