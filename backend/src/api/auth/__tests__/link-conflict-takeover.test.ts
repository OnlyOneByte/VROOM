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

describe('checkLinkConflicts — account-takeover boundary', () => {
  test('an unbound provider identity → null (free to link)', async () => {
    const result = await checkLinkConflicts('github', 'gh-account-123', USER_A, repo);
    expect(result).toBeNull();
  });

  test('an identity already bound to this user → already_linked', async () => {
    await repo.create({
      userId: USER_A,
      authProvider: 'github',
      providerAccountId: 'gh-account-123',
      email: 'a@test.com',
    });
    const result = await checkLinkConflicts('github', 'gh-account-123', USER_A, repo);
    expect(result).toBe('already_linked');
  });

  test('an identity bound to a different user → account_conflict', async () => {
    await repo.create({
      userId: USER_A,
      authProvider: 'github',
      providerAccountId: 'gh-account-123',
      email: 'a@test.com',
    });
    const result = await checkLinkConflicts('github', 'gh-account-123', USER_B, repo);
    expect(result).toBe('account_conflict');
  });

  test('the conflict is keyed on provider and account id together', async () => {
    await repo.create({
      userId: USER_A,
      authProvider: 'github',
      providerAccountId: 'shared-id',
      email: 'a@test.com',
    });
    const result = await checkLinkConflicts('google', 'shared-id', USER_B, repo);
    expect(result).toBeNull();
  });

  test('after linking github, linking a new google identity is still free', async () => {
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
