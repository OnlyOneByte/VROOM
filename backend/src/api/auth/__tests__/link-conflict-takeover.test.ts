/**
 * Account-takeover boundary guard for checkLinkConflicts (cycle 296).
 *
 * The OAuth link callback (routes.ts /callback/link/:authProvider) lets a logged-in user attach a
 * second provider identity (e.g. add GitHub to a Google-created account). checkLinkConflicts is the
 * gate that decides whether the bind is allowed, and it is the ACCOUNT-TAKEOVER boundary:
 *   - unbound identity            → null            (free to link)
 *   - already bound to THIS user  → 'already_linked' (idempotent no-op, not a duplicate row)
 *   - bound to a DIFFERENT user   → 'account_conflict' (REJECT — never silently re-bind)
 *
 * The third branch is the security-critical one: a regression that returned null or 'already_linked'
 * for an identity owned by another user would let attacker B link victim A's GitHub/Google identity
 * to B's account (or, depending on the downstream write, hijack the identity row). The repo-level
 * scoping of findByProviderIdentity is tested (auth-provider-repository.property.test.ts), but the
 * 3-way DECISION itself was un-pinned until now.
 *
 * Drives the REAL checkLinkConflicts (exported + repo-injectable, C296) against a REAL seeded
 * AuthProviderRepository over an in-memory migrated DB — NOT a re-implementation of the decision
 * (the C181/C229 coverage-theater trap), and not the getDb-singleton (the C77 bind). The default
 * route call-site keeps using the singleton; only this test injects the test repo.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { AuthProviderRepository } from '../auth-provider-repository';
import { checkLinkConflicts } from '../routes';

let sqliteDb: Database;
let db: AppDatabase;
let repo: AuthProviderRepository;

const USER_A = 'user-a';
const USER_B = 'user-b';

beforeEach(() => {
  sqliteDb = new Database(':memory:');
  sqliteDb.run('PRAGMA foreign_keys = ON');
  for (const m of loadMigrations()) applyMigration(sqliteDb, m);
  db = drizzle(sqliteDb, { schema });
  repo = new AuthProviderRepository(db);
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_A}', 'a@test.com', 'A')`
  );
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_B}', 'b@test.com', 'B')`
  );
});

afterEach(() => {
  sqliteDb.close();
});

describe('checkLinkConflicts — account-takeover boundary (C296)', () => {
  test('an UNBOUND provider identity → null (free to link)', async () => {
    const result = await checkLinkConflicts('github', 'gh-account-123', USER_A, repo);
    expect(result).toBeNull();
  });

  test('an identity already bound to THIS user → already_linked (idempotent, no second row)', async () => {
    await repo.create({
      userId: USER_A,
      authProvider: 'github',
      providerAccountId: 'gh-account-123',
      email: 'a@test.com',
    });
    const result = await checkLinkConflicts('github', 'gh-account-123', USER_A, repo);
    expect(result).toBe('already_linked');
  });

  test('an identity bound to a DIFFERENT user → account_conflict (THE takeover boundary: never re-bind)', async () => {
    // USER_A owns the github identity; USER_B attempts to link the SAME identity.
    await repo.create({
      userId: USER_A,
      authProvider: 'github',
      providerAccountId: 'gh-account-123',
      email: 'a@test.com',
    });
    const result = await checkLinkConflicts('github', 'gh-account-123', USER_B, repo);
    expect(result).toBe('account_conflict');
  });

  test('the conflict is keyed on (provider, providerAccountId) — a DIFFERENT provider with the same account id does NOT collide', async () => {
    // Same providerAccountId string under a different provider is a distinct identity → free to link.
    await repo.create({
      userId: USER_A,
      authProvider: 'github',
      providerAccountId: 'shared-id',
      email: 'a@test.com',
    });
    const result = await checkLinkConflicts('google', 'shared-id', USER_B, repo);
    expect(result).toBeNull();
  });

  test('after USER_A links github, USER_A re-linking google (a NEW identity) is still free → null', async () => {
    await repo.create({
      userId: USER_A,
      authProvider: 'github',
      providerAccountId: 'gh-1',
      email: 'a@test.com',
    });
    const result = await checkLinkConflicts('google', 'goog-1', USER_A, repo);
    expect(result).toBeNull();
  });
});
