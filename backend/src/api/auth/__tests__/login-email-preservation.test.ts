import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;
let updateExistingUserProfile: typeof import('../routes').updateExistingUserProfile;

beforeEach(async () => {
  ctx = await createTestApp();
  // App modules must be imported after createTestApp, or they bind the wrong database.
  ({ updateExistingUserProfile } = await import('../routes'));
});
afterEach(() => ctx.close());

function seedAuthUser(userId: string, email: string): string {
  ctx.sqlite.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
    userId,
    email,
    'Seed Name',
  ]);
  const authRowId = `auth-${userId}`;
  ctx.sqlite.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, status)
     VALUES (?, ?, 'auth', 'google', ?, 'Seed Name', '', 'active')`,
    [authRowId, userId, `acct-${userId}`]
  );
  return authRowId;
}

function userRow(userId: string): { email: string; display_name: string } {
  return ctx.sqlite.query('SELECT email, display_name FROM users WHERE id = ?').get(userId) as {
    email: string;
    display_name: string;
  };
}

describe('updateExistingUserProfile', () => {
  test('a stored login email survives a re-login with a different provider email', async () => {
    const authRowId = seedAuthUser('u-keep', 'original@example.com');

    await updateExistingUserProfile('u-keep', authRowId, {
      email: 'changed@gmail.com',
      displayName: 'Updated Name',
    });

    expect(userRow('u-keep')).toEqual({
      email: 'original@example.com',
      display_name: 'Updated Name',
    });
  });

  test('an empty stored email is backfilled from the provider', async () => {
    const authRowId = seedAuthUser('u-empty', '');

    await updateExistingUserProfile('u-empty', authRowId, {
      email: 'backfilled@gmail.com',
      displayName: 'Now Named',
    });

    expect(userRow('u-empty')).toEqual({
      email: 'backfilled@gmail.com',
      display_name: 'Now Named',
    });
  });

  test('a backfill that collides with another account keeps the email empty and still syncs the name', async () => {
    seedAuthUser('u-owner', 'taken@example.com');
    const authRowId = seedAuthUser('u-late', '');

    await updateExistingUserProfile('u-late', authRowId, {
      email: 'taken@example.com',
      displayName: 'Late Name',
    });

    expect(userRow('u-late')).toEqual({ email: '', display_name: 'Late Name' });
    expect(userRow('u-owner').email).toBe('taken@example.com');
  });

  test('a failure other than a UNIQUE conflict is not swallowed', async () => {
    const authRowId = seedAuthUser('u-fail', '');
    ctx.sqlite.run(
      `CREATE TEMP TRIGGER reject_email_backfill BEFORE UPDATE OF email ON users
       BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: simulated by message only'); END`
    );
    try {
      await expect(
        updateExistingUserProfile('u-fail', authRowId, {
          email: 'fresh@example.com',
          displayName: 'Fail Name',
        })
      ).rejects.toThrow();
    } finally {
      ctx.sqlite.run('DROP TRIGGER reject_email_backfill');
    }
  });
});
