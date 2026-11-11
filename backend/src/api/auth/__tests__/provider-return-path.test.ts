/**
 * The provider-OAuth returnTo must never steer the browser off this origin, since the callback
 * redirects to `${frontend}${returnTo}`. Covers the isSafeReturnPath predicate and the HTTP intake
 * and round-trip.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { isSafeReturnPath } from '../routes';

let ctx: TestApp;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

describe('isSafeReturnPath', () => {
  test('accepts the same-origin paths the connect flow actually uses', () => {
    expect(isSafeReturnPath('/settings/providers/new')).toBe(true);
    expect(isSafeReturnPath('/settings/providers/abc123/edit')).toBe(true);
    expect(isSafeReturnPath('/')).toBe(true);
  });

  test('rejects every off-origin shape', () => {
    expect(isSafeReturnPath('@evil.example.com/phish')).toBe(false);
    expect(isSafeReturnPath('//evil.example.com/x')).toBe(false);
    expect(isSafeReturnPath('/\\evil.example.com/x')).toBe(false);
    expect(isSafeReturnPath('https://evil.example.com')).toBe(false);
    expect(isSafeReturnPath('javascript:alert(1)')).toBe(false);
    expect(isSafeReturnPath('settings/providers/new')).toBe(false);
    expect(isSafeReturnPath('')).toBe(false);
    expect(isSafeReturnPath(undefined)).toBe(false);
  });

  test('rejects a value that would corrupt the appended callback query', () => {
    expect(isSafeReturnPath('/settings/providers/new?x=1')).toBe(false);
    expect(isSafeReturnPath('/settings/providers/new#frag')).toBe(false);
    expect(isSafeReturnPath('/settings\r\nX-Injected: 1')).toBe(false);
  });
});

describe('GET /auth/providers/connect/google', () => {
  test('rejects a hostile returnTo at intake (400, no OAuth round-trip started)', async () => {
    const res = await ctx.authed(
      'GET',
      '/api/v1/auth/providers/connect/google?returnTo=%40evil.example.com%2Fphish&nonce=abc'
    );
    expect(
      res.status,
      'a returnTo that is not a same-origin path must be refused before it is stored'
    ).toBe(400);
  });

  test('a legitimate path round-trips and the callback redirects to it on this origin', async () => {
    const connect = await ctx.authed(
      'GET',
      '/api/v1/auth/providers/connect/google?returnTo=%2Fsettings%2Fproviders%2Fnew&nonce=abc'
    );
    expect(connect.status).toBe(302);
    const authorizeUrl = new URL(connect.headers.get('location') ?? '');
    const state = authorizeUrl.searchParams.get('state') ?? '';
    expect(state).not.toBe('');

    // The cancellation leg (no code) is the cheapest route back through the redirect.
    const callback = await ctx.authed(
      'GET',
      `/api/v1/auth/callback/provider/google?state=${encodeURIComponent(state)}`
    );
    expect(callback.status).toBe(302);
    const { CONFIG } = await import('../../../config');
    const location = new URL(callback.headers.get('location') ?? '');
    expect(location.host, 'the callback must never redirect off this origin').toBe(
      new URL(CONFIG.frontend.url).host
    );
    expect(location.pathname).toBe('/settings/providers/new');
    expect(location.searchParams.get('provider_error')).toBe('cancelled');
  });
});
