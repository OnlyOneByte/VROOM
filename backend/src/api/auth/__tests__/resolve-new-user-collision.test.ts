/**
 * resolveNewUser must never merge accounts by email. The pre-check refuses an email already in use;
 * if the insert transaction then hits a UNIQUE conflict, the user is returned only when the same
 * provider identity won the race, and any other collision yields email_exists. App modules are
 * imported after createTestApp so they bind the test database.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;
let resolveNewUser: typeof import('../routes').resolveNewUser;
let emailExists: string;

beforeEach(async () => {
  ctx = await createTestApp();
  ({ resolveNewUser } = await import('../routes'));
  const { CONFIG } = await import('../../../config');
  emailExists = `${CONFIG.frontend.url}/auth?auth_error=email_exists`;
});
afterEach(() => ctx.close());

function seedAuthUser(userId: string, email: string, provider: string, accountId: string): void {
  ctx.sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
    userId,
    email,
    'Seed',
  ]);
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, status)
     VALUES (?, ?, 'auth', ?, ?, 'Seed', '', 'active')`,
    [`p-${userId}`, userId, provider, accountId]
  );
}

function userCount(): number {
  return (ctx.sqlite.query('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

describe('resolveNewUser — pre-check (no implicit account merge)', () => {
  test('an email already owned by another account is refused', async () => {
    seedAuthUser('u-first', 'shared@example.com', 'github', 'gh-1');
    const before = userCount();

    const result = await resolveNewUser('google', {
      providerAccountId: 'g-1',
      email: 'shared@example.com',
      displayName: 'Second',
    });

    expect(result).toEqual({ redirect: emailExists });
    expect(userCount()).toBe(before);
  });

  test('a fresh email creates the user and its auth link together', async () => {
    const result = await resolveNewUser('google', {
      providerAccountId: 'g-new',
      email: 'brand-new@example.com',
      displayName: 'Brand New',
    });

    expect('userId' in result).toBe(true);
    const userId = (result as { userId: string }).userId;
    const link = ctx.sqlite
      .query(
        "SELECT user_id FROM user_providers WHERE domain = 'auth' AND provider_type = 'google' AND provider_account_id = 'g-new'"
      )
      .get() as { user_id: string } | null;
    expect(link?.user_id).toBe(userId);
  });
});

describe('resolveNewUser — UNIQUE conflict inside the insert transaction', () => {
  test('the same provider identity already linked → its user is returned and nothing is half-created', async () => {
    // A different stored email gets past the pre-check, so the identity insert is what collides.
    seedAuthUser('u-winner', 'winner@example.com', 'google', 'g-race');
    const before = userCount();

    const result = await resolveNewUser('google', {
      providerAccountId: 'g-race',
      email: 'loser@example.com',
      displayName: 'Loser',
    });

    expect(result).toEqual({ userId: 'u-winner' });
    expect(userCount(), 'the rolled-back user row must not survive').toBe(before);
  });

  test('a collision with a different identity → email_exists, never a cross-account login', async () => {
    seedAuthUser('u-other', 'other@example.com', 'github', 'shared-account-id');
    // Force the new identity's insert to collide with a row it does not own.
    ctx.sqlite.run(
      'CREATE UNIQUE INDEX temp_one_account_id ON user_providers (provider_account_id)'
    );
    try {
      const result = await resolveNewUser('google', {
        providerAccountId: 'shared-account-id',
        email: 'new@example.com',
        displayName: 'New',
      });
      expect(result).toEqual({ redirect: emailExists });
    } finally {
      ctx.sqlite.run('DROP INDEX temp_one_account_id');
    }
  });

  test('a non-UNIQUE failure propagates even when its message mentions UNIQUE', async () => {
    ctx.sqlite.run(
      `CREATE TEMP TRIGGER reject_auth_link BEFORE INSERT ON user_providers
       BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: simulated by message only'); END`
    );
    try {
      await expect(
        resolveNewUser('google', {
          providerAccountId: 'g-trigger',
          email: 'trigger@example.com',
          displayName: 'Trigger',
        })
      ).rejects.toThrow();
    } finally {
      ctx.sqlite.run('DROP TRIGGER reject_auth_link');
    }
  });
});

describe('resolveNewUser — the schema the race-retry relies on', () => {
  test('a unique auth-identity index exists on (provider_type, provider_account_id)', () => {
    const indexes = ctx.sqlite
      .query("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'user_providers'")
      .all() as Array<{ sql: string | null }>;
    const uniqueAuthIdentity = indexes.some(
      ({ sql }) =>
        sql?.toUpperCase().includes('UNIQUE') &&
        /provider_type/.test(sql) &&
        /provider_account_id/.test(sql)
    );
    expect(uniqueAuthIdentity).toBe(true);
  });
});
