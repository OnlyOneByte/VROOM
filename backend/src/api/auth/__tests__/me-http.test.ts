/**
 * HTTP-level test for GET /api/v1/auth/me.
 *
 * REGRESSION GUARD (cycle 14 UI review): the profile page's "Member Since" row
 * rendered "—" for a logged-in user because the /me handler serialized only
 * { id, email, displayName } and dropped `createdAt` — even though the column
 * exists, Lucia validates the full row, and the frontend User type expects
 * `createdAt: string`. This pins createdAt back into the response shape.
 */

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

    // The regression: createdAt must be present and ISO-parseable, not dropped.
    expect(body.data.user.createdAt).toBeTruthy();
    const parsed = new Date(body.data.user.createdAt as string);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
  });
});

/**
 * Convergence guard (C56, arch #1): the auth route does NOT hand-roll an error envelope —
 * its validation handlers throw `HTTPException` directly and rely on the central
 * `errorHandler` (error-handler.ts:43) to shape it as `{ success:false, error:{ code, message } }`.
 * These pin that PATCH /me's 400 paths surface through that central handler with the canonical
 * envelope (code 'HTTPException'), so a future "let's add a local try/catch back" or a handler
 * change can't silently diverge from the shared shape. (Auth was verified already-converged — no
 * try/catch drop was needed/safe; these lock that conclusion merge-surviving.)
 */
interface ErrorEnvelope {
  success: false;
  error: { code: string; message: string };
}

describe('PATCH /api/v1/auth/me — validation errors via the central handler (convergence guard)', () => {
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

  test('a valid displayName update still succeeds (200) — positive control', async () => {
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

/**
 * Hygiene guard (C127, #32a — surfaced by the C126 auth deep-review): GET /me and POST /refresh threw
 * 401 on an INVALID/expired session cookie but never cleared it, diverging from requireAuth + logout.
 * A dead session cookie should be cleared so the browser stops re-sending it (OWASP session-mgmt; ARCC
 * secure-cookie-handling). These pin that a bad-session 401 now also emits a clearing Set-Cookie.
 *
 * The session is already invalid server-side (not replayable) — this is hygiene, not a vuln fix — but
 * the cleared cookie is the documented contract, so it's pinned merge-surviving.
 */
describe('bad-session 401 clears the session cookie (C127 #32a)', () => {
  // A request carrying the real session-cookie NAME but a garbage value → an invalid session.
  async function withGarbageSession(method: string, path: string): Promise<Response> {
    const cookieName = ctx.cookie.split('=')[0];
    return ctx.app.request(path, {
      method,
      headers: { Cookie: `${cookieName}=not-a-real-session-id`, 'Sec-Fetch-Site': 'same-origin' },
    });
  }

  // Hono's deleteCookie clears by setting an expired Set-Cookie for the name → the header carries the
  // cookie name + a Max-Age=0 / Expires-in-the-past directive.
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

  test('a MISSING session (no cookie) is still a plain 401 (no clear needed — nothing to clear)', async () => {
    const res = await ctx.anon('GET', '/api/v1/auth/me');
    expect(res.status).toBe(401);
  });
});
