import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';
import { spyOnGuarded } from '../../../test-helpers/transaction-guard';

let ctx: TestApp;
let googleAuthProvider: typeof import('../providers/google').googleAuthProvider;
let googleStorageClient: typeof import('../providers/google').googleStorageClient;
let NoVerifiedEmailError: typeof import('../providers/types').NoVerifiedEmailError;
const spies: { mockRestore: () => void }[] = [];

beforeEach(async () => {
  ctx = await createTestApp();
  ({ googleAuthProvider, googleStorageClient } = await import('../providers/google'));
  ({ NoVerifiedEmailError } = await import('../providers/types'));
}, SETUP_TIMEOUT_MS);

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  ctx.close();
});

function userinfoReturns(body: Record<string, unknown>): void {
  spies.push(
    spyOnGuarded(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
    )
  );
}

const baseUserinfo = { sub: 'google-sub-1', email: 'someone@example.com', name: 'Someone' };

describe('googleAuthProvider.fetchUserInfo', () => {
  test('returns the identity when the email is verified', async () => {
    userinfoReturns({ ...baseUserinfo, email_verified: true });
    const info = await googleAuthProvider.fetchUserInfo('token');
    expect(info.email).toBe('someone@example.com');
    expect(info.providerAccountId).toBe('google-sub-1');
  });

  test.each([
    ['false', { email_verified: false }],
    ['missing', {}],
    ['a string', { email_verified: 'true' }],
  ])('rejects when email_verified is %s', async (_label, extra) => {
    userinfoReturns({ ...baseUserinfo, ...extra });
    await expect(googleAuthProvider.fetchUserInfo('token')).rejects.toBeInstanceOf(
      NoVerifiedEmailError
    );
  });
});

describe('GET /auth/callback/provider/google', () => {
  async function connectAndCallback(emailVerified: boolean): Promise<URL> {
    spies.push(
      spyOn(googleStorageClient, 'validateAuthorizationCode').mockResolvedValue({
        accessToken: () => 'access',
        hasRefreshToken: () => true,
        refreshToken: () => 'refresh',
      } as unknown as Awaited<ReturnType<typeof googleStorageClient.validateAuthorizationCode>>)
    );
    userinfoReturns({ ...baseUserinfo, email_verified: emailVerified });

    const connect = await ctx.authed(
      'GET',
      '/api/v1/auth/providers/connect/google?returnTo=%2Fsettings%2Fproviders%2Fnew&nonce=abc'
    );
    const state = new URL(connect.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const callback = await ctx.authed(
      'GET',
      `/api/v1/auth/callback/provider/google?code=c&state=${encodeURIComponent(state)}`
    );
    expect(callback.status).toBe(302);
    return new URL(callback.headers.get('location') ?? '');
  }

  test('connects when the Google email is verified', async () => {
    const location = await connectAndCallback(true);
    expect(location.searchParams.get('provider_connected')).toBe('true');
  });

  test('refuses to connect when the Google email is not verified', async () => {
    const location = await connectAndCallback(false);
    expect(location.searchParams.get('provider_connected')).toBeNull();
    expect(location.searchParams.get('provider_error')).toBe('exchange_failed');
  });
});
