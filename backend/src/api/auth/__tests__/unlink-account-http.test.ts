/**
 * #C158 GUARD — DELETE /api/v1/auth/accounts/:id (unlink an auth provider).
 *
 * This route had ZERO coverage despite enforcing two load-bearing account-security invariants through the
 * REAL HTTP stack (verified firsthand C158, no defect — this pins them):
 *   1. LAST-ACCOUNT LOCKOUT GUARD: a user must keep at least one sign-in method. Unlinking the ONLY auth
 *      provider is refused (400 LAST_ACCOUNT) so the user can't lock themselves out. The count runs INSIDE
 *      the same transaction as the delete (concurrency-safe).
 *   2. CROSS-TENANT OWNERSHIP: the row must belong to the requesting user AND be domain='auth' — another
 *      user's account id (or a non-auth provider row) → 404, no deletion (NORTH_STAR #2 isolation).
 * Plus the happy path: with ≥2 auth providers, unlinking one returns 204 and leaves the others intact.
 *
 * Drives createTestApp() (real app + real Lucia session) and seeds auth provider rows via ctx.sqlite, since
 * the harness seeds only the users row. The session belongs to ctx.user.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

/** Insert an auth provider row for a user directly (the harness seeds none). Returns the row id. */
function seedAuthProvider(
  id: string,
  userId: string,
  providerType: string,
  accountId: string
): string {
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, status)
     VALUES (?, ?, 'auth', ?, ?, ?, '', 'active')`,
    [id, userId, providerType, accountId, `${providerType} account`]
  );
  return id;
}

function authProviderCount(userId: string): number {
  const row = ctx.sqlite
    .query(`SELECT COUNT(*) AS n FROM user_providers WHERE user_id = ? AND domain = 'auth'`)
    .get(userId) as { n: number };
  return row.n;
}

describe('DELETE /auth/accounts/:id — unlink an auth provider', () => {
  test('refuses to unlink the LAST sign-in method (400 LAST_ACCOUNT, row preserved)', async () => {
    const onlyId = seedAuthProvider('ap-only', ctx.user.id, 'google', 'g-1');
    const res = await ctx.authed('DELETE', `/api/v1/auth/accounts/${onlyId}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('LAST_ACCOUNT');
    // The lockout guard MUST leave the only sign-in method intact.
    expect(authProviderCount(ctx.user.id)).toBe(1);
  });

  test('unlinks one of TWO providers (204) and leaves the other intact', async () => {
    seedAuthProvider('ap-google', ctx.user.id, 'google', 'g-1');
    const githubId = seedAuthProvider('ap-github', ctx.user.id, 'github', 'gh-1');
    const res = await ctx.authed('DELETE', `/api/v1/auth/accounts/${githubId}`);
    expect(res.status).toBe(204);
    expect(authProviderCount(ctx.user.id)).toBe(1);
    // The surviving row is the one we did NOT delete.
    const remaining = ctx.sqlite
      .query(`SELECT id FROM user_providers WHERE user_id = ? AND domain = 'auth'`)
      .all(ctx.user.id) as Array<{ id: string }>;
    expect(remaining.map((r) => r.id)).toEqual(['ap-google']);
  });

  test("cannot unlink ANOTHER user's auth account (404, no cross-tenant deletion)", async () => {
    // Seed a second user + their auth provider directly.
    ctx.sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
      'other-user',
      'other@example.com',
      'Other',
    ]);
    const foreignId = seedAuthProvider('ap-foreign', 'other-user', 'google', 'g-foreign');
    // Our session also has its own account so the failure is the OWNERSHIP gate, not the last-account guard.
    seedAuthProvider('ap-mine', ctx.user.id, 'google', 'g-mine');

    const res = await ctx.authed('DELETE', `/api/v1/auth/accounts/${foreignId}`);
    expect(res.status).toBe(404);
    // The foreign row is untouched.
    expect(authProviderCount('other-user')).toBe(1);
  });

  test('a non-auth provider row (domain != auth) is not unlinkable via this route (404)', async () => {
    // Give the user an auth account so they're not at the last-account floor.
    seedAuthProvider('ap-auth', ctx.user.id, 'google', 'g-1');
    // A STORAGE provider row (domain='storage') must not be deletable through the auth-account route.
    ctx.sqlite.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, status)
       VALUES ('sp-1', ?, 'storage', 'google-drive', 'gd-1', 'Drive', '', 'active')`,
      [ctx.user.id]
    );
    const res = await ctx.authed('DELETE', '/api/v1/auth/accounts/sp-1');
    expect(res.status).toBe(404);
    // The storage row survives.
    const sp = ctx.sqlite.query(`SELECT id FROM user_providers WHERE id = 'sp-1'`).get();
    expect(sp).not.toBeNull();
  });
});
