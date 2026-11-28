import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;
beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function seedAuthProvider(
  id: string,
  userId: string,
  providerType: string,
  accountId: string
): Promise<string> {
  await ctx.sql.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, status)
     VALUES (?, ?, 'auth', ?, ?, ?, '', 'active')`,
    [id, userId, providerType, accountId, `${providerType} account`]
  );
  return id;
}

async function authProviderCount(userId: string): Promise<number> {
  const row = (await ctx.sql.get(
    `SELECT COUNT(*) AS n FROM user_providers WHERE user_id = ? AND domain = 'auth'`,
    [userId]
  )) as { n: number };
  return row.n;
}

describe('DELETE /auth/accounts/:id — unlink an auth provider', () => {
  test('refuses to unlink the last sign-in method (400 LAST_ACCOUNT, row preserved)', async () => {
    const onlyId = await seedAuthProvider('ap-only', ctx.user.id, 'google', 'g-1');
    const res = await ctx.authed('DELETE', `/api/v1/auth/accounts/${onlyId}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('LAST_ACCOUNT');
    expect(await authProviderCount(ctx.user.id)).toBe(1);
  });

  test('unlinks one of TWO providers (204) and leaves the other intact', async () => {
    await seedAuthProvider('ap-google', ctx.user.id, 'google', 'g-1');
    const githubId = await seedAuthProvider('ap-github', ctx.user.id, 'github', 'gh-1');
    const res = await ctx.authed('DELETE', `/api/v1/auth/accounts/${githubId}`);
    expect(res.status).toBe(204);
    expect(await authProviderCount(ctx.user.id)).toBe(1);
    const remaining = (await ctx.sql.all(
      `SELECT id FROM user_providers WHERE user_id = ? AND domain = 'auth'`,
      [ctx.user.id]
    )) as Array<{ id: string }>;
    expect(remaining.map((r) => r.id)).toEqual(['ap-google']);
  });

  test("cannot unlink ANOTHER user's auth account (404, no cross-tenant deletion)", async () => {
    await ctx.sql.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
      'other-user',
      'other@example.com',
      'Other',
    ]);
    const foreignId = await seedAuthProvider('ap-foreign', 'other-user', 'google', 'g-foreign');
    await seedAuthProvider('ap-mine', ctx.user.id, 'google', 'g-mine');

    const res = await ctx.authed('DELETE', `/api/v1/auth/accounts/${foreignId}`);
    expect(res.status).toBe(404);
    expect(await authProviderCount('other-user')).toBe(1);
  });

  test('a non-auth provider row is not unlinkable via this route (404)', async () => {
    await seedAuthProvider('ap-auth', ctx.user.id, 'google', 'g-1');
    await ctx.sql.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, status)
       VALUES ('sp-1', ?, 'storage', 'google-drive', 'gd-1', 'Drive', '', 'active')`,
      [ctx.user.id]
    );
    const res = await ctx.authed('DELETE', '/api/v1/auth/accounts/sp-1');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NotFoundError');
    const sp = await ctx.sql.get(`SELECT id FROM user_providers WHERE id = 'sp-1'`);
    expect(sp).not.toBeNull();
  });
});
