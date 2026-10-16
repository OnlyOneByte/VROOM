/**
 * Migration 0013: push_subscriptions.
 *
 * Purely additive: one CREATE TABLE plus two indexes. The test pins the table, both indexes, and the
 * constraints the Web Push flow depends on:
 *  - a re-subscribing browser returns the SAME endpoint, so (user_id, endpoint) is UNIQUE — the row
 *    is upserted, never duplicated;
 *  - that uniqueness is tenant-scoped, so two users are free to carry the same endpoint string;
 *  - failure_count defaults to 0 and is NOT NULL (the reaper counts up from a known floor);
 *  - deleting the user cascade-deletes their device rows;
 *  - applying it preserves existing data and leaves no rebuild scaffolding.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  getIndexNames,
  getTables,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0013: push_subscriptions', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  function seedTwoUsers(): void {
    seedCoreData(db);
    db.run(
      "INSERT INTO users (id, email, display_name) VALUES ('u2', 'other@example.com', 'Other')"
    );
  }

  function insertSubscription(id: string, userId: string, endpoint: string): void {
    db.run(
      'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)',
      [id, userId, endpoint, 'pub-key', 'auth-secret']
    );
  }

  test('the table and both indexes exist', () => {
    applyMigrationsUpTo(db, migrations, 13);
    expect(getTables(db)).toContain('push_subscriptions');
    const indexes = getIndexNames(db, 'push_subscriptions');
    expect(indexes).toContain('ps_user_idx');
    expect(indexes).toContain('ps_user_endpoint_idx');
  });

  test('a subscription can be created and read back', () => {
    applyMigrationsUpTo(db, migrations, 13);
    seedTwoUsers();
    insertSubscription('s1', 'u1', 'https://push.example/abc');
    const row = db
      .query('SELECT user_id, endpoint, p256dh, auth, failure_count FROM push_subscriptions')
      .get() as Record<string, string | number>;
    expect(row.user_id).toBe('u1');
    expect(row.endpoint).toBe('https://push.example/abc');
    expect(row.p256dh).toBe('pub-key');
    expect(row.auth).toBe('auth-secret');
    expect(row.failure_count).toBe(0); // NOT NULL DEFAULT 0
  });

  test('failure_count is NOT NULL and defaults to 0', () => {
    applyMigrationsUpTo(db, migrations, 13);
    const col = (
      db.query("PRAGMA table_info('push_subscriptions')").all() as {
        name: string;
        notnull: number;
        dflt_value: string | null;
      }[]
    ).find((c) => c.name === 'failure_count');
    expect(col?.notnull).toBe(1);
    expect(col?.dflt_value).toBe('0');
  });

  test('the same (user, endpoint) cannot be stored twice', () => {
    applyMigrationsUpTo(db, migrations, 13);
    seedTwoUsers();
    insertSubscription('s1', 'u1', 'https://push.example/abc');
    expect(() => insertSubscription('s2', 'u1', 'https://push.example/abc')).toThrow();
    expect(countRows(db, 'push_subscriptions')).toBe(1);
  });

  test('a second device for the same user is allowed', () => {
    applyMigrationsUpTo(db, migrations, 13);
    seedTwoUsers();
    insertSubscription('s1', 'u1', 'https://push.example/abc');
    expect(() => insertSubscription('s2', 'u1', 'https://push.example/def')).not.toThrow();
    expect(countRows(db, 'push_subscriptions')).toBe(2);
  });

  test('the unique key is tenant-scoped — two users may carry the same endpoint', () => {
    applyMigrationsUpTo(db, migrations, 13);
    seedTwoUsers();
    insertSubscription('s1', 'u1', 'https://push.example/abc');
    expect(() => insertSubscription('s2', 'u2', 'https://push.example/abc')).not.toThrow();
    expect(countRows(db, 'push_subscriptions')).toBe(2);
  });

  test('deleting the user cascade-deletes their subscriptions', () => {
    applyMigrationsUpTo(db, migrations, 13);
    seedTwoUsers();
    insertSubscription('s1', 'u1', 'https://push.example/abc');
    insertSubscription('s2', 'u2', 'https://push.example/def');

    db.run("DELETE FROM users WHERE id = 'u1'");

    expect(countRows(db, 'push_subscriptions')).toBe(1);
    const survivor = db.query('SELECT user_id FROM push_subscriptions').get() as {
      user_id: string;
    };
    expect(survivor.user_id).toBe('u2');
  });

  test('an unknown user_id is rejected by the foreign key', () => {
    applyMigrationsUpTo(db, migrations, 13);
    seedTwoUsers();
    expect(() => insertSubscription('s1', 'ghost', 'https://push.example/abc')).toThrow();
  });

  test('0013 is additive — existing rows survive and no rebuild scaffolding is left', () => {
    applyMigrationsUpTo(db, migrations, 12);
    seedCoreData(db); // u1 + v1 + e1
    expect(countRows(db, 'expenses')).toBe(1);

    applyMigration(db, migrations[13]);

    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);
    expect(countRows(db, 'push_subscriptions')).toBe(0);

    const scaffold = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '__new_%'")
      .all() as { name: string }[];
    expect(scaffold.length).toBe(0);
  });
});
