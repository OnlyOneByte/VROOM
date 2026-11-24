import { generateCodeVerifier, generateState } from 'arctic';
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { CONFIG } from '../../config';
import { getDb } from '../../db/connection';
import { userProviders, users } from '../../db/schema';
import { createErrorResponse, isUniqueConstraintError, NotFoundError } from '../../errors';
import { rateLimiter, requireAuth } from '../../middleware';
import { assignServerRole, requestResolver } from '../../permissions/grants';
import { PERMISSION_REGISTRY } from '../../permissions/registry';
import { ROLE_TEMPLATES } from '../../permissions/roles';
import { getClientRateKey } from '../../utils/client-ip';
import { encrypt } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { storePending } from '../../utils/pending-credentials';
import { readJsonBody } from '../../utils/request-body';
import { attachPendingInvites } from '../shares/repository';
import { decideSignup } from '../signup/policy';
import {
  activeInviteFor,
  becomesFirstAdmin,
  consumeInvite,
  hasShareInvite,
  markAdminAssigned,
  signupSettings,
} from '../signup/store';
import { authProviderRepository, buildAuthProviderConfig } from './auth-provider-repository';
import { DEMO_USER_ID, isDemoAvailable, startDemoSession } from './demo';
import { lucia } from './lucia';
import {
  googleStorageClient,
  PHOTOS_SCOPES,
  PHOTOS_UPLOAD_SCOPE,
  STORAGE_SCOPES,
} from './providers/google';
import { ensureOidcDiscovered } from './providers/oidc';
import { getEnabledProvider, getEnabledProviders, getProvider } from './providers/registry';
import { NoVerifiedEmailError, type OAuthFlow } from './providers/types';
import {
  clearSessionCookie,
  consumeOAuthState,
  demoSessionExpiresAt,
  setSessionCookie,
  validateAndRefreshSession,
} from './utils';

const routes = new Hono();

function serializeSessionUser(u: {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    createdAt: u.createdAt?.toISOString() ?? null,
    updatedAt: u.updatedAt?.toISOString() ?? null,
  };
}

// In-memory OAuth state: single instance only, and lost on restart.
const oauthStateStore = new Map<
  string,
  {
    codeVerifier?: string;
    createdAt: number;
    returnTo?: string;
    userId?: string;
    flowType?: 'provider' | 'auth-link';
    providerId?: string;
    providerType?: string;
    nonce?: string;
  }
>();

const GOOGLE_CONNECT_SCOPES: Record<string, { scopes: string[]; required: string[] }> = {
  'google-drive': { scopes: STORAGE_SCOPES, required: [] },
  'google-photos': { scopes: PHOTOS_SCOPES, required: [PHOTOS_UPLOAD_SCOPE] },
};

function lacksRequiredScope(
  providerType: string,
  tokens: { hasScopes(): boolean; scopes(): string[] }
): boolean {
  const required = googleConnectScopes(providerType)?.required ?? [];
  if (required.length === 0) return false;
  const granted = tokens.hasScopes() ? tokens.scopes() : [];
  return required.some((scope) => !granted.includes(scope));
}

async function ownedProviderType(providerId: string, userId: string): Promise<string> {
  const row = await getDb()
    .select({ providerType: userProviders.providerType })
    .from(userProviders)
    .where(and(eq(userProviders.id, providerId), eq(userProviders.userId, userId)))
    .limit(1);
  return row[0]?.providerType ?? '';
}

function googleConnectScopes(providerType: string) {
  return Object.hasOwn(GOOGLE_CONNECT_SCOPES, providerType)
    ? GOOGLE_CONNECT_SCOPES[providerType]
    : undefined;
}

const MAX_STATE_STORE_SIZE = 1000;
const cleanupExpiredStates = () => {
  const now = Date.now();
  for (const [state, data] of oauthStateStore.entries()) {
    if (now - data.createdAt > CONFIG.auth.oauthStateExpiry) {
      oauthStateStore.delete(state);
    }
  }
  if (oauthStateStore.size > MAX_STATE_STORE_SIZE) {
    const entries = [...oauthStateStore.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    const toRemove = entries.slice(0, oauthStateStore.size - MAX_STATE_STORE_SIZE);
    for (const [key] of toRemove) {
      oauthStateStore.delete(key);
    }
  }
};

const LOGIN_STATE_COOKIE = 'oauth_login_state';

function loginStateCookieOptions() {
  return {
    path: '/',
    secure: CONFIG.env === 'production',
    httpOnly: true,
    sameSite: 'Lax' as const,
  };
}

function setLoginStateCookie(c: Context, state: string): void {
  setCookie(c, LOGIN_STATE_COOKIE, state, {
    ...loginStateCookieOptions(),
    maxAge: Math.floor(CONFIG.auth.oauthStateExpiry / 1000),
  });
}

function takeLoginStateCookie(c: Context): string | undefined {
  const value = getCookie(c, LOGIN_STATE_COOKIE);
  if (value !== undefined) deleteCookie(c, LOGIN_STATE_COOKIE, loginStateCookieOptions());
  return value;
}

const authRateLimiter = rateLimiter({
  ...CONFIG.rateLimit.auth,
  // Key on the trusted client IP; a raw X-Forwarded-For header is spoofable.
  keyGenerator: (c) => `auth:${getClientRateKey(c)}`,
});

for (const path of ['/providers', '/login/*', '/link/*', '/callback/*']) {
  routes.use(path, async (_c, next) => {
    await ensureOidcDiscovered();
    await next();
  });
}

routes.get('/providers', async (c) => {
  const providers = getEnabledProviders();
  return c.json({
    success: true,
    data: providers.map((p) => ({ id: p.id, displayName: p.displayName })),
  });
});

routes.get('/demo', (c) => c.json({ success: true, data: { available: isDemoAvailable() } }));

routes.post('/demo', authRateLimiter, async (c) => {
  if (!isDemoAvailable()) throw new NotFoundError('Demo garage');
  const expiresAt = await startDemoSession(c);
  return c.json({ success: true, data: { session: { expiresAt } } });
});

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

  const url = providerConfig.createAuthorizationURL(state, codeVerifier, 'login');
  cleanupExpiredStates();
  setLoginStateCookie(c, state);
  return c.redirect(url.toString());
});

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

  const url = providerConfig.createAuthorizationURL(state, codeVerifier, 'link');
  cleanupExpiredStates();
  return c.redirect(url.toString());
});

async function exchangeAuthTokens(
  providerConfig: ReturnType<typeof getProvider> & object,
  code: string,
  codeVerifier: string | undefined,
  flow: OAuthFlow
) {
  const cv = providerConfig.supportsPKCE ? codeVerifier : undefined;
  const tokens = await providerConfig.validateAuthorizationCode(code, cv, flow);
  const userInfo = await providerConfig.fetchUserInfo(tokens.accessToken);
  return userInfo;
}

export async function updateExistingUserProfile(
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
  // users.email is the login identity: backfill only when empty, never re-sync from the provider.
  const [current] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const shouldBackfillEmail = !current?.email;
  if (!shouldBackfillEmail) {
    await db
      .update(users)
      .set({ displayName: userInfo.displayName, updatedAt: new Date() })
      .where(eq(users.id, userId));
    return;
  }
  try {
    await db
      .update(users)
      .set({
        email: userInfo.email.toLowerCase(),
        displayName: userInfo.displayName,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  } catch (emailErr) {
    if (isUniqueConstraintError(emailErr)) {
      logger.warn(
        'Skipped email backfill due to UNIQUE conflict — another user already has this email',
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

export async function attachPendingInvitesOnSignIn(userId: string): Promise<void> {
  const db = getDb();
  try {
    const [account] = await db
      .select({ email: users.email, pendingApprovalAt: users.pendingApprovalAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (account?.email && !account.pendingApprovalAt) {
      attachPendingInvites(db, userId, account.email);
    }
  } catch (error) {
    logger.warn('Could not attach pending invites on sign-in', { userId, error });
  }
}

export async function resolveNewUser(
  authProviderId: string,
  userInfo: { providerAccountId: string; email: string; displayName: string; avatarUrl?: string }
): Promise<{ userId: string } | { redirect: string }> {
  const db = getDb();
  const email = userInfo.email.toLowerCase();
  const existingByEmail = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (existingByEmail.length > 0) {
    return { redirect: `${CONFIG.frontend.url}/auth?auth_error=email_exists` };
  }

  try {
    // Keep this callback synchronous: bun:sqlite would autocommit each awaited insert.
    const result = db.transaction(
      (tx): { userId: string } | { redirect: string } => {
        const now = new Date();
        const firstAdmin = becomesFirstAdmin(tx, email);
        const settings = signupSettings(tx);
        const invite = activeInviteFor(tx, email, now);
        const decision = decideSignup({
          email,
          firstAdmin,
          mode: settings.mode,
          allowedDomains: settings.allowedDomains,
          serverInvite: invite !== undefined,
          shareInvite: hasShareInvite(tx, email),
        });
        if (!decision.allow) {
          logger.info('Sign-up refused', { reason: decision.reason, mode: settings.mode });
          return { redirect: `${CONFIG.frontend.url}/auth?auth_error=signup_${decision.reason}` };
        }
        const newUser = tx
          .insert(users)
          .values({
            email,
            displayName: userInfo.displayName,
            pendingApprovalAt: decision.role === 'pending' ? now : null,
          })
          .returning()
          .get();
        tx.insert(userProviders)
          .values({
            userId: newUser.id,
            domain: 'auth',
            providerType: authProviderId,
            providerAccountId: userInfo.providerAccountId,
            displayName: userInfo.displayName,
            credentials: '',
            config: buildAuthProviderConfig(userInfo.email, userInfo.avatarUrl),
            status: 'active',
          })
          .run();
        if (decision.role !== 'pending') assignServerRole(tx, newUser.id, 'member');
        if (decision.role === 'admin') {
          assignServerRole(tx, newUser.id, 'admin');
          markAdminAssigned(tx, now);
          logger.info('First admin account created', { userId: newUser.id });
        }
        if (invite && decision.via === 'server_invite')
          consumeInvite(tx, invite.id, newUser.id, now);
        if (decision.role === 'pending') return { userId: newUser.id };
        try {
          attachPendingInvites(tx, newUser.id, newUser.email);
        } catch (error) {
          logger.warn('Could not attach pending invites on signup', { userId: newUser.id, error });
        }
        return { userId: newUser.id };
      },
      { behavior: 'immediate' }
    );
    return result;
  } catch (txErr) {
    if (isUniqueConstraintError(txErr)) {
      const retryRow = await authProviderRepository.findByProviderIdentity(
        authProviderId,
        userInfo.providerAccountId
      );
      if (retryRow) {
        await attachPendingInvitesOnSignIn(retryRow.userId);
        return { userId: retryRow.userId };
      }
      return { redirect: `${CONFIG.frontend.url}/auth?auth_error=email_exists` };
    }
    throw txErr;
  }
}

function validateLinkState(stateParam: string | null) {
  const storedData = consumeOAuthState(oauthStateStore, stateParam, 'auth-link');
  return storedData ? { data: storedData } : { error: 'invalid_state' as const };
}

// A link or provider state must never be accepted as a login state.
function validateLoginState(stateParam: string | null, stateCookie: string | undefined) {
  const storedData = consumeOAuthState(oauthStateStore, stateParam, undefined);
  return storedData && stateCookie === stateParam
    ? { data: storedData }
    : { error: 'invalid_state' as const };
}

// Account takeover: an identity bound to another user must never be re-linked.
export async function checkLinkConflicts(
  authProviderId: string,
  providerAccountId: string,
  currentUserId: string,
  repo: Pick<typeof authProviderRepository, 'findByProviderIdentity'> = authProviderRepository
): Promise<string | null> {
  const existingRow = await repo.findByProviderIdentity(authProviderId, providerAccountId);
  if (!existingRow) return null;
  if (existingRow.userId === currentUserId) return 'already_linked';
  return 'account_conflict';
}

// Register before the generic /callback/:authProvider route, which would shadow it.
routes.get('/callback/link/:authProvider', authRateLimiter, async (c) => {
  const authProviderId = c.req.param('authProvider') ?? '';
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const profileRedirect = (params: string) => `${CONFIG.frontend.url}/profile?${params}`;

  if (!code) {
    if (stateParam) oauthStateStore.delete(stateParam);
    return c.redirect(profileRedirect('link_error=cancelled'));
  }

  const stateResult = validateLinkState(stateParam);
  if ('error' in stateResult) return c.redirect(profileRedirect('link_error=invalid_state'));
  const storedData = stateResult.data;

  const sessionId = getCookie(c, lucia.sessionCookieName);
  const authResult = await validateProviderSession(sessionId);
  if (!authResult) return c.redirect(`${CONFIG.frontend.url}/auth?auth_error=invalid_state`);

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
    'Auth link',
    'link'
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

async function createAuthSession(c: Context, userId: string) {
  const session = await lucia.createSession(userId, {});
  setSessionCookie(c, lucia.sessionCookieName, session);
}

async function exchangeAuthTokensOrRedirect(
  providerConfig: ReturnType<typeof getProvider> & object,
  code: string,
  codeVerifier: string | undefined,
  authProviderId: string,
  errorPrefix: string,
  flow: OAuthFlow
): Promise<
  { userInfo: Awaited<ReturnType<typeof providerConfig.fetchUserInfo>> } | { redirect: string }
> {
  try {
    const userInfo = await exchangeAuthTokens(providerConfig, code, codeVerifier, flow);
    return { userInfo };
  } catch (err) {
    logger.error(`${errorPrefix} token exchange or user info fetch failed`, {
      error: err instanceof Error ? err.message : String(err),
      provider: authProviderId,
    });
    return { redirect: err instanceof NoVerifiedEmailError ? 'no_email' : 'provider_unavailable' };
  }
}

routes.get('/callback/:authProvider', authRateLimiter, async (c) => {
  const authProviderId = c.req.param('authProvider') ?? '';
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const authRedirect = (params: string) => `${CONFIG.frontend.url}/auth?${params}`;
  const stateCookie = takeLoginStateCookie(c);

  if (!code) {
    if (stateParam) oauthStateStore.delete(stateParam);
    return c.redirect(authRedirect('auth_error=cancelled'));
  }

  const stateResult = validateLoginState(stateParam, stateCookie);
  if ('error' in stateResult) return c.redirect(authRedirect('auth_error=invalid_state'));

  const providerConfig = getProvider(authProviderId);
  if (!providerConfig) return c.redirect(authRedirect('auth_error=unknown_provider'));

  const tokenResult = await exchangeAuthTokensOrRedirect(
    providerConfig,
    code,
    stateResult.data.codeVerifier,
    authProviderId,
    'Auth callback',
    'login'
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
    await attachPendingInvitesOnSignIn(userId);
  } else {
    const resolution = await resolveNewUser(authProviderId, userInfo);
    if ('redirect' in resolution) return c.redirect(resolution.redirect);
    userId = resolution.userId;
  }

  await createAuthSession(c, userId);
  return c.redirect(`${CONFIG.frontend.url}/dashboard`);
});

routes.get('/me', async (c) => {
  const sessionId = getCookie(c, lucia.sessionCookieName);

  if (!sessionId) {
    throw new HTTPException(401, { message: 'No session found' });
  }

  const { session, user } = await lucia.validateSession(sessionId);

  if (!session) {
    clearSessionCookie(c, lucia.sessionCookieName);
    throw new HTTPException(401, { message: 'Invalid session' });
  }

  return c.json({
    success: true,
    data: {
      user: serializeSessionUser(user),
      session: {
        expiresAt: demoSessionExpiresAt(session.id) ?? session.expiresAt,
      },
      demo: user.id === DEMO_USER_ID,
      pendingApproval: user.pendingApprovalAt !== null,
    },
  });
});

routes.patch('/me', requireAuth, async (c) => {
  const user = c.get('user');

  const body = await readJsonBody<{ displayName?: unknown }>(c);

  const displayNameRaw = body?.displayName;
  if (typeof displayNameRaw !== 'string') {
    throw new HTTPException(400, { message: 'displayName is required' });
  }
  const displayName = displayNameRaw.trim();
  if (displayName.length < 1 || displayName.length > 100) {
    throw new HTTPException(400, {
      message: 'displayName must be between 1 and 100 characters',
    });
  }

  const db = getDb();
  const [updated] = await db
    .update(users)
    .set({ displayName, updatedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();

  return c.json({
    success: true,
    data: {
      user: { id: updated.id, email: updated.email, displayName: updated.displayName },
    },
    message: 'Profile updated successfully',
  });
});

routes.get('/capabilities', requireAuth, (c) =>
  c.json({
    success: true,
    data: {
      permissions: PERMISSION_REGISTRY.list.map(
        ({ id, label, scope, grantable, implies, sensitive }) => ({
          id,
          label,
          scope,
          grantable,
          implies,
          sensitive,
        })
      ),
      roles: ROLE_TEMPLATES.map(({ key, name, scope, permissions }) => ({
        key,
        name,
        scope,
        permissions,
      })),
      rules: requestResolver(c, getDb()).packedRulesFor({ kind: 'server' }),
    },
  })
);

routes.post('/logout', async (c) => {
  const sessionId = getCookie(c, lucia.sessionCookieName);

  if (sessionId) {
    await lucia.invalidateSession(sessionId);
  }

  clearSessionCookie(c, lucia.sessionCookieName);

  return c.json({ success: true, message: 'Logged out successfully' });
});

routes.post('/refresh', async (c) => {
  const sessionId = getCookie(c, lucia.sessionCookieName);

  if (!sessionId) {
    throw new HTTPException(401, { message: 'No session found' });
  }

  const result = await validateAndRefreshSession(sessionId, lucia, c);

  if (!result) {
    clearSessionCookie(c, lucia.sessionCookieName);
    throw new HTTPException(401, { message: 'Invalid session' });
  }

  return c.json({
    success: true,
    data: {
      user: serializeSessionUser(result.user),
      session: {
        expiresAt: result.session.expiresAt,
      },
    },
  });
});

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

routes.delete('/accounts/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const accountId = c.req.param('id');
  const db = getDb();

  // No awaits between the count and the delete: the last-sign-in guard is read-then-write.
  const result = db.transaction((tx) => {
    const authRows = tx
      .select({ id: userProviders.id })
      .from(userProviders)
      .where(and(eq(userProviders.userId, user.id), eq(userProviders.domain, 'auth')))
      .all();

    if (!authRows.some((row) => row.id === accountId)) {
      return { error: 'not_found' as const };
    }

    if (authRows.length <= 1) {
      return { error: 'last_account' as const };
    }

    tx.delete(userProviders)
      .where(
        and(
          eq(userProviders.id, accountId),
          eq(userProviders.userId, user.id),
          eq(userProviders.domain, 'auth')
        )
      )
      .run();

    return { success: true as const };
  });

  if ('error' in result) {
    if (result.error === 'not_found') {
      throw new NotFoundError('Auth account');
    }
    return c.json(
      createErrorResponse('LAST_ACCOUNT', 'Cannot unlink your last sign-in method'),
      400
    );
  }

  return c.body(null, 204);
});

// Rejects //host, /\host and @host, which browsers resolve off-origin.
export function isSafeReturnPath(value: string | undefined): value is string {
  return value !== undefined && /^\/(?![/\\])[^?#\\\s]*$/.test(value);
}

routes.get('/providers/connect/google', requireAuth, async (c) => {
  const user = c.get('user');
  const returnTo = c.req.query('returnTo');
  const nonce = c.req.query('nonce');

  if (!returnTo || !nonce) {
    throw new HTTPException(400, { message: 'Missing required parameters: returnTo, nonce' });
  }

  if (!isSafeReturnPath(returnTo)) {
    throw new HTTPException(400, {
      message: 'returnTo must be a same-origin path beginning with /',
    });
  }

  const providerId = c.req.query('providerId') ?? undefined;
  const email = c.req.query('email') ?? undefined;
  const providerType = providerId
    ? await ownedProviderType(providerId, user.id)
    : (c.req.query('providerType') ?? 'google-drive');
  const connect = googleConnectScopes(providerType);
  if (!connect) {
    throw new HTTPException(400, { message: 'providerType must be google-drive or google-photos' });
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = googleStorageClient.createAuthorizationURL(state, codeVerifier, connect.scopes);

  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  if (connect.required.length > 0) url.searchParams.set('include_granted_scopes', 'true');
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
    providerType,
  });

  cleanupExpiredStates();
  return c.redirect(url.toString());
});

async function validateProviderSession(
  sessionId: string | undefined
): Promise<{ user: { id: string }; session: { id: string } } | null> {
  if (!sessionId) return null;
  const { session, user } = await lucia.validateSession(sessionId);
  if (!session || !user) return null;
  return { user, session };
}

async function exchangeProviderTokens(code: string, codeVerifier: string) {
  const tokens = await googleStorageClient.validateAuthorizationCode(code, codeVerifier);
  if (!tokens.hasRefreshToken()) return { tokens, refreshToken: null, email: null };

  const email = await fetchGoogleEmail(tokens.accessToken());
  return { tokens, refreshToken: tokens.refreshToken(), email };
}

async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  const resp = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { email: string; email_verified?: boolean };
  return data.email_verified === true ? data.email : null;
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

  const encryptedCredentials = encrypt(JSON.stringify({ refreshToken }), {
    rowId: existing[0].id,
    userId: existing[0].userId,
    domain: existing[0].domain,
  });
  const existingConfig = (existing[0].config as Record<string, unknown>) ?? {};
  await db
    .update(userProviders)
    .set({
      credentials: encryptedCredentials,
      config: { ...existingConfig, accountEmail: email },
      ...(existing[0].status !== 'disabled' && {
        status: 'active',
        lastErrorCode: null,
        failureCount: 0,
      }),
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
  providerType: string;
}

function resolveProviderState(
  stateParam: string | null,
  code: string | null
): { state: ProviderCallbackState; returnTo: string } | { error: string; returnTo: string } {
  const storedData = stateParam ? oauthStateStore.get(stateParam) : undefined;
  // Fallback must be a page that renders provider_error, or the error lands on a 404.
  const requestedReturnTo = storedData?.returnTo ?? '/settings/providers/new';
  // Validated again on output, so no state can steer the redirect off-origin.
  const returnTo = isSafeReturnPath(requestedReturnTo)
    ? requestedReturnTo
    : '/settings/providers/new';

  if (!code) {
    if (stateParam) oauthStateStore.delete(stateParam);
    return { error: 'cancelled', returnTo };
  }

  if (!stateParam || !storedData || storedData.flowType !== 'provider') {
    if (stateParam) oauthStateStore.delete(stateParam);
    return { error: 'invalid_state', returnTo };
  }

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
      providerType: storedData.providerType ?? 'google-drive',
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

// Must never create or modify the login session.
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
  const authCode = code as string;

  const sessionId = getCookie(c, lucia.sessionCookieName);
  const validated = await validateProviderCsrf(sessionId, state.userId);
  if (!validated) {
    const authResult = await validateProviderSession(sessionId);
    if (!authResult) {
      return c.redirect(`${CONFIG.frontend.url}/auth?auth_error=invalid_state`);
    }
    logger.warn('Provider OAuth CSRF mismatch', {
      sessionUserId: authResult.user.id,
      stateUserId: state.userId,
    });
    return c.redirect(frontendRedirect(`${state.returnTo}?provider_error=session_mismatch`));
  }

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

  if (lacksRequiredScope(state.providerType, result.tokens)) {
    return c.redirect(frontendRedirect(`${state.returnTo}?provider_error=missing_scope`));
  }

  if (state.providerId) {
    await updateExistingProvider(
      state.providerId,
      validated.userId,
      result.refreshToken,
      result.email
    );
  } else {
    storePending(
      validated.userId,
      state.nonce,
      result.refreshToken,
      result.email,
      state.providerType
    );
  }

  return c.redirect(
    frontendRedirect(
      `${state.returnTo}?provider_connected=true&nonce=${encodeURIComponent(state.nonce)}`
    )
  );
});

export { routes };
