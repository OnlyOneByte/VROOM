import { generateCodeVerifier, generateState } from 'arctic';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { CONFIG } from '../config';
import { getDb } from '../db/connection';
import { users } from '../db/schema';
import { getLucia, google } from './lucia';

const routes = new Hono();

// Temporary storage for OAuth state (in production, use Redis or database)
const oauthStateStore = new Map<string, { codeVerifier: string; createdAt: number }>();

// Clean up expired states (older than 10 minutes)
const cleanupExpiredStates = () => {
  const now = Date.now();
  for (const [state, data] of oauthStateStore.entries()) {
    if (now - data.createdAt > CONFIG.auth.session.oauthStateExpiry) {
      oauthStateStore.delete(state);
    }
  }
};

// Google OAuth login initiation
routes.get('/login/google', async (c) => {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = await google.createAuthorizationURL(state, codeVerifier, {
    scopes: [
      'openid',
      'profile',
      'email',
      'https://www.googleapis.com/auth/drive', // For Google Drive integration (full access needed to create folders)
    ],
  });

  // Add access_type=offline to get refresh token
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');

  // Store state and code verifier in memory (for development)
  // In production, use Redis or a database with TTL
  oauthStateStore.set(state, {
    codeVerifier,
    createdAt: Date.now(),
  });

  // Clean up old states
  cleanupExpiredStates();

  return c.redirect(url.toString());
});

// Google OAuth callback
routes.get('/callback/google', async (c) => {
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
      googleRefreshToken: tokens.refreshToken || null,
    });
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

  // TODO: Check for existing Google Drive backups and auto-enable if found
  // This requires extracting GoogleSyncService from the old sync.ts file

  // Create session
  const lucia = getLucia();
  const session = await lucia.createSession(userId, {});

  // Set session cookie
  setCookie(c, lucia.sessionCookieName, session.id, {
    path: '/',
    secure: CONFIG.env === 'production',
    httpOnly: true,
    maxAge: CONFIG.auth.session.cookieMaxAge,
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

  // TODO: Check for existing Google Drive backups and auto-enable if found
  // This requires extracting GoogleSyncService from the old sync.ts file

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
    maxAge: CONFIG.auth.session.cookieMaxAge,
    sameSite: 'Lax',
  });

  return c.json({ message: 'Logged out successfully' });
});

// Refresh session (extend session if valid)
routes.post('/refresh', async (c) => {
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

  if (timeUntilExpiry > CONFIG.auth.session.refreshThreshold) {
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
    secure: CONFIG.env === 'production',
    httpOnly: true,
    maxAge: CONFIG.auth.session.cookieMaxAge,
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
  const url = await google.createAuthorizationURL(state, codeVerifier, {
    scopes: [
      'openid',
      'profile',
      'email',
      'https://www.googleapis.com/auth/drive', // For Google Drive integration (full access needed to create folders)
    ],
  });

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
