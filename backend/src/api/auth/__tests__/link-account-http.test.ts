import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { createInvitee } from '../../../test-helpers/invitee';
import type { OAuthProviderConfig, OAuthUserInfo } from '../providers/types';

type ProviderId = 'github' | 'google';

type MutableConfig = {
  disableRateLimit: boolean;
  frontend: { url: string };
  auth: Record<string, string | undefined>;
};

const CREDENTIAL_KEYS = [
  'githubClientId',
  'githubClientSecret',
  'googleClientId',
  'googleClientSecret',
] as const;

let ctx: TestApp;
let mutableConfig: MutableConfig;
let providers: Record<ProviderId, OAuthProviderConfig>;
let original: { disableRateLimit: boolean; auth: Record<string, string | undefined> };
let exchanges: Record<ProviderId, ReturnType<typeof spyOn>>;
const spies: { mockRestore: () => void }[] = [];

beforeEach(async () => {
  ctx = await createTestApp();
  // App modules must be imported after createTestApp, or they bind the wrong database.
  mutableConfig = (await import('../../../config')).CONFIG as unknown as MutableConfig;
  providers = {
    github: (await import('../providers/github')).githubAuthProvider,
    google: (await import('../providers/google')).googleAuthProvider,
  };
  original = {
    disableRateLimit: mutableConfig.disableRateLimit,
    auth: Object.fromEntries(CREDENTIAL_KEYS.map((key) => [key, mutableConfig.auth[key]])),
  };
  mutableConfig.disableRateLimit = true;
  for (const key of CREDENTIAL_KEYS) mutableConfig.auth[key] = `test-${key}`;
  exchanges = {
    github: spyOn(providers.github, 'validateAuthorizationCode').mockResolvedValue({
      accessToken: 'provider-access-token',
    }),
    google: spyOn(providers.google, 'validateAuthorizationCode').mockResolvedValue({
      accessToken: 'provider-access-token',
    }),
  };
  spies.push(exchanges.github, exchanges.google);
});

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  mutableConfig.disableRateLimit = original.disableRateLimit;
  Object.assign(mutableConfig.auth, original.auth);
  ctx.close();
});

function providerReturns(provider: ProviderId, info: OAuthUserInfo): void {
  spies.push(spyOn(providers[provider], 'fetchUserInfo').mockResolvedValue(info));
}

async function startLink(provider: ProviderId): Promise<string> {
  const start = await ctx.authed('GET', `/api/v1/auth/link/${provider}`);
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get('location') ?? '');
  const state = authorize.searchParams.get('state');
  const redirectUri = authorize.searchParams.get('redirect_uri');
  expect(state, 'the authorize redirect must carry a state').toBeTruthy();
  expect(redirectUri, 'the authorize redirect must name where the provider returns').toBeTruthy();

  const providerReturn = new URL(redirectUri ?? '');
  providerReturn.searchParams.set('code', 'auth-code');
  providerReturn.searchParams.set('state', state ?? '');
  return `${providerReturn.pathname}${providerReturn.search}`;
}

async function finishLink(providerReturn: string, cookie = ctx.cookie): Promise<Response> {
  return ctx.app.request(providerReturn, {
    headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' },
  });
}

async function linkRoundTrip(provider: ProviderId = 'github'): Promise<Response> {
  return finishLink(await startLink(provider));
}

function linkedOwner(provider: ProviderId, providerAccountId: string): string | undefined {
  const row = ctx.sqlite
    .query(
      "SELECT user_id FROM user_providers WHERE domain = 'auth' AND provider_type = ? AND provider_account_id = ?"
    )
    .get(provider, providerAccountId) as { user_id: string } | null;
  return row?.user_id;
}

const profile = (query: string) => `${mutableConfig.frontend.url}/profile?${query}`;

describe('linking a second sign-in account from Profile', () => {
  test('GitHub: the provider returns to the link callback, which links the account', async () => {
    providerReturns('github', {
      providerAccountId: 'gh-second',
      email: 'second@example.com',
      displayName: 'Second Account',
    });

    const res = await linkRoundTrip('github');

    expect(res.headers.get('location')).toBe(profile('success=linked'));
    expect(linkedOwner('github', 'gh-second')).toBe(ctx.user.id);
    expect(exchanges.github).toHaveBeenCalledWith('auth-code', undefined, 'link');
  });

  test('Google: the provider returns to the link callback, which links the account', async () => {
    providerReturns('google', {
      providerAccountId: 'google-second',
      email: 'second@example.com',
      displayName: 'Second Account',
    });

    const providerReturn = await startLink('google');
    expect(new URL(providerReturn, 'http://x').pathname).toBe('/api/v1/auth/callback/link/google');
    const res = await finishLink(providerReturn);

    expect(res.headers.get('location')).toBe(profile('success=linked'));
    expect(linkedOwner('google', 'google-second')).toBe(ctx.user.id);
    expect(exchanges.google).toHaveBeenCalledWith('auth-code', expect.any(String), 'link');
  });

  test('a different signed-in user cannot finish the link', async () => {
    providerReturns('github', {
      providerAccountId: 'gh-started-by-owner',
      email: 'owner-second@example.com',
      displayName: 'Owner Second',
    });
    const other = await createInvitee(ctx, 'link-other');

    const providerReturn = await startLink('github');
    const res = await finishLink(providerReturn, other.cookie);

    expect(res.headers.get('location')).toBe(profile('link_error=session_mismatch'));
    expect(linkedOwner('github', 'gh-started-by-owner')).toBeUndefined();
    expect(exchanges.github).not.toHaveBeenCalled();
  });

  test('an identity this user already linked is reported, not duplicated', async () => {
    providerReturns('github', {
      providerAccountId: 'gh-same',
      email: 'same@example.com',
      displayName: 'S',
    });
    const first = await linkRoundTrip();
    expect(first.headers.get('location')).toBe(profile('success=linked'));
    expect(linkedOwner('github', 'gh-same')).toBe(ctx.user.id);

    const again = await linkRoundTrip();

    expect(again.headers.get('location')).toBe(profile('link_error=already_linked'));
    const rows = ctx.sqlite
      .query("SELECT COUNT(*) AS n FROM user_providers WHERE provider_account_id = 'gh-same'")
      .get() as { n: number };
    expect(rows.n).toBe(1);
  });

  test('an identity bound to another user is refused and stays with that user', async () => {
    ctx.sqlite.run(
      "INSERT INTO users (id, email, display_name) VALUES ('other-user', 'other@example.com', 'O')"
    );
    ctx.sqlite.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, config)
       VALUES ('up-other', 'other-user', 'auth', 'github', 'gh-taken', 'GitHub', '', '{}')`
    );
    providerReturns('github', {
      providerAccountId: 'gh-taken',
      email: 'taken@example.com',
      displayName: 'T',
    });

    const res = await linkRoundTrip();

    expect(res.headers.get('location')).toBe(profile('link_error=account_conflict'));
    expect(linkedOwner('github', 'gh-taken')).toBe('other-user');
  });
});
