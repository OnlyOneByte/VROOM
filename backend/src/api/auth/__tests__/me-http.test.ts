import { beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

interface MeResponse {
  success: boolean;
  data: {
    user: { id: string; email: string; displayName: string; createdAt: string | null };
    session: { id: string; expiresAt: string };
  };
}

beforeEach(async () => {
  ctx = await createTestApp();
});

describe('GET /api/v1/auth/me', () => {
  test('401 without a session', async () => {
    const res = await ctx.anon('GET', '/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  test('returns the session user with a serialized createdAt (Member Since source)', async () => {
    const res = await ctx.authed('GET', '/api/v1/auth/me');
    expect(res.status).toBe(200);

    const body = (await res.json()) as MeResponse;
    expect(body.data.user.id).toBe(ctx.user.id);
    expect(body.data.user.email).toBe(ctx.user.email);

    expect(body.data.user.createdAt).toBeTruthy();
    const parsed = new Date(body.data.user.createdAt as string);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
  });
});

describe('POST /api/v1/auth/refresh — success body shape', () => {
  test('refreshes a valid session to 200 with the full serialized user + session', async () => {
    const res = await ctx.authed('POST', '/api/v1/auth/refresh');
    expect(res.status).toBe(200);

    const body = (await res.json()) as MeResponse & {
      data: { user: { updatedAt: string | null } };
    };
    expect(body.success).toBe(true);
    expect(body.data.user.id).toBe(ctx.user.id);
    expect(body.data.user.email).toBe(ctx.user.email);
    expect(typeof body.data.user.displayName).toBe('string');
    expect(body.data.user.createdAt).toBeTruthy();
    expect(Number.isNaN(new Date(body.data.user.createdAt as string).getTime())).toBe(false);
    expect(body.data.user.updatedAt).toBeTruthy();
    expect(Number.isNaN(new Date(body.data.user.updatedAt as string).getTime())).toBe(false);
    expect(body.data.session.id).toBeTruthy();
    expect(body.data.session.expiresAt).toBeTruthy();
  });
});

interface ErrorEnvelope {
  success: false;
  error: { code: string; message: string };
}

describe('PATCH /api/v1/auth/me — validation errors via the central handler', () => {
  test('401 without a session (requireAuth, before body parsing)', async () => {
    const res = await ctx.anon('PATCH', '/api/v1/auth/me', { displayName: 'Whoever' });
    expect(res.status).toBe(401);
  });

  test('missing displayName → 400 in the canonical envelope (code HTTPException)', async () => {
    const res = await ctx.authed('PATCH', '/api/v1/auth/me', {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('HTTPException');
    expect(body.error.message).toBe('displayName is required');
  });

  test('out-of-range displayName → 400 with the length message', async () => {
    const res = await ctx.authed('PATCH', '/api/v1/auth/me', { displayName: '' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.message).toBe('displayName must be between 1 and 100 characters');
  });

  test('a valid displayName update succeeds', async () => {
    const res = await ctx.authed('PATCH', '/api/v1/auth/me', { displayName: 'Renamed User' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { user: { displayName: string } };
    };
    expect(body.success).toBe(true);
    expect(body.data.user.displayName).toBe('Renamed User');
  });
});

describe('bad-session 401 clears the session cookie', () => {
  async function withGarbageSession(method: string, path: string): Promise<Response> {
    const cookieName = ctx.cookie.split('=')[0];
    return ctx.app.request(path, {
      method,
      headers: { Cookie: `${cookieName}=not-a-real-session-id`, 'Sec-Fetch-Site': 'same-origin' },
    });
  }

  function clearsSessionCookie(res: Response): boolean {
    const setCookie = res.headers.get('set-cookie') ?? '';
    const cookieName = ctx.cookie.split('=')[0];
    return (
      setCookie.includes(cookieName) &&
      (setCookie.toLowerCase().includes('max-age=0') ||
        setCookie.includes('Expires=Thu, 01 Jan 1970'))
    );
  }

  test('GET /me with an invalid session → 401 + a clearing Set-Cookie', async () => {
    const res = await withGarbageSession('GET', '/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(clearsSessionCookie(res)).toBe(true);
  });

  test('POST /refresh with an invalid session → 401 + a clearing Set-Cookie', async () => {
    const res = await withGarbageSession('POST', '/api/v1/auth/refresh');
    expect(res.status).toBe(401);
    expect(clearsSessionCookie(res)).toBe(true);
  });

  test('a missing session (no cookie) is a plain 401', async () => {
    const res = await ctx.anon('GET', '/api/v1/auth/me');
    expect(res.status).toBe(401);
  });
});
