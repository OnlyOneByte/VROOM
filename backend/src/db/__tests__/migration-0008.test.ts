/**
 * Migration 0008: add `user_preferences.business_mileage_rate` (trips-location D3, T8).
 *
 * A fully ADDITIVE column: `real NOT NULL DEFAULT 0`. The trip mileage-summary uses it as the DEFAULT
 * business-mileage rate ($/mile) when no explicit ?rate= override is passed; 0 reproduces today's behavior
 * (businessValue 0 until a rate is set). An existing user's row must backfill to 0 (no NULL, no NOT-NULL
 * violation on the rebuild-free ALTER). These tests are the T8 proof gate: the column exists with the right
 * shape on a fresh apply, and a pre-0008 user_preferences row survives the migration backfilled to 0.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  getColumnNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0008: user_preferences.business_mileage_rate (trips-location T8)', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('adds business_mileage_rate to user_preferences', () => {
    applyMigrationsUpTo(db, migrations, 8);
    expect(getColumnNames(db, 'user_preferences')).toContain('business_mileage_rate');
  });

  test('business_mileage_rate is NOT NULL with default 0', () => {
    applyMigrationsUpTo(db, migrations, 8);
    const col = (
      db.query(`PRAGMA table_info('user_preferences')`).all() as {
        name: string;
        notnull: number;
        dflt_value: string | null;
      }[]
    ).find((c) => c.name === 'business_mileage_rate');
    expect(col?.notnull).toBe(1); // NOT NULL
    expect(col?.dflt_value).toBe('0');
  });

  test('an existing user_preferences row backfills business_mileage_rate to 0', () => {
    // Seed at the pre-0008 state, insert a prefs row (only user_id is required — every other column has a
    // default), then apply 0008 and assert the new column backfilled to 0 with the row intact.
    applyMigrationsUpTo(db, migrations, 7);
    seedCoreData(db);
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string };
    db.run('INSERT INTO user_preferences (user_id) VALUES (?)', [user.id]);
    expect(countRows(db, 'user_preferences')).toBe(1);

    applyMigration(db, migrations[8]);

    expect(countRows(db, 'user_preferences')).toBe(1);
    const row = db
      .query('SELECT user_id, business_mileage_rate FROM user_preferences WHERE user_id = ?')
      .get(user.id) as { user_id: string; business_mileage_rate: number };
    expect(row.user_id).toBe(user.id);
    expect(row.business_mileage_rate).toBe(0);
  });

  test('a fractional rate persists exactly (real column, e.g. 0.67 $/mile)', () => {
    applyMigrationsUpTo(db, migrations, 8);
    seedCoreData(db);
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string };
    db.run('INSERT INTO user_preferences (user_id, business_mileage_rate) VALUES (?, ?)', [
      user.id,
      0.67,
    ]);
    const row = db
      .query('SELECT business_mileage_rate FROM user_preferences WHERE user_id = ?')
      .get(user.id) as { business_mileage_rate: number };
    expect(row.business_mileage_rate).toBe(0.67);
  });
});
