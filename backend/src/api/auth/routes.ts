import { generateCodeVerifier, generateState } from 'arctic';
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import { userProviders, users } from '../../db/schema';
import { rateLimiter, requireAuth } from '../../middleware';
import { encrypt } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { storePending } from '../../utils/pending-credentials';
import { authProviderRepository } from './auth-provider-repository';
import { getLucia, googleProvider } from './lucia';
import { getEnabledProvider, getEnabledProviders, getProvider } from './providers/registry';
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
    codeVerifier?: string;
    createdAt: number;
    returnTo?: string;
    // Provider flow fields (absent for login flow)
    userId?: string;
    flowType?: 'provider' | 'auth-link';
    providerId?: string;
    nonce?: string;
  }
>();

// Clean up expired states (older than 10 minutes)
const MAX_STATE_STORE_SIZE = 1000;
const cleanupExpiredStates = () => {
  const now = Date.now();
  for (const [state, data] of oauthStateStore.entries()) {
    if (now - data.createdAt > CONFIG.auth.oauthStateExpiry) {
      oauthStateStore.delete(state);
    }
  }
  // Hard cap: if still over limit after expiry cleanup, evict oldest entries
  if (oauthStateStore.size > MAX_STATE_STORE_SIZE) {
    const entries = [...oauthStateStore.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    const toRemove = entries.slice(0, oauthStateStore.size - MAX_STATE_STORE_SIZE);
    for (const [key] of toRemove) {
      oauthStateStore.delete(key);
    }
  }
};

// --- Auth rate limiter (IP-based, for unauthenticated login/callback/link routes) ---
const authRateLimiter = rateLimiter({
  ...CONFIG.rateLimit.auth,
  keyGenerator: (c) => {
    return `auth:${c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'anonymous'}`;
  },
});

// ============================================================================
// PUBLIC AUTH ROUTES (no requireAuth)
// ============================================================================

// List enabled auth providers (public)
routes.get('/providers', async (c) => {
  const providers = getEnabledProviders();
  return c.json({
    success: true,
    data: providers.map((p) => ({ id: p.id, displayName: p.displayName })),
  });
});

// Auth login initiation — provider-agnostic
routes.get('/login/:authProvider', authRateLimiter, async (c) => {
  const authProviderId = c.req.param('authProvider') ?? '';
  const providerConfig = getEnabledProvider(authProviderId);

  if (!providerConfig) {
    return c.redirect(`${CONFIG.frontend.url}/auth?auth_error=unknown_provider`);
  }

  const state = generateState();
  const codeVerifier = providerConfig.supportsPKCE ? generateCodeVerifier() : undefined;

  oauthStateStore.set(state, {
    codeVerifier,
    createdAt: Date.now(),
  });

  const url = providerConfig.createAuthorizationURL(state, codeVerifier);
  cleanupExpiredStates();
  return c.redirect(url.toString());
});

// Auth link initiation — requires authentication
routes.get('/link/:authProvider', authRateLimiter, requireAuth, async (c) => {
  const user = c.get('user');
  const authProviderId = c.req.param('authProvider') ?? '';
  const providerConfig = getEnabledProvider(authProviderId);

  if (!providerConfig) {
    return c.redirect(`${CONFIG.frontend.url}/profile?link_error=unknown_provider`);
  }

  const state = generateState();
  const codeVerifier = providerConfig.supportsPKCE ? generateCodeVerifier() : undefined;

  oauthStateStore.set(state, {
    codeVerifier,
    createdAt: Date.now(),
    userId: user.id,
    flowType: 'auth-link',
  });

  const url = providerConfig.createAuthorizationURL(state, codeVerifier);
  cleanupExpiredStates();
  return c.redirect(url.toString());
});

// --- Auth callback helper: exchange tokens and fetch user info ---
async function exchangeAuthTokens(
  providerConfig: ReturnType<typeof getProvider> & object,
  code: string,
  codeVerifier: string | undefined
) {
  const cv = providerConfig.supportsPKCE ? codeVerifier : undefined;
  const tokens = await providerConfig.validateAuthorizationCode(code, cv);
  const userInfo = await providerConfig.fetchUserInfo(tokens.accessToken);
  return userInfo;
}

// --- Auth callback helper: update existing user's profile ---
async function updateExistingUserProfile(
  userId: string,
  authRowId: string,
  userInfo: { email: string; displayName: string; avatarUrl?: string }
) {
  const db = getDb();
  await authProviderRepository.updateProfile(authRowId, userId, {
    email: userInfo.email,
    displayName: userInfo.displayName,
    avatarUrl: userInfo.avatarUrl,
  });
  // Update users table — wrap email update in try/catch for UNIQUE constraint
  try {
    await db
      .update(users)
      .set({ email: userInfo.email, displayName: userInfo.displayName, updatedAt: new Date() })
      .where(eq(users.id, userId));
  } catch (emailErr) {
    if (emailErr instanceof Error && emailErr.message.includes('UNIQUE constraint failed')) {
      logger.warn(
        'Skipped email update due to UNIQUE conflict — another user already has this email',
        {
          userId,
          attemptedEmail: userInfo.email,
        }
      );
      await db
        .update(users)
        .set({ displayName: userInfo.displayName, updatedAt: new Date() })
        .where(eq(users.id, userId));
    } else {
      throw emailErr;
    }
  }
}

// --- Auth callback helper: resolve new user (no existing auth row) ---
async function resolveNewUser(
  authProviderId: string,
  userInfo: { providerAccountId: string; email: string; displayName: string; avatarUrl?: string }
): Promise<{ userId: string } | { redirect: string }> {
  const db = getDb();
  const existingByEmail = await db
    .select()
    .from(users)
    .where(eq(users.email, userInfo.email))
    .limit(1);

  if (existingByEmail.length > 0) {
    // Email already taken — no implicit account merging
    return { redirect: `${CONFIG.frontend.url}/auth?auth_error=email_exists` };
  }

  // New user transaction with race condition catch
  try {
    const result = await db.transaction(async (tx) => {
      const [newUser] = await tx
        .insert(users)
        .values({
          email: userInfo.email,
          displayName: userInfo.displayName,
        })
        .returning();
      await tx.insert(userProviders).values({
        userId: newUser.id,
        domain: 'auth',
        providerType: authProviderId,
        providerAccountId: userInfo.providerAccountId,
        displayName: userInfo.displayName,
        credentials: '',
        config: { email: userInfo.email, avatarUrl: userInfo.avatarUrl },
        status: 'active',
      });
      return { userId: newUser.id };
    });
    return result;
  } catch (txErr) {
    if (txErr instanceof Error && txErr.message.includes('UNIQUE constraint failed')) {
      const retryRow = await authProviderRepository.findByProviderIdentity(
        authProviderId,
        userInfo.providerAccountId
      );
      if (retryRow) return { userId: retryRow.userId };
      return { redirect: `${CONFIG.frontend.url}/auth?auth_error=email_exists` };
    }
    throw txErr;
  }
}

// --- Auth callback helper: validate OAuth state for link flow ---
function validateLinkState(stateParam: string | null) {
  const storedData = stateParam ? oauthStateStore.get(stateParam) : undefined;
  if (!stateParam || !storedData || storedData.flowType !== 'auth-link') {
    if (stateParam) oauthStateStore.delete(stateParam);
    return { error: 'invalid_state' as const };
  }
  oauthStateStore.delete(stateParam);
  return { data: storedData };
}

// --- Auth callback helper: validate OAuth state for login flow ---
function validateLoginState(stateParam: string | null) {
  const storedData = stateParam ? oauthStateStore.get(stateParam) : undefined;
  if (!stateParam || !storedData || storedData.flowType) {
    if (stateParam) oauthStateStore.delete(stateParam);
    return { error: 'invalid_state' as const };
  }
  oauthStateStore.delete(stateParam);
  return { data: storedData };
}

// --- Auth callback helper: handle link conflict check ---
async function checkLinkConflicts(
  authProviderId: string,
  providerAccountId: string,
  currentUserId: string
): Promise<string | null> {
  const existingRow = await authProviderRepository.findByProviderIdentity(
    authProviderId,
    providerAccountId
  );
  if (!existingRow) return null;
  if (existingRow.userId === currentUserId) return 'already_linked';
  return 'account_conflict';
}

// Link callback — MUST be registered BEFORE the generic callback to avoid route collision
routes.get('/callback/link/:authProvider', authRateLimiter, async (c) => {
  const authProviderId = c.req.param('authProvider') ?? '';
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const profileRedirect = (params: string) => `${CONFIG.frontend.url}/profile?${params}`;

  // Handle cancellation
  if (!code) {
    if (stateParam) oauthStateStore.delete(stateParam);
    return c.redirect(profileRedirect('link_error=cancelled'));
  }

  const stateResult = validateLinkState(stateParam);
  if ('error' in stateResult) return c.redirect(profileRedirect('link_error=invalid_state'));
  const storedData = stateResult.data;

  // Validate session manually
  const lucia = getLucia();
  const sessionId = getCookie(c, lucia.sessionCookieName);
  const authResult = await validateProviderSession(sessionId);
  if (!authResult) return c.redirect(`${CONFIG.frontend.url}/auth?auth_error=invalid_state`);

  // CSRF check
  if (storedData.userId !== authResult.user.id) {
    logger.warn('Auth link CSRF mismatch', {
      sessionUserId: authResult.user.id,
      stateUserId: storedData.userId,
    });
    return c.redirect(profileRedirect('link_error=session_mismatch'));
  }

  const providerConfig = getProvider(authProviderId);
  if (!providerConfig) return c.redirect(profileRedirect('link_error=unknown_provider'));

  const tokenResult = await exchangeAuthTokensOrRedirect(
    providerConfig,
    code,
    storedData.codeVerifier,
    authProviderId,
    'Auth link'
  );
  if ('redirect' in tokenResult)
    return c.redirect(profileRedirect(`link_error=${tokenResult.redirect}`));
  const { userInfo } = tokenResult;

  const conflict = await checkLinkConflicts(
    authProviderId,
    userInfo.providerAccountId,
    authResult.user.id
  );
  if (conflict) return c.redirect(profileRedirect(`link_error=${conflict}`));

  await authProviderRepository.create({
    userId: authResult.user.id,
    authProvider: authProviderId,
    providerAccountId: userInfo.providerAccountId,
    email: userInfo.email,
    displayName: userInfo.displayName,
    avatarUrl: userInfo.avatarUrl,
  });

  return c.redirect(profileRedirect('success=linked'));
});

// --- Auth callback helper: create Lucia session and set cookie ---
async function createAuthSession(c: Context, userId: string) {
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
}

// --- Auth callback helper: exchange tokens with error redirect ---
async function exchangeAuthTokensOrRedirect(
  providerConfig: ReturnType<typeof getProvider> & object,
  code: string,
  codeVerifier: string | undefined,
  authProviderId: string,
  errorPrefix: string
): Promise<
  { userInfo: Awaited<ReturnType<typeof providerConfig.fetchUserInfo>> } | { redirect: string }
> {
  try {
    const userInfo = await exchangeAuthTokens(providerConfig, code, codeVerifier);
    return { userInfo };
  } catch (err) {
    logger.error(`${errorPrefix} token exchange or user info fetch failed`, {
      error: err instanceof Error ? err.message : String(err),
      provider: authProviderId,
    });
    const isNoEmail = err instanceof Error && err.message.includes('No verified email');
    return { redirect: isNoEmail ? 'no_email' : 'provider_unavailable' };
  }
}

// Generic auth callback — REGISTERED AFTER link callback
routes.get('/callback/:authProvider', authRateLimiter, async (c) => {
  const authProviderId = c.req.param('authProvider') ?? '';
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const authRedirect = (params: string) => `${CONFIG.frontend.url}/auth?${params}`;

  if (!code) {
    if (stateParam) oauthStateStore.delete(stateParam);
    return c.redirect(authRedirect('auth_error=cancelled'));
  }

  const stateResult = validateLoginState(stateParam);
  if ('error' in stateResult) return c.redirect(authRedirect('auth_error=invalid_state'));

  const providerConfig = getProvider(authProviderId);
  if (!providerConfig) return c.redirect(authRedirect('auth_error=unknown_provider'));

  const tokenResult = await exchangeAuthTokensOrRedirect(
    providerConfig,
    code,
    stateResult.data.codeVerifier,
    authProviderId,
    'Auth callback'
  );
  if ('redirect' in tokenResult)
    return c.redirect(authRedirect(`auth_error=${tokenResult.redirect}`));
  const { userInfo } = tokenResult;

  const existingAuthRow = await authProviderRepository.findByProviderIdentity(
    authProviderId,
    userInfo.providerAccountId
  );

  let userId: string;
  if (existingAuthRow) {
    userId = existingAuthRow.userId;
    await updateExistingUserProfile(userId, existingAuthRow.id, userInfo);
  } else {
    const resolution = await resolveNewUser(authProviderId, userInfo);
    if ('redirect' in resolution) return c.redirect(resolution.redirect);
    userId = resolution.userId;
  }

  await createAuthSession(c, userId);
  return c.redirect(`${CONFIG.frontend.url}/dashboard`);
});

// ============================================================================
// SESSION ROUTES (no rate limiter — these are not auth initiation)
// ============================================================================

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
      },
      session: {
        id: result.session.id,
        expiresAt: result.session.expiresAt,
      },
    },
  });
});

// ============================================================================
// LINKED ACCOUNTS ROUTES (requireAuth, no rate limiter)
// ============================================================================

// List linked auth accounts
routes.get('/accounts', requireAuth, async (c) => {
  const user = c.get('user');
  const rows = await authProviderRepository.findByUserId(user.id);

  const data = rows.map((row) => {
    const config = (row.config as Record<string, unknown>) ?? {};
    return {
      id: row.id,
      providerType: row.providerType,
      displayName: row.displayName,
      email: (config.email as string) ?? '',
      avatarUrl: (config.avatarUrl as string) ?? undefined,
      createdAt: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
    };
  });

  return c.json({ success: true, data });
});

// Unlink auth account — transaction-safe
routes.delete('/accounts/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const accountId = c.req.param('id');
  const db = getDb();

  const result = await db.transaction(async (tx) => {
    // Verify row exists, belongs to user, and is auth domain
    const row = await tx
      .select()
      .from(userProviders)
      .where(
        and(
          eq(userProviders.id, accountId),
          eq(userProviders.userId, user.id),
          eq(userProviders.domain, 'auth')
        )
      )
      .limit(1);

    if (!row[0]) {
      return { error: 'not_found' as const };
    }

    // Count auth rows within the transaction
    const countResult = await tx
      .select({ value: userProviders.id })
      .from(userProviders)
      .where(and(eq(userProviders.userId, user.id), eq(userProviders.domain, 'auth')));

    if (countResult.length <= 1) {
      return { error: 'last_account' as const };
    }

    await tx.delete(userProviders).where(eq(userProviders.id, accountId));

    return { success: true as const };
  });

  if ('error' in result) {
    if (result.error === 'not_found') {
      return c.json(
        {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Auth account not found' },
        },
        404
      );
    }
    return c.json(
      {
        success: false,
        error: {
          code: 'LAST_ACCOUNT',
          message: 'Cannot unlink your last sign-in method',
        },
      },
      400
    );
  }

  return c.body(null, 204);
});

// ============================================================================
// STORAGE PROVIDER OAUTH ROUTES (existing — kept below auth routes)
// ============================================================================

// Provider OAuth initiation — isolated from login flow
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
  const url = googleProvider.createAuthorizationURL(state, codeVerifier, [
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

  // Runtime assertion: provider flow always requires codeVerifier (Google supports PKCE)
  if (!storedData.codeVerifier) {
    oauthStateStore.delete(stateParam);
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

// Provider OAuth callback — never touches the session
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
