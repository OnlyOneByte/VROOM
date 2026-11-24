import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { getPendingEmail } from '../../../utils/pending-credentials';

let ctx: TestApp;
let googleStorageClient: typeof import('../providers/google').googleStorageClient;
const spies: { mockRestore: () => void }[] = [];

const APPEND_ONLY = 'https://www.googleapis.com/auth/photoslibrary.appendonly';
const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';

beforeEach(async () => {
  ctx = await createTestApp();
  ({ googleStorageClient } = await import('../providers/google'));
});

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
    }
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
