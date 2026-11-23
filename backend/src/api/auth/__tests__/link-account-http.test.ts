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
let original: { disableRateLimit: boolean; githubClientId?: string; githubClientSecret?: string };
let exchange: ReturnType<typeof spyOn>;
const spies: { mockRestore: () => void }[] = [];

beforeEach(async () => {
  ctx = await createTestApp();
  // App modules must be imported after createTestApp, or they bind the wrong database.
  mutableConfig = (await import('../../../config')).CONFIG as unknown as MutableConfig;
  ({ githubAuthProvider } = await import('../providers/github'));
  original = {
    disableRateLimit: mutableConfig.disableRateLimit,
    githubClientId: mutableConfig.auth.githubClientId,
    githubClientSecret: mutableConfig.auth.githubClientSecret,
  };
  mutableConfig.disableRateLimit = true;
  mutableConfig.auth.githubClientId = 'test-client-id';
  mutableConfig.auth.githubClientSecret = 'test-client-secret';
  exchange = spyOn(githubAuthProvider, 'validateAuthorizationCode').mockResolvedValue({
    accessToken: 'provider-access-token',
  });
  spies.push(exchange);
});

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  mutableConfig.disableRateLimit = original.disableRateLimit;
  mutableConfig.auth.githubClientId = original.githubClientId;
  mutableConfig.auth.githubClientSecret = original.githubClientSecret;
  ctx.close();
});

function providerReturns(info: OAuthUserInfo): void {
  spies.push(spyOn(githubAuthProvider, 'fetchUserInfo').mockResolvedValue(info));
}

async function linkRoundTrip(): Promise<Response> {
  const start = await ctx.authed('GET', '/api/v1/auth/link/github');
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get('location') ?? '');
  const state = authorize.searchParams.get('state');
  const redirectUri = authorize.searchParams.get('redirect_uri');
  expect(state, 'the authorize redirect must carry a state').toBeTruthy();
  expect(redirectUri, 'the authorize redirect must name where the provider returns').toBeTruthy();

  const providerReturn = new URL(redirectUri ?? '');
  providerReturn.searchParams.set('code', 'auth-code');
  providerReturn.searchParams.set('state', state ?? '');
  return ctx.app.request(`${providerReturn.pathname}${providerReturn.search}`, {
    headers: { Cookie: ctx.cookie, 'Sec-Fetch-Site': 'cross-site' },
  });
}

function linkedOwner(providerAccountId: string): string | undefined {
  const row = ctx.sqlite
    .query(
      "SELECT user_id FROM user_providers WHERE domain = 'auth' AND provider_type = 'github' AND provider_account_id = ?"
    )
    .get(providerAccountId) as { user_id: string } | null;
  return row?.user_id;
}

describe('linking a second sign-in account from Profile', () => {
  test('the provider returns to the link callback, which links the account', async () => {
    providerReturns({
      providerAccountId: 'gh-second',
      email: 'second@example.com',
      displayName: 'Second Account',
    });

    const res = await linkRoundTrip();

    expect(res.headers.get('location')).toBe(
      `${mutableConfig.frontend.url}/profile?success=linked`
    );
    expect(linkedOwner('gh-second')).toBe(ctx.user.id);
    expect(exchange).toHaveBeenCalledWith('auth-code', undefined, 'link');
  });

  test('an identity this user already linked is reported, not duplicated', async () => {
    providerReturns({ providerAccountId: 'gh-same', email: 'same@example.com', displayName: 'S' });
    await linkRoundTrip();

    const again = await linkRoundTrip();

    expect(again.headers.get('location')).toBe(
      `${mutableConfig.frontend.url}/profile?link_error=already_linked`
    );
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
    providerReturns({
      providerAccountId: 'gh-taken',
      email: 'taken@example.com',
      displayName: 'T',
    });

    const res = await linkRoundTrip();

    expect(res.headers.get('location')).toBe(
      `${mutableConfig.frontend.url}/profile?link_error=account_conflict`
    );
    expect(linkedOwner('gh-taken')).toBe('other-user');
  });
});
