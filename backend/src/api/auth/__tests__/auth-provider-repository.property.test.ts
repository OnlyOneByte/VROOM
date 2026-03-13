/**
 * Property-Based Tests for AuthProviderRepository (DB-backed)
 *
 * Tests findByProviderIdentity, findByUserId, create, delete, countByUserId,
 * updateProfile, and domain isolation (auth ops don't affect storage rows).
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 8.1, 8.3**
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fc from 'fast-check';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { AuthProviderRepository } from '../auth-provider-repository';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let sqliteDb: Database;
let db: AppDatabase;
let repo: AuthProviderRepository;

const USER_ID = 'test-user-1';
const USER_ID_2 = 'test-user-2';

function seedTestData(): void {
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_ID}', 'user1@test.com', 'User One')`
  );
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_ID_2}', 'user2@test.com', 'User Two')`
  );
}

beforeEach(() => {
  sqliteDb = new Database(':memory:');
  sqliteDb.run('PRAGMA foreign_keys = ON');
  const migrations = loadMigrations();
  for (const m of migrations) {
    applyMigration(sqliteDb, m);
  }
  db = drizzle(sqliteDb, { schema });
  repo = new AuthProviderRepository(db);
  seedTestData();
});

afterEach(() => {
  sqliteDb.close();
});

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const providerTypeArb = fc.constantFrom('google', 'github');

const providerAccountIdArb = fc.stringMatching(/^[a-z0-9]{5,20}$/);

const emailArb = fc
  .tuple(fc.stringMatching(/^[a-z0-9]{3,10}$/), fc.constantFrom('gmail.com', 'example.com'))
  .map(([local, domain]) => `${local}@${domain}`);

const displayNameArb = fc.stringMatching(/^[A-Za-z ]{3,20}$/);

const avatarUrlArb = fc.oneof(
  fc.constant(undefined),
  fc.stringMatching(/^https:\/\/[a-z]{3,10}\.com\/[a-z]{3,10}$/)
);

// ---------------------------------------------------------------------------
// Property: findByProviderIdentity returns the correct auth row
// **Validates: Requirements 2.1, 2.2**
// ---------------------------------------------------------------------------

describe('findByProviderIdentity', () => {
  test('returns the created auth row when queried by identity tuple', async () => {
    await fc.assert(
      fc.asyncProperty(
        providerTypeArb,
        providerAccountIdArb,
        emailArb,
        displayNameArb,
        async (providerType, providerAccountId, email, displayName) => {
          const created = await repo.create({
            userId: USER_ID,
            authProvider: providerType,
            providerAccountId,
            email,
            displayName,
          });

          const found = await repo.findByProviderIdentity(providerType, providerAccountId);
          expect(found).not.toBeNull();
          expect(found?.id).toBe(created.id);
          expect(found?.userId).toBe(USER_ID);
          expect(found?.domain).toBe('auth');
          expect(found?.providerType).toBe(providerType);
          expect(found?.providerAccountId).toBe(providerAccountId);

          // Cleanup for next iteration
          await repo.delete(created.id, USER_ID);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('returns null for non-existent identity', async () => {
    const result = await repo.findByProviderIdentity('google', 'nonexistent-id');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Property: findByUserId returns all auth rows ordered by createdAt
// **Validates: Requirements 2.1, 2.3**
// ---------------------------------------------------------------------------

describe('findByUserId', () => {
  test('returns all auth rows for a user ordered by createdAt asc', async () => {
    const row1 = await repo.create({
      userId: USER_ID,
      authProvider: 'google',
      providerAccountId: 'goog-aaa',
      email: 'a@test.com',
      displayName: 'A',
    });
    const row2 = await repo.create({
      userId: USER_ID,
      authProvider: 'github',
      providerAccountId: 'gh-bbb',
      email: 'b@test.com',
      displayName: 'B',
    });

    const rows = await repo.findByUserId(USER_ID);
    expect(rows.length).toBe(2);
    expect(rows[0].id).toBe(row1.id);
    expect(rows[1].id).toBe(row2.id);

    // All rows are auth domain
    for (const row of rows) {
      expect(row.domain).toBe('auth');
    }
  });

  test('does not return other users auth rows', async () => {
    await repo.create({
      userId: USER_ID,
      authProvider: 'google',
      providerAccountId: 'goog-111',
      email: 'u1@test.com',
      displayName: 'U1',
    });
    await repo.create({
      userId: USER_ID_2,
      authProvider: 'google',
      providerAccountId: 'goog-222',
      email: 'u2@test.com',
      displayName: 'U2',
    });

    const rows = await repo.findByUserId(USER_ID);
    expect(rows.length).toBe(1);
    expect(rows[0].userId).toBe(USER_ID);
  });
});

// ---------------------------------------------------------------------------
// Property: create inserts auth row with correct fields
// **Validates: Requirements 2.1, 2.4**
// ---------------------------------------------------------------------------

describe('create', () => {
  test('inserts auth row with domain=auth, empty credentials, config with email', async () => {
    await fc.assert(
      fc.asyncProperty(
        providerTypeArb,
        providerAccountIdArb,
        emailArb,
        displayNameArb,
        avatarUrlArb,
        async (providerType, providerAccountId, email, displayName, avatarUrl) => {
          const created = await repo.create({
            userId: USER_ID,
            authProvider: providerType,
            providerAccountId,
            email,
            displayName,
            avatarUrl,
          });

          expect(created.domain).toBe('auth');
          expect(created.providerType).toBe(providerType);
          expect(created.providerAccountId).toBe(providerAccountId);
          expect(created.credentials).toBe('');
          expect(created.displayName).toBe(displayName);

          const config = created.config as Record<string, unknown>;
          expect(config.email).toBe(email);
          if (avatarUrl) {
            expect(config.avatarUrl).toBe(avatarUrl);
          }

          // Cleanup
          await repo.delete(created.id, USER_ID);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property: delete removes only the specified auth row
// **Validates: Requirements 2.1**
// ---------------------------------------------------------------------------

describe('delete', () => {
  test('removes the specified auth row', async () => {
    const row = await repo.create({
      userId: USER_ID,
      authProvider: 'google',
      providerAccountId: 'del-test',
      email: 'del@test.com',
      displayName: 'Del',
    });

    await repo.delete(row.id, USER_ID);
    const found = await repo.findByProviderIdentity('google', 'del-test');
    expect(found).toBeNull();
  });

  test('does not delete rows belonging to other users', async () => {
    const row = await repo.create({
      userId: USER_ID_2,
      authProvider: 'google',
      providerAccountId: 'other-user-row',
      email: 'other@test.com',
      displayName: 'Other',
    });

    // Try to delete with wrong userId
    await repo.delete(row.id, USER_ID);
    const found = await repo.findByProviderIdentity('google', 'other-user-row');
    expect(found).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Property: countByUserId counts only auth-domain rows
// **Validates: Requirements 2.1, 2.5**
// ---------------------------------------------------------------------------

describe('countByUserId', () => {
  test('counts only auth rows for the user', async () => {
    expect(await repo.countByUserId(USER_ID)).toBe(0);

    await repo.create({
      userId: USER_ID,
      authProvider: 'google',
      providerAccountId: 'cnt-1',
      email: 'cnt1@test.com',
      displayName: 'Cnt1',
    });
    expect(await repo.countByUserId(USER_ID)).toBe(1);

    await repo.create({
      userId: USER_ID,
      authProvider: 'github',
      providerAccountId: 'cnt-2',
      email: 'cnt2@test.com',
      displayName: 'Cnt2',
    });
    expect(await repo.countByUserId(USER_ID)).toBe(2);
  });

  test('does not count storage rows', async () => {
    // Insert a storage row directly via raw SQL
    sqliteDb.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
       VALUES ('storage-1', '${USER_ID}', 'storage', 'google-drive', 'My Drive', 'enc-creds', 'active')`
    );

    expect(await repo.countByUserId(USER_ID)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Property: updateProfile updates config and displayName
// **Validates: Requirements 2.1**
// ---------------------------------------------------------------------------

describe('updateProfile', () => {
  test('updates email, displayName, and avatarUrl in config', async () => {
    const row = await repo.create({
      userId: USER_ID,
      authProvider: 'google',
      providerAccountId: 'upd-test',
      email: 'old@test.com',
      displayName: 'Old Name',
    });

    await repo.updateProfile(row.id, USER_ID, {
      email: 'new@test.com',
      displayName: 'New Name',
      avatarUrl: 'https://example.com/avatar',
    });

    const updated = await repo.findByProviderIdentity('google', 'upd-test');
    expect(updated).not.toBeNull();
    expect(updated?.displayName).toBe('New Name');
    const config = updated?.config as Record<string, unknown>;
    expect(config.email).toBe('new@test.com');
    expect(config.avatarUrl).toBe('https://example.com/avatar');
  });
});

// ---------------------------------------------------------------------------
// Property: Domain isolation — auth ops don't affect storage rows
// **Validates: Requirements 8.1, 8.3**
// ---------------------------------------------------------------------------

describe('Domain isolation', () => {
  test('auth operations do not affect storage rows', async () => {
    // Insert a storage row
    sqliteDb.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
       VALUES ('storage-iso', '${USER_ID}', 'storage', 'google-drive', 'My Drive', 'enc-creds', 'active')`
    );

    // Create auth rows
    const authRow = await repo.create({
      userId: USER_ID,
      authProvider: 'google',
      providerAccountId: 'iso-auth',
      email: 'iso@test.com',
      displayName: 'Iso',
    });

    // findByUserId only returns auth rows
    const authRows = await repo.findByUserId(USER_ID);
    expect(authRows.every((r) => r.domain === 'auth')).toBe(true);
    expect(authRows.find((r) => r.id === 'storage-iso')).toBeUndefined();

    // Delete auth row — storage row survives
    await repo.delete(authRow.id, USER_ID);

    const storageRow = sqliteDb
      .query("SELECT * FROM user_providers WHERE id = 'storage-iso'")
      .get() as Record<string, unknown> | null;
    expect(storageRow).not.toBeNull();
    expect(storageRow?.domain).toBe('storage');
  });

  test('findByProviderIdentity only searches auth domain', async () => {
    // Insert a storage row with a providerAccountId (shouldn't happen, but test isolation)
    sqliteDb.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, status)
       VALUES ('storage-with-paid', '${USER_ID}', 'storage', 'google', 'some-id', 'Storage Google', 'enc', 'active')`
    );

    const found = await repo.findByProviderIdentity('google', 'some-id');
    expect(found).toBeNull();
  });
});
