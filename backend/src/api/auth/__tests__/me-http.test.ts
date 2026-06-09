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
