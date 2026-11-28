import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { type FakeOidcIssuer, startFakeOidcIssuer } from '../../../test-helpers/fake-oidc-issuer';
import {
  createTestApp,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { logger } from '../../../utils/logger';

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
let ensureOidcDiscovered: () => Promise<void>;
let hasSignInProvider: () => boolean;

beforeEach(async () => {
  ctx = await createTestApp();
  const configModule = await import('../../../config');
  config = configModule.CONFIG as unknown as MutableConfig;
  hasSignInProvider = configModule.hasSignInProvider;
  ({ discoverOidc, ensureOidcDiscovered } = await import('../providers/oidc'));
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
}, SETUP_TIMEOUT_MS);

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

  async function signInLocation(): Promise<string | null> {
    const start = await ctx.app.request('/api/v1/auth/login/oidc');
    const stateCookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const done = await ctx.app.request(providerReturn(start.headers.get('location')), {
      headers: { Cookie: stateCookie },
    });
    return done.headers.get('location');
  }

  test.each<[string, unknown, string]>([
    ['false', false, '"emailVerified":"false"'],
    ['the string "false"', 'false', '"emailVerified":"false"'],
    ['the string "True"', 'True', '"emailVerified":"True"'],
    ['the string "1"', '1', '"emailVerified":"1"'],
    ['missing', undefined, '"emailVerified":"missing"'],
    ['an object', { toString: 1 }, '"emailVerified":"a object"'],
  ])(
    'refuses an account whose email_verified is %s, and logs why',
    async (_, emailVerified, cause) => {
      issuer.user = { ...issuer.user, email_verified: emailVerified };
      const warn = spyOn(logger, 'warn').mockImplementation(() => {});
      try {
        expect(await signInLocation()).toBe(`${config.frontend.url}/auth?auth_error=no_email`);
        const logged = JSON.stringify(warn.mock.calls);
        expect(logged).toContain('no verified email');
        expect(logged).toContain(cause);
        expect(logged).not.toContain('pat@example.com');
      } finally {
        warn.mockRestore();
      }
    }
  );

  test('accepts email_verified sent as the string "true", as some issuers do', async () => {
    issuer.user = { ...issuer.user, email_verified: 'true' };
    expect(await signInLocation()).toBe(`${config.frontend.url}/dashboard`);
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
        "SELECT user_id FROM user_providers WHERE domain = 'auth' AND provider_type = 'oidc' AND provider_account_id = ?"
      )
      .get(`${issuer.issuer}|idp-user-1`) as { user_id: string } | null;
    expect(linked?.user_id).toBe(ctx.user.id);
  });

  async function signIn(): Promise<Response> {
    const start = await ctx.app.request('/api/v1/auth/login/oidc');
    const stateCookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    return ctx.app.request(providerReturn(start.headers.get('location')), {
      headers: { Cookie: stateCookie },
    });
  }

  test('an identity is scoped to its issuer, so a new issuer with the same subject is a new identity', async () => {
    expect((await signIn()).headers.get('location')).toBe(`${config.frontend.url}/dashboard`);

    const other = startFakeOidcIssuer({ ...issuer.user, email: 'someone-else@example.com' });
    try {
      config.auth.oidc.issuer = other.issuer;
      await discoverOidc();
      issuer.stop();
      issuer = other;
      expect((await signIn()).headers.get('location')).toBe(`${config.frontend.url}/dashboard`);
    } finally {
      other.stop();
    }
    const owners = ctx.sqlite
      .query("SELECT COUNT(DISTINCT user_id) AS n FROM user_providers WHERE provider_type = 'oidc'")
      .get() as { n: number };
    expect(owners.n).toBe(2);
  });

  test('a discovery document naming another issuer leaves OIDC off', async () => {
    issuer.discoveryIssuer = 'https://elsewhere.example.com';
    await discoverOidc();
    const res = await ctx.anon('GET', '/api/v1/auth/providers');
    expect((await json<{ data: unknown[] }>(res)).data).toEqual([]);
  });

  test('discovery that failed at startup is retried on a later sign-in request', async () => {
    issuer.discoveryIssuer = 'https://elsewhere.example.com';
    await discoverOidc();
    issuer.discoveryIssuer = undefined;

    await ensureOidcDiscovered();
    expect(
      (await json<{ data: unknown[] }>(await ctx.anon('GET', '/api/v1/auth/providers'))).data
    ).toEqual([]);

    const later = Date.now() + 31_000;
    const clock = spyOn(Date, 'now').mockReturnValue(later);
    try {
      const res = await ctx.anon('GET', '/api/v1/auth/providers');
      expect((await json<{ data: unknown }>(res)).data).toEqual([
        { id: 'oidc', displayName: 'Pocket ID' },
      ]);
    } finally {
      clock.mockRestore();
    }
  });

  test('discovery carries a timeout, so an issuer that never answers cannot stall startup', async () => {
    const timeouts: number[] = [];
    const spy = spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      timeouts.push(ms);
      return AbortSignal.abort(new DOMException('The operation timed out.', 'TimeoutError'));
    });
    try {
      await discoverOidc();
    } finally {
      spy.mockRestore();
    }
    expect(timeouts.length).toBe(1);
    expect(
      (await json<{ data: unknown[] }>(await ctx.anon('GET', '/api/v1/auth/providers'))).data
    ).toEqual([]);
  });

  test('hides OIDC when discovery fails', async () => {
    issuer.stop();
    await discoverOidc();
    const res = await ctx.anon('GET', '/api/v1/auth/providers');
    expect((await json<{ data: unknown[] }>(res)).data).toEqual([]);
  });
});
