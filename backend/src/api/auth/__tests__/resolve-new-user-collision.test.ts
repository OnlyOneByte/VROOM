/**
 * resolveNewUser must never merge accounts by email. The pre-check refuses an email already in use.
 * If the insert loses a race, the catch returns the user only when it is the same provider identity;
 * a different account that took the email yields email_exists. The handler is private, so this
 * models its SQL against the migrated schema.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  for (const m of loadMigrations()) applyMigration(db, m);
});
afterEach(() => db.close());

function seedAuthUser(
  userId: string,
  email: string,
  authProvider: string,
  accountId: string
): void {
  db.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [userId, email, 'Seed']);
  db.run(
    `INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, status)
     VALUES (?, ?, 'auth', ?, ?, 'Seed', '', 'active')`,
    [`p_${userId}`, userId, authProvider, accountId]
  );
}

/** Pre-check: an existing email blocks new-user creation. */
function preCheckBlocksExistingEmail(email: string): boolean {
  const existing = db.query('SELECT id FROM users WHERE email = ? LIMIT 1').get(email) as {
    id: string;
  } | null;
  return existing !== null;
}

/** Catch branch, reached after a UNIQUE violation in the new-user transaction. */
function catchBranchResolution(
  authProvider: string,
  accountId: string
): { userId: string } | { redirect: 'email_exists' } {
  const row = db
    .query(
      `SELECT user_id FROM user_providers
       WHERE domain = 'auth' AND provider_type = ? AND provider_account_id = ? LIMIT 1`
    )
    .get(authProvider, accountId) as { user_id: string } | null;
  return row ? { userId: row.user_id } : { redirect: 'email_exists' };
}

describe('resolveNewUser — pre-check (no implicit account merge)', () => {
  test('an email already owned by another account blocks new-user creation', () => {
    seedAuthUser('u_first', 'shared@example.com', 'google', 'acc-1');
    expect(preCheckBlocksExistingEmail('shared@example.com')).toBe(true);
  });

  test('a fresh email is NOT blocked (new user proceeds)', () => {
    seedAuthUser('u_first', 'taken@example.com', 'google', 'acc-1');
    expect(preCheckBlocksExistingEmail('brand-new@example.com')).toBe(false);
  });
});

describe('resolveNewUser — transactional race-retry catch', () => {
  test('the same provider identity won the race → return the winner userId', () => {
    seedAuthUser('u_winner', 'race@example.com', 'google', 'acc-1');
    expect(catchBranchResolution('google', 'acc-1')).toEqual({ userId: 'u_winner' });
  });

  test('a different account grabbed the email → email_exists, never a cross-account login', () => {
    seedAuthUser('u_other', 'dup@example.com', 'github', 'acc-other');
    expect(catchBranchResolution('google', 'acc-new')).toEqual({ redirect: 'email_exists' });
  });
});

describe('resolveNewUser — the schema the catch relies on', () => {
  test('a unique auth-identity index exists on (provider_type, provider_account_id)', () => {
    // The race-winner lookup is only unambiguous if at most one auth row matches the identity.
    const idxRows = db
      .query(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'user_providers'"
      )
      .all() as Array<{ name: string; sql: string | null }>;
    const uniqueAuthIdentity = idxRows.some(
      (r) =>
        r.sql?.toUpperCase().includes('UNIQUE') &&
        /provider_type/.test(r.sql ?? '') &&
        /provider_account_id/.test(r.sql ?? '')
    );
    expect(uniqueAuthIdentity).toBe(true);
  });
});
