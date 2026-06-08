/**
 * Migration 0001: Offline idempotency
 *
 * Adds:
 * - expenses.client_id (nullable TEXT) — offline outbox idempotency key
 * - expenses_user_client_idx (partial UNIQUE index on (user_id, client_id)
 *   WHERE client_id IS NOT NULL)
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  getColumnNames,
  getIndexNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0001: Offline idempotency', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('adds client_id column to expenses', () => {
    applyMigrationsUpTo(db, migrations, 1);
    expect(getColumnNames(db, 'expenses')).toContain('client_id');
  });

  test('creates the partial unique index expenses_user_client_idx', () => {
    applyMigrationsUpTo(db, migrations, 1);
    expect(getIndexNames(db, 'expenses')).toContain('expenses_user_client_idx');
  });

  test('seed data survives this migration', () => {
    applyMigrationsUpTo(db, migrations, 0);
    seedCoreData(db);
    expect(countRows(db, 'users')).toBe(1);

    applyMigration(db, migrations[1]);
    expect(countRows(db, 'users')).toBe(1);
  });

  test('partial unique index enforces (user_id, client_id) but allows many NULLs', () => {
    applyMigrationsUpTo(db, migrations, 1);
    seedCoreData(db);

    // seedCoreData inserts a user + a vehicle; fetch their ids generically.
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string };
    const vehicle = db.query('SELECT id FROM vehicles LIMIT 1').get() as { id: string };

    const insert = (clientId: string | null, id: string) =>
      db.run(
        `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, client_id)
         VALUES (?, ?, ?, 'fuel', 0, 10, ?)`,
        [id, vehicle.id, user.id, clientId]
      );

    // seedCoreData already inserted one expense ('e1', NULL client_id).
    const baseline = countRows(db, 'expenses');

    // Two more NULL client_ids for the same user are allowed (partial index).
    insert(null, 't1');
    insert(null, 't2');
    expect(countRows(db, 'expenses')).toBe(baseline + 2);

    // First non-null client_id succeeds.
    insert('key-1', 't3');
    // Duplicate (same user_id, same client_id) must be rejected by the unique index.
    expect(() => insert('key-1', 't4')).toThrow();

    expect(countRows(db, 'expenses')).toBe(baseline + 3);
  });
});
