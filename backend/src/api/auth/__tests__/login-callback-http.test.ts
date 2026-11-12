import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
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
});

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
  return ctx.anon('GET', `/api/v1/auth/callback/github?code=auth-code&state=${state}`);
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
    const callback = `/api/v1/auth/callback/github?code=auth-code&state=${state}`;

    await ctx.anon('GET', callback);
    const replay = await ctx.anon('GET', callback);

    expect(replay.headers.get('location')).toBe(`${frontendUrl()}/auth?auth_error=invalid_state`);
  });
});
