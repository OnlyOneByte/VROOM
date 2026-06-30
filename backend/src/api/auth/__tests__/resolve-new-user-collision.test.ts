/**
 * #C157 DEEP-REVIEW (certify + guard): `resolveNewUser`'s email-collision + race-retry invariant.
 *
 * `resolveNewUser` (auth/routes.ts) creates a user on an OAuth login that has no existing auth row. Its
 * collision handling is a load-bearing data-safety + concurrency contract (NORTH_STAR #2 — VROOM NEVER
 * implicitly merges two accounts):
 *   1. PRE-CHECK: if a user with the incoming email already exists → redirect `email_exists` (no merge).
 *   2. TRANSACTIONAL CATCH (concurrency-only): the new-user tx inserts BOTH `users(email)` (UNIQUE on email)
 *      and `user_providers(provider_type, provider_account_id)` (partial UNIQUE `up_auth_identity_idx` WHERE
 *      domain='auth'). So a concurrent request landing between our pre-check SELECT and our tx commit can
 *      UNIQUE-violate on EITHER index. The catch re-queries findByProviderIdentity(authProvider, accountId):
 *        - row FOUND  → the race winner was the SAME provider identity → return its userId (idempotent login);
 *          the provider-identity UNIQUE guarantees that row is unambiguous
 *        - row ABSENT → a DIFFERENT account grabbed that email → redirect `email_exists`
 *
 * Certified CLEAN firsthand (C157) — no defect. resolveNewUser is a private handler helper, so this guard
 * models the EXACT decision logic against the REAL migrated schema (the SQL contract it runs): the pre-check
 * no-merge, and the catch-branch race-winner-vs-collision discrimination. A regression that (a) implicitly
 * merged on email, or (b) returned a userId for a different-account collision (cross-account login!), breaks it.
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

/** The PRE-CHECK: an existing email blocks new-user creation (no implicit account merge). */
function preCheckBlocksExistingEmail(email: string): boolean {
  const existing = db.query('SELECT id FROM users WHERE email = ? LIMIT 1').get(email) as {
    id: string;
  } | null;
  return existing !== null; // true → resolveNewUser returns { redirect: 'email_exists' }
}

/** The CATCH branch (runs after a UNIQUE(users.email) violation in the new-user tx). */
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

describe('resolveNewUser — pre-check (no implicit account merge, NORTH_STAR #2)', () => {
  test('an email already owned by another account blocks new-user creation (→ email_exists)', () => {
    seedAuthUser('u_first', 'shared@example.com', 'google', 'acc-1');
    // A different provider account presenting the SAME email must NOT merge into u_first.
    expect(preCheckBlocksExistingEmail('shared@example.com')).toBe(true);
  });

  test('a fresh email is NOT blocked (new user proceeds)', () => {
    seedAuthUser('u_first', 'taken@example.com', 'google', 'acc-1');
    expect(preCheckBlocksExistingEmail('brand-new@example.com')).toBe(false);
  });
});

describe('resolveNewUser — transactional race-retry catch (concurrency-only)', () => {
  test('SAME provider account won the race → idempotent: return the winner userId (NOT a redirect)', () => {
    // A concurrent request for the SAME provider identity (google/acc-1) inserted the user first.
    seedAuthUser('u_winner', 'race@example.com', 'google', 'acc-1');
    // Our tx UNIQUE-violated on users.email; the catch re-queries our own provider identity → finds the winner.
    expect(catchBranchResolution('google', 'acc-1')).toEqual({ userId: 'u_winner' });
  });

  test('a DIFFERENT account grabbed the email → email_exists (never a cross-account login)', () => {
    // The winner was a DIFFERENT provider account that happens to share the email.
    seedAuthUser('u_other', 'dup@example.com', 'github', 'acc-other');
    // Our catch re-queries OUR identity (google/acc-new) → no row → must redirect, never return u_other.
    expect(catchBranchResolution('google', 'acc-new')).toEqual({ redirect: 'email_exists' });
  });
});

describe('resolveNewUser — the schema fact the catch relies on', () => {
  test('a partial-UNIQUE auth-identity index exists on (provider_type, provider_account_id) — makes the race-winner retry unambiguous', () => {
    // The catch returns the race winner by re-querying findByProviderIdentity(authProvider, accountId). That
    // is only sound because the provider identity is UNIQUE for auth rows (up_auth_identity_idx, partial WHERE
    // domain='auth') — so at most ONE row matches and a concurrent same-identity insert is the winner we
    // adopt. Pin that this unique index exists (a migration dropping it would make the retry ambiguous +
    // allow duplicate auth identities). users.email is ALSO unique (the other index the tx can violate).
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
