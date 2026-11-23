import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type FakeOidcIssuer, startFakeOidcIssuer } from '../../../test-helpers/fake-oidc-issuer';
import { createTestApp, json, type TestApp } from '../../../test-helpers/http-client';

type MutableConfig = {
  disableRateLimit: boolean;
  frontend: { url: string };
  auth: Record<string, unknown> & { oidc: Record<string, string> };
};

const SIGN_IN_KEYS = [
  'googleClientId',
  'googleClientSecret',
  'githubClientId',
  'githubClientSecret',
];

let ctx: TestApp;
let config: MutableConfig;
let issuer: FakeOidcIssuer;
let saved: {
  disableRateLimit: boolean;
  auth: Record<string, unknown>;
  oidc: Record<string, string>;
};
let discoverOidc: () => Promise<void>;
let hasSignInProvider: () => boolean;

beforeEach(async () => {
  ctx = await createTestApp();
  const configModule = await import('../../../config');
  config = configModule.CONFIG as unknown as MutableConfig;
  hasSignInProvider = configModule.hasSignInProvider;
  ({ discoverOidc } = await import('../providers/oidc'));
  saved = {
    disableRateLimit: config.disableRateLimit,
    auth: Object.fromEntries(SIGN_IN_KEYS.map((key) => [key, config.auth[key]])),
    oidc: { ...config.auth.oidc },
  };
  issuer = startFakeOidcIssuer({
    sub: 'idp-user-1',
    email: 'pat@example.com',
    email_verified: true,
    name: 'Pat',
  });
  config.disableRateLimit = true;
  for (const key of SIGN_IN_KEYS) config.auth[key] = '';
  Object.assign(config.auth.oidc, {
    issuer: issuer.issuer,
    clientId: 'vroom',
    clientSecret: 'oidc-secret',
    redirectUri: 'http://localhost:3001/api/v1/auth/callback/oidc',
    linkRedirectUri: 'http://localhost:3001/api/v1/auth/callback/link/oidc',
    displayName: 'Pocket ID',
  });
  await discoverOidc();
});

afterEach(async () => {
  config.disableRateLimit = saved.disableRateLimit;
  Object.assign(config.auth, saved.auth);
  Object.assign(config.auth.oidc, saved.oidc);
  issuer.stop();
  await discoverOidc();
  ctx.close();
});

function providerReturn(location: string | null): string {
  const authorize = new URL(location ?? '');
  expect(authorize.origin).toBe(issuer.issuer);
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  const back = new URL(authorize.searchParams.get('redirect_uri') ?? '');
  back.searchParams.set('code', 'idp-code');
  back.searchParams.set('state', authorize.searchParams.get('state') ?? '');
  return `${back.pathname}${back.search}`;
}

describe('a deployment with only OIDC configured', () => {
  test('counts as having a sign-in provider and lists only OIDC', async () => {
    expect(hasSignInProvider()).toBe(true);
    const res = await ctx.anon('GET', '/api/v1/auth/providers');
    expect((await json<{ data: unknown }>(res)).data).toEqual([
      { id: 'oidc', displayName: 'Pocket ID' },
    ]);
  });

  test('signs a new user in through the issuer with PKCE and a verified email', async () => {
    const start = await ctx.app.request('/api/v1/auth/login/oidc');
    expect(start.status).toBe(302);
    const stateCookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    const done = await ctx.app.request(providerReturn(start.headers.get('location')), {
      headers: { Cookie: stateCookie },
    });

    expect(done.status).toBe(302);
    expect(done.headers.get('location')).toBe(`${config.frontend.url}/dashboard`);
    expect(issuer.tokenRequests[0]?.get('code_verifier')).toBeTruthy();
    const user = ctx.sqlite
      .query("SELECT display_name FROM users WHERE email = 'pat@example.com'")
      .get() as { display_name: string } | null;
    expect(user?.display_name).toBe('Pat');
  });

  test('refuses an account whose email the issuer has not verified', async () => {
    issuer.user = { ...issuer.user, email_verified: false };
    const start = await ctx.app.request('/api/v1/auth/login/oidc');
    const stateCookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const done = await ctx.app.request(providerReturn(start.headers.get('location')), {
      headers: { Cookie: stateCookie },
    });
    expect(done.headers.get('location')).toBe(`${config.frontend.url}/auth?auth_error=no_email`);
  });

  test('links OIDC to a signed-in account through the link callback', async () => {
    const start = await ctx.authed('GET', '/api/v1/auth/link/oidc');
    expect(start.status).toBe(302);
    const back = providerReturn(start.headers.get('location'));
    expect(back.startsWith('/api/v1/auth/callback/link/oidc')).toBe(true);

    const done = await ctx.app.request(back, {
      headers: { Cookie: ctx.cookie, 'Sec-Fetch-Site': 'cross-site' },
    });

    expect(done.headers.get('location')).toBe(`${config.frontend.url}/profile?success=linked`);
    const linked = ctx.sqlite
      .query(
        "SELECT user_id FROM user_providers WHERE domain = 'auth' AND provider_type = 'oidc' AND provider_account_id = 'idp-user-1'"
      )
      .get() as { user_id: string } | null;
    expect(linked?.user_id).toBe(ctx.user.id);
  });

  test('hides OIDC when discovery fails', async () => {
    issuer.stop();
    await discoverOidc();
    const res = await ctx.anon('GET', '/api/v1/auth/providers');
    expect((await json<{ data: unknown[] }>(res)).data).toEqual([]);
  });
});
