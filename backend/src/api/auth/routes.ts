import { generateCodeVerifier, generateState } from 'arctic';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import { userProviders, users } from '../../db/schema';
import { requireAuth } from '../../middleware';
import { encrypt } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { storePending } from '../../utils/pending-credentials';
import { getLucia, google, googleProvider } from './lucia';
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
const oauthStateStore = new Map<
  string,
  {
    codeVerifier: string;
    createdAt: number;
    returnTo?: string;
    // Provider flow fields (absent for login flow)
    userId?: string;
    flowType?: 'provider';
    providerId?: string;
    nonce?: string;
  }
>();

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
  ]);

  // Account picker for returning users — no offline access needed for login
  url.searchParams.set('prompt', 'select_account');

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

  const { codeVerifier, returnTo } = storedData;
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
    });
  } else {
    // Existing user — no refresh token to update since login flow no longer requests offline access
    userId = existingUser[0].id;
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

  // Redirect to frontend — use returnTo if provided (e.g., reauth from provider form),
  // otherwise default to dashboard
  const redirectPath = returnTo?.startsWith('/') ? returnTo : '/dashboard';
  return c.redirect(`${CONFIG.frontend.url}${redirectPath}`);
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

// Provider OAuth initiation — isolated from login flow (Task 5.1)
routes.get('/providers/connect/google', requireAuth, async (c) => {
  const user = c.get('user');
  const returnTo = c.req.query('returnTo');
  const nonce = c.req.query('nonce');

  if (!returnTo || !nonce) {
    throw new HTTPException(400, { message: 'Missing required parameters: returnTo, nonce' });
  }

  const providerId = c.req.query('providerId') ?? undefined;
  const email = c.req.query('email') ?? undefined;

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = await googleProvider.createAuthorizationURL(state, codeVerifier, [
    'openid',
    'profile',
    'email',
    'https://www.googleapis.com/auth/drive.file',
  ]);

  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  if (email) {
    url.searchParams.set('login_hint', email);
  }

  oauthStateStore.set(state, {
    codeVerifier,
    createdAt: Date.now(),
    returnTo,
    nonce,
    userId: user.id,
    flowType: 'provider',
    providerId,
  });

  cleanupExpiredStates();
  return c.redirect(url.toString());
});

// --- Provider OAuth callback helpers ---

async function validateProviderSession(
  sessionId: string | undefined
): Promise<{ user: { id: string }; session: { id: string } } | null> {
  if (!sessionId) return null;
  const lucia = getLucia();
  const { session, user } = await lucia.validateSession(sessionId);
  if (!session || !user) return null;
  return { user, session };
}

async function exchangeProviderTokens(code: string, codeVerifier: string) {
  const tokens = await googleProvider.validateAuthorizationCode(code, codeVerifier);
  if (!tokens.hasRefreshToken()) return { tokens, refreshToken: null, email: null };

  const email = await fetchGoogleEmail(tokens.accessToken());
  return { tokens, refreshToken: tokens.refreshToken(), email };
}

async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  const resp = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { email: string };
  return data.email;
}

async function updateExistingProvider(
  providerId: string,
  userId: string,
  refreshToken: string,
  email: string
): Promise<void> {
  const db = getDb();
  const existing = await db
    .select()
    .from(userProviders)
    .where(and(eq(userProviders.id, providerId), eq(userProviders.userId, userId)))
    .limit(1);

  if (!existing[0]) return;

  const encryptedCredentials = encrypt(JSON.stringify({ refreshToken }));
  const existingConfig = (existing[0].config as Record<string, unknown>) ?? {};
  await db
    .update(userProviders)
    .set({
      credentials: encryptedCredentials,
      config: { ...existingConfig, accountEmail: email },
      updatedAt: new Date(),
    })
    .where(eq(userProviders.id, providerId));
}

interface ProviderCallbackState {
  codeVerifier: string;
  returnTo: string;
  userId: string;
  nonce: string;
  providerId?: string;
}

function resolveProviderState(
  stateParam: string | null,
  code: string | null
): { state: ProviderCallbackState; returnTo: string } | { error: string; returnTo: string } {
  const storedData = stateParam ? oauthStateStore.get(stateParam) : undefined;
  const returnTo = storedData?.returnTo ?? '/settings/providers';

  // Handle OAuth cancellation (user denied consent)
  if (!code) {
    if (stateParam) oauthStateStore.delete(stateParam);
    return { error: 'cancelled', returnTo };
  }

  if (!stateParam || !storedData || storedData.flowType !== 'provider') {
    if (stateParam) oauthStateStore.delete(stateParam);
    return { error: 'invalid_state', returnTo };
  }

  oauthStateStore.delete(stateParam);
  return {
    state: {
      codeVerifier: storedData.codeVerifier,
      returnTo,
      userId: storedData.userId ?? '',
      nonce: storedData.nonce ?? '',
      providerId: storedData.providerId,
    },
    returnTo,
  };
}

async function validateProviderCsrf(
  sessionId: string | undefined,
  expectedUserId: string
): Promise<{ userId: string } | null> {
  const authResult = await validateProviderSession(sessionId);
  if (!authResult) return null;
  if (authResult.user.id !== expectedUserId) return null;
  return { userId: authResult.user.id };
}

// Provider OAuth callback — never touches the session (Task 5.2)
routes.get('/callback/provider/google', async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const frontendRedirect = (path: string) => `${CONFIG.frontend.url}${path}`;

  const resolved = resolveProviderState(stateParam, code);
  if ('error' in resolved) {
    return c.redirect(frontendRedirect(`${resolved.returnTo}?provider_error=${resolved.error}`));
  }

  const { state } = resolved;
  // code is guaranteed non-null here — resolveProviderState returns error if !code
  const authCode = code as string;

  // Validate session + CSRF: user must be authenticated and match state userId
  const lucia = getLucia();
  const sessionId = getCookie(c, lucia.sessionCookieName);
  const validated = await validateProviderCsrf(sessionId, state.userId);
  if (!validated) {
    const authResult = await validateProviderSession(sessionId);
    if (!authResult) {
      return c.redirect(`${CONFIG.frontend.url}/auth/login`);
    }
    logger.warn('Provider OAuth CSRF mismatch', {
      sessionUserId: authResult.user.id,
      stateUserId: state.userId,
    });
    return c.redirect(frontendRedirect(`${state.returnTo}?provider_error=session_mismatch`));
  }

  // Exchange code for tokens and fetch email
  let result: Awaited<ReturnType<typeof exchangeProviderTokens>>;
  try {
    result = await exchangeProviderTokens(authCode, state.codeVerifier);
  } catch (err) {
    logger.error('Provider OAuth token exchange failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.redirect(frontendRedirect(`${state.returnTo}?provider_error=exchange_failed`));
  }

  if (!result.refreshToken || !result.email) {
    const errorType = !result.refreshToken ? 'no_refresh_token' : 'exchange_failed';
    return c.redirect(frontendRedirect(`${state.returnTo}?provider_error=${errorType}`));
  }

  if (state.providerId) {
    await updateExistingProvider(
      state.providerId,
      validated.userId,
      result.refreshToken,
      result.email
    );
  } else {
    storePending(validated.userId, state.nonce, result.refreshToken, result.email);
  }

  return c.redirect(
    frontendRedirect(
      `${state.returnTo}?provider_connected=true&nonce=${encodeURIComponent(state.nonce)}`
    )
  );
});

export { routes };
