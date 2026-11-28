import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { failWrites } from '../../../test-helpers/fail-writes';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;
let updateExistingUserProfile: typeof import('../routes').updateExistingUserProfile;

beforeEach(async () => {
  ctx = await createTestApp();
  // App modules must be imported after createTestApp, or they bind the wrong database.
  ({ updateExistingUserProfile } = await import('../routes'));
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function seedAuthUser(userId: string, email: string): Promise<string> {
  await ctx.sql.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
    userId,
    email,
    'Seed Name',
  ]);
  const authRowId = `auth-${userId}`;
  await ctx.sql.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, status)
     VALUES (?, ?, 'auth', 'google', ?, 'Seed Name', '', 'active')`,
    [authRowId, userId, `acct-${userId}`]
  );
  return authRowId;
}

async function userRow(userId: string): Promise<{ email: string; display_name: string }> {
  return (await ctx.sql.get('SELECT email, display_name FROM users WHERE id = ?', [userId])) as {
    email: string;
    display_name: string;
  };
}

describe('updateExistingUserProfile', () => {
  test('a stored login email survives a re-login with a different provider email', async () => {
    const authRowId = await seedAuthUser('u-keep', 'original@example.com');

    await updateExistingUserProfile('u-keep', authRowId, {
      email: 'changed@gmail.com',
      displayName: 'Updated Name',
    });

    expect(await userRow('u-keep')).toEqual({
      email: 'original@example.com',
      display_name: 'Updated Name',
    });
  });

  test('an empty stored email is backfilled from the provider', async () => {
    const authRowId = await seedAuthUser('u-empty', '');

    await updateExistingUserProfile('u-empty', authRowId, {
      email: 'backfilled@gmail.com',
      displayName: 'Now Named',
    });

    expect(await userRow('u-empty')).toEqual({
      email: 'backfilled@gmail.com',
      display_name: 'Now Named',
    });
  });

  test('a backfill that collides with another account keeps the email empty and still syncs the name', async () => {
    await seedAuthUser('u-owner', 'taken@example.com');
    const authRowId = await seedAuthUser('u-late', '');

    await updateExistingUserProfile('u-late', authRowId, {
      email: 'taken@example.com',
      displayName: 'Late Name',
    });

    expect(await userRow('u-late')).toEqual({ email: '', display_name: 'Late Name' });
    expect((await userRow('u-owner')).email).toBe('taken@example.com');
  });

  test('a failure other than a UNIQUE conflict is not swallowed', async () => {
    const authRowId = await seedAuthUser('u-fail', '');
    const restore = await failWrites(ctx.sql, {
      name: 'reject_email_backfill',
      table: 'users',
      event: 'UPDATE OF email',
      message: 'UNIQUE constraint failed: simulated by message only',
    });
    try {
      await expect(
        updateExistingUserProfile('u-fail', authRowId, {
          email: 'fresh@example.com',
          displayName: 'Fail Name',
        })
      ).rejects.toThrow();
    } finally {
      await restore();
    }
  });
});
