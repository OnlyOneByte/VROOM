/**
 * Regression guard: the provider-OAuth `returnTo` must never steer the browser off this origin.
 *
 * `GET /auth/providers/connect/google?returnTo=…` stores the caller's path in the OAuth state, and
 * the callback reports the outcome by redirecting to `${CONFIG.frontend.url}<returnTo>?provider_…`.
 * Concatenating an unvalidated value there is an open redirect wearing the app's own origin: a
 * `returnTo` of `@evil.example.com/phish` makes `http://localhost:5173` the URL's *userinfo*, so the
 * browser resolves the host to `evil.example.com` from a link that visually starts with the real
 * app. A `returnTo` carrying its own `?` is a quieter failure in the same place — the appended
 * `provider_connected`/`nonce` land inside a parameter value and the connect flow silently stops
 * picking up the credential it just obtained.
 *
 * The predicate is unit-tested against both hazard classes (it is the whole fix), and the HTTP legs
 * pin that intake rejects a hostile value and that a legitimate path still round-trips.
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
    // userinfo hijack: concatenated onto the origin this makes the attacker the host.
    expect(isSafeReturnPath('@evil.example.com/phish')).toBe(false);
    // scheme-relative authorities.
    expect(isSafeReturnPath('//evil.example.com/x')).toBe(false);
    expect(isSafeReturnPath('/\\evil.example.com/x')).toBe(false);
    // absolute URLs.
    expect(isSafeReturnPath('https://evil.example.com')).toBe(false);
    expect(isSafeReturnPath('javascript:alert(1)')).toBe(false);
    // not a path at all.
    expect(isSafeReturnPath('settings/providers/new')).toBe(false);
    expect(isSafeReturnPath('')).toBe(false);
    expect(isSafeReturnPath(undefined)).toBe(false);
  });

  test('rejects a value that would corrupt the appended callback query', () => {
    // The callback appends `?provider_error=…`; a returnTo with its own query or fragment would
    // bury that parameter inside a value, so the frontend never learns the outcome.
    expect(isSafeReturnPath('/settings/providers/new?x=1')).toBe(false);
    expect(isSafeReturnPath('/settings/providers/new#frag')).toBe(false);
    // CRLF, which otherwise reaches the Location header.
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

  test('a legitimate path round-trips, and the callback reflects it on this origin', async () => {
    const connect = await ctx.authed(
      'GET',
      '/api/v1/auth/providers/connect/google?returnTo=%2Fsettings%2Fproviders%2Fnew&nonce=abc'
    );
    expect(connect.status).toBe(302);
    const authorizeUrl = new URL(connect.headers.get('location') ?? '');
    const state = authorizeUrl.searchParams.get('state') ?? '';
    expect(state).not.toBe('');

    // Drive the cancellation leg (no `code`) — the cheapest path back through the reflection site.
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
