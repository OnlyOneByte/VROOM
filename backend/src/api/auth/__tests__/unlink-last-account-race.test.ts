/**
 * Regression guard: concurrent unlinks must never strip a user of every sign-in method.
 *
 * "You cannot unlink your last sign-in method" is the only thing standing between a user and a
 * permanently unreachable account: VROOM has no password auth, so with zero `domain='auth'` rows the
 * next OAuth sign-in finds the email already taken, refuses to merge, and the account can only be
 * recovered with manual SQL on the server.
 *
 * That makes the guard's atomicity load-bearing. Counting the rows and deleting one must happen with
 * no yield point in between, or two unlinks issued at once (two tabs, two devices, a retried
 * request) each see a count of 2, each pass the guard, and both delete.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function seedAuthProvider(id: string, providerType: string): string {
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, status)
     VALUES (?, ?, 'auth', ?, ?, ?, '', 'active')`,
    [id, ctx.user.id, providerType, `${providerType}-1`, `${providerType} account`]
  );
  return id;
}

function remainingAuthIds(): string[] {
  const rows = ctx.sqlite
    .query(`SELECT id FROM user_providers WHERE user_id = ? AND domain = 'auth' ORDER BY id`)
    .all(ctx.user.id) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

describe('DELETE /auth/accounts/:id — last-sign-in-method guard under concurrency', () => {
  test('two concurrent unlinks of a two-provider account cannot delete both', async () => {
    seedAuthProvider('ap-google', 'google');
    seedAuthProvider('ap-github', 'github');

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
      remainingAuthIds().length,
      'the user must still hold a sign-in method — zero auth rows is an unrecoverable lockout'
    ).toBe(1);
  });

  test('three concurrent unlinks of a three-provider account leave exactly one', async () => {
    seedAuthProvider('ap-a', 'google');
    seedAuthProvider('ap-b', 'github');
    seedAuthProvider('ap-c', 'gitlab');

    const results = await Promise.all([
      ctx.authed('DELETE', '/api/v1/auth/accounts/ap-a'),
      ctx.authed('DELETE', '/api/v1/auth/accounts/ap-b'),
      ctx.authed('DELETE', '/api/v1/auth/accounts/ap-c'),
    ]);

    expect(results.filter((r) => r.status === 204).length).toBe(2);
    expect(results.filter((r) => r.status === 400).length).toBe(1);
    expect(remainingAuthIds().length).toBe(1);
  });

  test('the sequential path is unchanged: second unlink is refused, first survives', async () => {
    seedAuthProvider('ap-google', 'google');
    seedAuthProvider('ap-github', 'github');

    expect((await ctx.authed('DELETE', '/api/v1/auth/accounts/ap-github')).status).toBe(204);
    expect((await ctx.authed('DELETE', '/api/v1/auth/accounts/ap-google')).status).toBe(400);
    expect(remainingAuthIds()).toEqual(['ap-google']);
  });
});
