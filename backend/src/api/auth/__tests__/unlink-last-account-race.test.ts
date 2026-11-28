import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;
beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function seedAuthProvider(id: string, providerType: string): Promise<string> {
  await ctx.sql.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, status)
     VALUES (?, ?, 'auth', ?, ?, ?, '', 'active')`,
    [id, ctx.user.id, providerType, `${providerType}-1`, `${providerType} account`]
  );
  return id;
}

async function remainingAuthIds(): Promise<string[]> {
  const rows = (await ctx.sql.all(
    `SELECT id FROM user_providers WHERE user_id = ? AND domain = 'auth' ORDER BY id`,
    [ctx.user.id]
  )) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

describe('DELETE /auth/accounts/:id — last-sign-in-method guard under concurrency', () => {
  test('two concurrent unlinks of a two-provider account cannot delete both', async () => {
    await seedAuthProvider('ap-google', 'google');
    await seedAuthProvider('ap-github', 'github');

    const [first, second] = await Promise.all([
      ctx.authed('DELETE', '/api/v1/auth/accounts/ap-google'),
      ctx.authed('DELETE', '/api/v1/auth/accounts/ap-github'),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(
      statuses,
      'exactly one unlink may succeed; the other must hit the last-account guard (400)'
    ).toEqual([204, 400]);

    expect(
      (await remainingAuthIds()).length,
      'the user must still hold a sign-in method — zero auth rows is an unrecoverable lockout'
    ).toBe(1);
  });

  test('three concurrent unlinks of a three-provider account leave exactly one', async () => {
    await seedAuthProvider('ap-a', 'google');
    await seedAuthProvider('ap-b', 'github');
    await seedAuthProvider('ap-c', 'gitlab');

    const results = await Promise.all([
      ctx.authed('DELETE', '/api/v1/auth/accounts/ap-a'),
      ctx.authed('DELETE', '/api/v1/auth/accounts/ap-b'),
      ctx.authed('DELETE', '/api/v1/auth/accounts/ap-c'),
    ]);

    expect(results.filter((r) => r.status === 204).length).toBe(2);
    expect(results.filter((r) => r.status === 400).length).toBe(1);
    expect((await remainingAuthIds()).length).toBe(1);
  });

  test('a sequential second unlink is refused and the first provider survives', async () => {
    await seedAuthProvider('ap-google', 'google');
    await seedAuthProvider('ap-github', 'github');

    expect((await ctx.authed('DELETE', '/api/v1/auth/accounts/ap-github')).status).toBe(204);
    expect((await ctx.authed('DELETE', '/api/v1/auth/accounts/ap-google')).status).toBe(400);
    expect(await remainingAuthIds()).toEqual(['ap-google']);
  });
});
