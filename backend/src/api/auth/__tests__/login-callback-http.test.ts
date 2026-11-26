import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';
import type { OAuthProviderConfig, OAuthUserInfo } from '../providers/types';

type MutableConfig = {
  disableRateLimit: boolean;
  frontend: { url: string };
  auth: { githubClientId?: string; githubClientSecret?: string };
};

let ctx: TestApp;
let mutableConfig: MutableConfig;
let githubAuthProvider: OAuthProviderConfig;
let NoVerifiedEmailError: typeof import('../providers/types').NoVerifiedEmailError;
let original: { disableRateLimit: boolean; githubClientId?: string; githubClientSecret?: string };
const spies: { mockRestore: () => void }[] = [];

beforeEach(async () => {
  ctx = await createTestApp();
  // App modules must be imported after createTestApp, or they bind the wrong database.
  mutableConfig = (await import('../../../config')).CONFIG as unknown as MutableConfig;
  ({ githubAuthProvider } = await import('../providers/github'));
  ({ NoVerifiedEmailError } = await import('../providers/types'));
  original = {
    disableRateLimit: mutableConfig.disableRateLimit,
    githubClientId: mutableConfig.auth.githubClientId,
    githubClientSecret: mutableConfig.auth.githubClientSecret,
  };
  mutableConfig.disableRateLimit = true;
  mutableConfig.auth.githubClientId = 'test-client-id';
  mutableConfig.auth.githubClientSecret = 'test-client-secret';
  spies.push(
    spyOn(githubAuthProvider, 'validateAuthorizationCode').mockResolvedValue({
      accessToken: 'provider-access-token',
    })
  );
}, SETUP_TIMEOUT_MS);

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  mutableConfig.disableRateLimit = original.disableRateLimit;
  mutableConfig.auth.githubClientId = original.githubClientId;
  mutableConfig.auth.githubClientSecret = original.githubClientSecret;
  ctx.close();
});

const frontendUrl = () => mutableConfig.frontend.url;

function providerReturns(result: OAuthUserInfo | Error): void {
  const spy = spyOn(githubAuthProvider, 'fetchUserInfo');
  if (result instanceof Error) spy.mockRejectedValue(result);
  else spy.mockResolvedValue(result);
  spies.push(spy);
}

async function loginRoundTrip(): Promise<Response> {
  const start = await ctx.anon('GET', '/api/v1/auth/login/github');
  expect(start.status).toBe(302);
  const state = new URL(start.headers.get('location') ?? '').searchParams.get('state');
  expect(state, 'the authorize redirect must carry a state').toBeTruthy();
  return callbackWithCookie(`code=auth-code&state=${state}`, loginStateCookieFrom(start));
}

function loginStateCookieFrom(res: Response): string | undefined {
  return res.headers.get('set-cookie')?.match(/oauth_login_state=[^;]*/)?.[0];
}

async function callbackWithCookie(query: string, cookie: string | undefined): Promise<Response> {
  const headers: Record<string, string> = { 'Sec-Fetch-Site': 'same-origin' };
  if (cookie) headers.Cookie = cookie;
  return ctx.app.request(`/api/v1/auth/callback/github?${query}`, { headers });
}

function sessionUserIdFrom(res: Response): string | undefined {
  const setCookie = res.headers.get('set-cookie') ?? '';
  const sessionId = setCookie.match(/auth_session=([^;]+)/)?.[1];
  if (!sessionId) return undefined;
  const row = ctx.sqlite.query('SELECT user_id FROM sessions WHERE id = ?').get(sessionId) as {
    user_id: string;
  } | null;
  return row?.user_id;
}

describe('GET /auth/callback/:authProvider — login', () => {
  test('a new identity creates the user and its auth link, then opens a session', async () => {
    providerReturns({
      providerAccountId: 'gh-1001',
      email: 'newcomer@example.com',
      displayName: 'New Comer',
    });

    const res = await loginRoundTrip();

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${frontendUrl()}/dashboard`);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    const user = ctx.sqlite
      .query('SELECT id, display_name FROM users WHERE email = ?')
      .get('newcomer@example.com') as { id: string; display_name: string } | null;
    expect(user?.display_name).toBe('New Comer');
    const link = ctx.sqlite
      .query(
        "SELECT user_id FROM user_providers WHERE domain = 'auth' AND provider_type = 'github' AND provider_account_id = ?"
      )
      .get('gh-1001') as { user_id: string } | null;
    expect(link?.user_id).toBe(user?.id);
    expect(sessionUserIdFrom(res)).toBe(user?.id);
  });

  test('a known identity logs in its existing user rather than creating another', async () => {
    providerReturns({
      providerAccountId: 'gh-2002',
      email: 'returning@example.com',
      displayName: 'Returning',
    });
    const first = await loginRoundTrip();
    const firstUserId = sessionUserIdFrom(first);

    const second = await loginRoundTrip();

    expect(second.headers.get('location')).toBe(`${frontendUrl()}/dashboard`);
    expect(sessionUserIdFrom(second)).toBe(firstUserId);
    const count = ctx.sqlite
      .query('SELECT COUNT(*) AS n FROM users WHERE email = ?')
      .get('returning@example.com') as { n: number };
    expect(count.n).toBe(1);
  });

  describe('pending invites saved without an invitee', () => {
    const email = 'between@example.com';

    async function signUp(): Promise<string> {
      providerReturns({ providerAccountId: 'gh-3003', email, displayName: 'Between' });
      return sessionUserIdFrom(await loginRoundTrip()) as string;
    }

    function insertShare(share: {
      id: string;
      vehicleId: string;
      ownerId?: string;
      invitedEmail: string | null;
      sharedWithId?: string;
      status?: string;
    }): void {
      ctx.sqlite.run(
        "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status, invited_email) VALUES (?, ?, ?, ?, 'viewer', ?, ?)",
        [
          share.id,
          share.vehicleId,
          share.ownerId ?? ctx.user.id,
          share.sharedWithId ?? null,
          share.status ?? 'pending',
          share.invitedEmail,
        ]
      );
    }

    function invitee(id: string): string | null {
      return (
        ctx.sqlite.query('SELECT shared_with_id FROM vehicle_shares WHERE id = ?').get(id) as {
          shared_with_id: string | null;
        }
      ).shared_with_id;
    }

    test('one for that email attaches on the next login, and no other invite does', async () => {
      const userId = await signUp();
      const first = await seedVehicle(ctx);
      const second = await seedVehicle(ctx, { make: 'Mazda', model: '3' });
      insertShare({ id: 'share-missed', vehicleId: first, invitedEmail: email });
      insertShare({
        id: 'share-other',
        vehicleId: first,
        invitedEmail: 'someone-else@example.com',
      });
      insertShare({
        id: 'share-declined',
        vehicleId: second,
        invitedEmail: email,
        status: 'declined',
      });

      await loginRoundTrip();

      expect(invitee('share-missed')).toBe(userId);
      expect(invitee('share-other')).toBeNull();
      expect(invitee('share-declined')).toBeNull();
    });

    test('one on a vehicle the account already has an invite for stays put, and the rest still attach', async () => {
      const userId = await signUp();
      const vehicleId = await seedVehicle(ctx);
      const another = await seedVehicle(ctx, { make: 'Mazda', model: '3' });
      insertShare({ id: 'share-attached', vehicleId, invitedEmail: email, sharedWithId: userId });
      insertShare({ id: 'share-extra', vehicleId, invitedEmail: email });
      insertShare({ id: 'share-another', vehicleId: another, invitedEmail: email });

      const res = await loginRoundTrip();

      expect(res.headers.get('location')).toBe(`${frontendUrl()}/dashboard`);
      expect(sessionUserIdFrom(res)).toBe(userId);
      expect(invitee('share-extra')).toBeNull();
      expect(invitee('share-another')).toBe(userId);
    });

    test('one on a vehicle the account owns never attaches to it', async () => {
      const userId = await signUp();
      ctx.sqlite.run(
        "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('own-car', ?, 'Honda', 'Fit', 2020)",
        [userId]
      );
      insertShare({ id: 'share-self', vehicleId: 'own-car', ownerId: userId, invitedEmail: email });

      await loginRoundTrip();

      expect(invitee('share-self')).toBeNull();
    });
  });

  test('a provider with no verified email redirects with no_email and opens no session', async () => {
    providerReturns(new NoVerifiedEmailError('GitHub'));

    const res = await loginRoundTrip();

    expect(res.headers.get('location')).toBe(`${frontendUrl()}/auth?auth_error=no_email`);
    expect(sessionUserIdFrom(res)).toBeUndefined();
  });

  test('any other provider failure is provider_unavailable, whatever its message says', async () => {
    providerReturns(new Error('No verified email found, but from an unrelated failure'));

    const res = await loginRoundTrip();

    expect(res.headers.get('location')).toBe(
      `${frontendUrl()}/auth?auth_error=provider_unavailable`
    );
  });

  test('a login state cannot be replayed', async () => {
    providerReturns({
      providerAccountId: 'gh-3003',
      email: 'replay@example.com',
      displayName: 'Replay',
    });
    const start = await ctx.anon('GET', '/api/v1/auth/login/github');
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state');
    const query = `code=auth-code&state=${state}`;
    const cookie = loginStateCookieFrom(start);

    const first = await callbackWithCookie(query, cookie);
    expect(first.headers.get('location')).toBe(`${frontendUrl()}/dashboard`);
    const replay = await callbackWithCookie(query, cookie);

    expect(replay.headers.get('location')).toBe(`${frontendUrl()}/auth?auth_error=invalid_state`);
  });
});

describe('GET /auth/callback/:authProvider — browser binding', () => {
  const identity = { providerAccountId: 'gh-4004', email: 'bound@example.com', displayName: 'B' };

  test('the login start sets a short-lived httpOnly state cookie', async () => {
    const start = await ctx.anon('GET', '/api/v1/auth/login/github');
    const setCookie = start.headers.get('set-cookie') ?? '';
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state');
    expect(setCookie).toContain(`oauth_login_state=${state}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=600');
  });

  test('a callback from a browser without the state cookie opens no session', async () => {
    providerReturns(identity);
    const start = await ctx.anon('GET', '/api/v1/auth/login/github');
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state');

    const res = await callbackWithCookie(`code=auth-code&state=${state}`, undefined);

    expect(res.headers.get('location')).toBe(`${frontendUrl()}/auth?auth_error=invalid_state`);
    expect(sessionUserIdFrom(res)).toBeUndefined();
  });

  test('a state cookie from a different login start is refused', async () => {
    providerReturns(identity);
    const mine = await ctx.anon('GET', '/api/v1/auth/login/github');
    const other = await ctx.anon('GET', '/api/v1/auth/login/github');
    const otherState = new URL(other.headers.get('location') ?? '').searchParams.get('state');

    const res = await callbackWithCookie(
      `code=auth-code&state=${otherState}`,
      loginStateCookieFrom(mine)
    );

    expect(res.headers.get('location')).toBe(`${frontendUrl()}/auth?auth_error=invalid_state`);
    expect(sessionUserIdFrom(res)).toBeUndefined();
  });

  test('the callback clears the state cookie', async () => {
    providerReturns(identity);
    const res = await loginRoundTrip();
    expect(res.headers.get('set-cookie') ?? '').toMatch(/oauth_login_state=;[^,]*Max-Age=0/);
  });
});
