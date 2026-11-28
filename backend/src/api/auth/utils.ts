import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import type { Lucia, Session, User } from 'lucia';
import { CONFIG } from '../../config';
import { logger } from '../../utils/logger';

interface SessionRefreshResult {
  session: Session;
  user: User;
  refreshed: boolean;
}

export interface OAuthStateEntry {
  codeVerifier?: string;
  createdAt: number;
  returnTo?: string;
  userId?: string;
  flowType?: 'provider' | 'auth-link';
  nonce?: string;
  authProviderId?: string;
}

export function oauthStateExpired(entry: Pick<OAuthStateEntry, 'createdAt'>): boolean {
  return Date.now() - entry.createdAt > CONFIG.auth.oauthStateExpiry;
}

// Shared by every write and delete: a browser only clears a cookie whose attributes match the write.
function sessionCookieOptions(): CookieOptions {
  return {
    path: '/',
    secure: CONFIG.env === 'production',
    httpOnly: true,
    maxAge: CONFIG.auth.cookieMaxAge,
    sameSite: 'Lax',
  };
}

export function setSessionCookie(
  c: Context,
  cookieName: string,
  session: Pick<Session, 'id' | 'expiresAt'>
): void {
  const demoExpiresAt = demoSessionExpiresAt(session.id);
  const expires =
    demoExpiresAt && demoExpiresAt < session.expiresAt ? demoExpiresAt : session.expiresAt;
  const options = { ...sessionCookieOptions(), expires };
  if (demoExpiresAt) {
    options.maxAge = Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1000));
  }
  setCookie(c, cookieName, session.id, options);
}

export function clearSessionCookie(c: Context, cookieName: string): void {
  deleteCookie(c, cookieName, sessionCookieOptions());
}

// Single-use: the entry is deleted even on mismatch, so a replayed state cannot be retried.
export function consumeOAuthState(
  store: Map<string, OAuthStateEntry>,
  stateParam: string | null,
  expectedFlow: OAuthStateEntry['flowType'],
  expectedProvider?: string
): OAuthStateEntry | null {
  const entry = stateParam ? store.get(stateParam) : undefined;
  const flowOk = expectedFlow ? entry?.flowType === expectedFlow : !entry?.flowType;
  const providerOk = expectedProvider === undefined || entry?.authProviderId === expectedProvider;
  if (!stateParam || !entry || !flowOk || !providerOk || oauthStateExpired(entry)) {
    if (stateParam) store.delete(stateParam);
    return null;
  }
  store.delete(stateParam);
  return entry;
}

export const DEMO_SESSION_PREFIX = 'demo_';

export function demoSessionExpiresAt(sessionId: string): Date | null {
  if (!sessionId.startsWith(DEMO_SESSION_PREFIX)) return null;
  const issuedAt = Number(sessionId.slice(DEMO_SESSION_PREFIX.length).split('_')[0]);
  return new Date((Number.isFinite(issuedAt) ? issuedAt : 0) + CONFIG.demo.sessionDuration);
}

// Lucia extends the DB expiry without rewriting the cookie; re-issue it or the browser drops a live session.
export async function validateAndRefreshSession(
  sessionId: string,
  lucia: Lucia,
  c?: Context
): Promise<SessionRefreshResult | null> {
  const demoExpiresAt = demoSessionExpiresAt(sessionId);
  const { session, user } = await lucia.validateSession(sessionId);

  if (!session || !user) {
    return null;
  }

  if (demoExpiresAt) {
    return {
      session: { ...session, expiresAt: demoExpiresAt, fresh: false },
      user,
      refreshed: false,
    };
  }

  if (!session.fresh) {
    return {
      session,
      user,
      refreshed: false,
    };
  }

  if (c) setSessionCookie(c, lucia.sessionCookieName, session);

  logger.info('Session cookie re-issued for an extended session', {
    userId: user.id,
    expiresAt: session.expiresAt.toISOString(),
  });

  return {
    session,
    user,
    refreshed: true,
  };
}
