import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { CONFIG } from '../../../config';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { consumePending, getPendingEmail } from '../../../utils/pending-credentials';

let ctx: TestApp;
let googleStorageClient: typeof import('../providers/google').googleStorageClient;
const spies: { mockRestore: () => void }[] = [];

const APPEND_ONLY = 'https://www.googleapis.com/auth/photoslibrary.appendonly';
const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';

beforeEach(async () => {
  ctx = await createTestApp();
  ({ googleStorageClient } = await import('../providers/google'));
}, SETUP_TIMEOUT_MS);

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  ctx.close();
});

async function connect(query: string): Promise<URL> {
  const res = await ctx.authed(
    'GET',
    `/api/v1/auth/providers/connect/google?returnTo=%2Fsettings%2Fproviders%2Fnew&nonce=n-1${query}`
  );
  expect(res.status).toBe(302);
  return new URL(res.headers.get('location') ?? '');
}

function scopesOf(url: URL): string[] {
  return (url.searchParams.get('scope') ?? '').split(' ');
}

function googleGrants(scopes: string[]): void {
  spies.push(
    spyOn(googleStorageClient, 'validateAuthorizationCode').mockResolvedValue({
      accessToken: () => 'access',
      hasRefreshToken: () => true,
      refreshToken: () => 'refresh',
      hasScopes: () => true,
      scopes: () => scopes,
    } as unknown as Awaited<ReturnType<typeof googleStorageClient.validateAuthorizationCode>>),
    spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ email: 'me@example.com', email_verified: true })
    )
  );
}

async function callback(authorize: URL): Promise<URL> {
  const state = authorize.searchParams.get('state') ?? '';
  const res = await ctx.authed(
    'GET',
    `/api/v1/auth/callback/provider/google?code=c&state=${encodeURIComponent(state)}`
  );
  return new URL(res.headers.get('location') ?? '');
}

describe('connecting Google storage asks only for what the provider needs', () => {
  test('Google Photos asks for the upload scope, incrementally', async () => {
    const url = await connect('&providerType=google-photos');
    expect(scopesOf(url)).toContain(APPEND_ONLY);
    expect(scopesOf(url)).not.toContain(DRIVE_FILE);
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
  });

  test('Google Drive keeps its own scopes and never asks to upload to Photos', async () => {
    for (const query of ['', '&providerType=google-drive']) {
      const url = await connect(query);
      expect(scopesOf(url)).toContain(DRIVE_FILE);
      expect(scopesOf(url)).not.toContain(APPEND_ONLY);
      expect(url.searchParams.has('include_granted_scopes')).toBe(false);
    }
  });

  test('reconnecting an existing provider asks for the scopes of its own type, whatever the query says', async () => {
    ctx.sqlite.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, config, status)
       VALUES ('photos-1', ?, 'storage', 'google-photos', 'Photos', 'x', '{}', 'active')`,
      [ctx.user.id]
    );
    const url = await connect('&providerId=photos-1&providerType=google-drive');
    expect(scopesOf(url)).toContain(APPEND_ONLY);
    expect(scopesOf(url)).not.toContain(DRIVE_FILE);
  });

  test('a stored Google Photos grant remembers it was made for Google Photos', async () => {
    googleGrants(['openid', 'email', APPEND_ONLY]);
    await callback(await connect('&providerType=google-photos'));
    expect(consumePending(ctx.user.id, 'n-1')?.providerType).toBe('google-photos');
  });

  test('an unknown provider type is refused', async () => {
    const res = await ctx.authed(
      'GET',
      '/api/v1/auth/providers/connect/google?returnTo=%2Fsettings&nonce=n-1&providerType=s3'
    );
    expect(res.status).toBe(400);
  });

  test('a Google Photos grant without the upload scope is refused, and nothing is stored', async () => {
    googleGrants(['openid', 'email']);
    const location = await callback(await connect('&providerType=google-photos'));
    expect(location.searchParams.get('provider_error')).toBe('missing_scope');
    expect(getPendingEmail(ctx.user.id, 'n-1')).toBeNull();
  });

  test('a Google Photos grant with the upload scope connects', async () => {
    googleGrants(['openid', 'email', APPEND_ONLY]);
    const location = await callback(await connect('&providerType=google-photos'));
    expect(location.searchParams.get('provider_connected')).toBe('true');
    expect(getPendingEmail(ctx.user.id, 'n-1')).toBe('me@example.com');
  });
});

describe('an OAuth return re-checks the permission that started it', () => {
  const denyOnServer = (permission: string) =>
    ctx.sqlite.run(
      "INSERT INTO permission_overrides (id, user_id, scope, scope_id, permission, effect) VALUES (?, ?, 'server', NULL, ?, 'deny')",
      [`po-${permission}`, ctx.user.id, permission]
    );

  test('connecting a provider stops when the permission was taken away meanwhile', async () => {
    const url = await connect('&providerType=google-photos');
    denyOnServer('account.provider.manage');
    expect((await callback(url)).searchParams.get('provider_error')).toBe('forbidden');
  });

  test('linking a sign-in method stops when the permission was taken away meanwhile', async () => {
    const auth = CONFIG.auth as { googleClientId?: string; googleClientSecret?: string };
    const previous = { ...auth };
    auth.googleClientId = 'test-client';
    auth.googleClientSecret = 'test-secret';
    spies.push({ mockRestore: () => Object.assign(auth, previous) });
    const start = await ctx.authed('GET', '/api/v1/auth/link/google');
    expect(start.status).toBe(302);
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    denyOnServer('account.signin.manage');
    const res = await ctx.authed(
      'GET',
      `/api/v1/auth/callback/link/google?code=c&state=${encodeURIComponent(state)}`
    );
    expect(new URL(res.headers.get('location') ?? '').searchParams.get('link_error')).toBe(
      'forbidden'
    );
  });
});
