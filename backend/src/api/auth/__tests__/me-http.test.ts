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
