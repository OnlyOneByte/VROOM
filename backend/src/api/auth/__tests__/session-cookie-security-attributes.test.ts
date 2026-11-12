import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;
let config: { env: string };
let originalEnv: string;

beforeEach(async () => {
  ctx = await createTestApp();
  config = (await import('../../../config')).CONFIG as unknown as { env: string };
  originalEnv = config.env;
});
afterEach(() => {
  config.env = originalEnv;
  ctx.close();
});

const BOGUS_COOKIE = 'auth_session=not-a-real-session';

function withCookie(method: string, path: string, cookie: string): Promise<Response> {
  // csrf() requires Sec-Fetch-Site on POST, as browsers send.
  const headers = { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' };
  return Promise.resolve(ctx.app.request(path, { method, headers }));
}

function agePastHalfLife(): void {
  const id = ctx.cookie.split('=')[1];
  const twentyHoursFromNow = Math.floor((Date.now() + 20 * 60 * 60 * 1000) / 1000);
  ctx.sqlite.run('UPDATE sessions SET expires_at = ? WHERE id = ?', [twentyHoursFromNow, id]);
}

const SITES: { name: string; send: () => Promise<Response> }[] = [
  {
    name: 'POST /logout clears',
    send: () => withCookie('POST', '/api/v1/auth/logout', ctx.cookie),
  },
  {
    name: 'GET /me with a dead session clears',
    send: () => withCookie('GET', '/api/v1/auth/me', BOGUS_COOKIE),
  },
  {
    name: 'POST /refresh with a dead session clears',
    send: () => withCookie('POST', '/api/v1/auth/refresh', BOGUS_COOKIE),
  },
  {
    name: 'POST /refresh on an extended session re-issues',
    send: () => {
      agePastHalfLife();
      return withCookie('POST', '/api/v1/auth/refresh', ctx.cookie);
    },
  },
];

describe('session-cookie security attributes are uniform across every write and delete', () => {
  for (const { name, send } of SITES) {
    test(`${name} with HttpOnly, SameSite=Lax, Path=/, and no Secure outside production`, async () => {
      const setCookie = (await send()).headers.get('set-cookie') ?? '';
      expect(setCookie, 'the path must write the session cookie').toContain('auth_session=');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).toContain('Path=/');
      expect(setCookie).not.toContain('Secure');
    });

    test(`${name} with Secure in production`, async () => {
      config.env = 'production';
      const setCookie = (await send()).headers.get('set-cookie') ?? '';
      expect(setCookie).toContain('auth_session=');
      expect(setCookie).toContain('Secure');
    });
  }
});
