import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { failWrites } from '../../../test-helpers/fail-writes';
import {
  createTestApp,
  ON_POSTGRES,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';

let ctx: TestApp;
let resolveNewUser: typeof import('../routes').resolveNewUser;
let emailExists: string;

beforeEach(async () => {
  ctx = await createTestApp();
  // App modules must be imported after createTestApp, or they bind the wrong database.
  ({ resolveNewUser } = await import('../routes'));
  const { CONFIG } = await import('../../../config');
  emailExists = `${CONFIG.frontend.url}/auth?auth_error=email_exists`;
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function seedAuthUser(
  userId: string,
  email: string,
  provider: string,
  accountId: string
): Promise<void> {
  await ctx.sql.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
    userId,
    email,
    'Seed',
  ]);
  await ctx.sql.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, status)
     VALUES (?, ?, 'auth', ?, ?, 'Seed', '', 'active')`,
    [`p-${userId}`, userId, provider, accountId]
  );
}

async function userCount(): Promise<number> {
  return ((await ctx.sql.get('SELECT COUNT(*) AS n FROM users')) as { n: number }).n;
}

describe('resolveNewUser — pre-check (no implicit account merge)', () => {
  test('an email already owned by another account is refused', async () => {
    await seedAuthUser('u-first', 'shared@example.com', 'github', 'gh-1');
    const before = await userCount();

    const result = await resolveNewUser('google', {
      providerAccountId: 'g-1',
      email: 'shared@example.com',
      displayName: 'Second',
    });

    expect(result).toEqual({ redirect: emailExists });
    expect(await userCount()).toBe(before);
  });

  test('a fresh email creates the user and its auth link together', async () => {
    const result = await resolveNewUser('google', {
      providerAccountId: 'g-new',
      email: 'brand-new@example.com',
      displayName: 'Brand New',
    });

    expect('userId' in result).toBe(true);
    const userId = (result as { userId: string }).userId;
    const link = (await ctx.sql.get(
      "SELECT user_id FROM user_providers WHERE domain = 'auth' AND provider_type = 'google' AND provider_account_id = 'g-new'"
    )) as { user_id: string } | null;
    expect(link?.user_id).toBe(userId);
  });
});

describe('resolveNewUser — UNIQUE conflict inside the insert transaction', () => {
  test('the same provider identity already linked → its user is returned and nothing is half-created', async () => {
    await seedAuthUser('u-winner', 'winner@example.com', 'google', 'g-race');
    const before = await userCount();

    const result = await resolveNewUser('google', {
      providerAccountId: 'g-race',
      email: 'loser@example.com',
      displayName: 'Loser',
    });

    expect(result).toEqual({ userId: 'u-winner' });
    expect(await userCount(), 'the rolled-back user row must not survive').toBe(before);
  });

  test('the retry sign-in attaches pending invites, like the normal sign-in', async () => {
    await seedAuthUser('u-winner', 'winner@example.com', 'google', 'g-race');
    await ctx.sql.run(
      `INSERT INTO vehicles (id, user_id, make, model, year, created_at, updated_at)
       VALUES ('v-shared', ?, 'Honda', 'Civic', 2020, 1700000000, 1700000000)`,
      [ctx.user.id]
    );
    await ctx.sql.run(
      `INSERT INTO vehicle_shares (id, vehicle_id, owner_id, invited_email, level, status, created_at)
       VALUES ('s-pending', 'v-shared', ?, 'winner@example.com', 'viewer', 'pending', 1700000000)`,
      [ctx.user.id]
    );

    const result = await resolveNewUser('google', {
      providerAccountId: 'g-race',
      email: 'loser@example.com',
      displayName: 'Loser',
    });

    expect(result).toEqual({ userId: 'u-winner' });
    const share = (await ctx.sql.get(
      "SELECT shared_with_id FROM vehicle_shares WHERE id = 's-pending'"
    )) as { shared_with_id: string | null };
    expect(share.shared_with_id).toBe('u-winner');
  });

  test('a collision with a different identity → email_exists, never a cross-account login', async () => {
    await seedAuthUser('u-other', 'other@example.com', 'github', 'shared-account-id');
    await ctx.sql.run(
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
      await ctx.sql.run('DROP INDEX temp_one_account_id');
    }
  });

  test('a non-UNIQUE failure propagates even when its message mentions UNIQUE', async () => {
    const restore = await failWrites(ctx.sql, {
      name: 'reject_auth_link',
      table: 'user_providers',
      event: 'INSERT',
      message: 'UNIQUE constraint failed: simulated by message only',
    });
    try {
      await expect(
        resolveNewUser('google', {
          providerAccountId: 'g-trigger',
          email: 'trigger@example.com',
          displayName: 'Trigger',
        })
      ).rejects.toThrow();
    } finally {
      await restore();
    }
  });
});

describe('resolveNewUser — the schema the race-retry relies on', () => {
  test('a unique auth-identity index exists on (provider_type, provider_account_id)', async () => {
    const indexes = await ctx.sql.all<{ sql: string | null }>(
      ON_POSTGRES
        ? "SELECT indexdef AS sql FROM pg_indexes WHERE tablename = 'user_providers'"
        : "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'user_providers'"
    );
    const uniqueAuthIdentity = indexes.some(
      ({ sql }) =>
        sql?.toUpperCase().includes('UNIQUE') &&
        /provider_type/.test(sql) &&
        /provider_account_id/.test(sql)
    );
    expect(uniqueAuthIdentity).toBe(true);
  });
});
