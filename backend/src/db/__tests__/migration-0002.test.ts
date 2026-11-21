import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  getIndexNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

const NEW_INDEXES: [table: string, index: string][] = [
  ['expenses', 'expenses_created_by_idx'],
  ['insurance_claims', 'ic_term_idx'],
  ['odometer_entries', 'odometer_user_date_idx'],
  ['photo_refs', 'pr_provider_status_idx'],
  ['sessions', 'sessions_user_idx'],
  ['trips', 'trips_user_date_idx'],
];

describe('Migration 0002: lookup and foreign-key indexes', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 1);
  });

  afterEach(() => {
    db.close();
  });

  test('adds each index', () => {
    for (const [table, index] of NEW_INDEXES) {
      expect(getIndexNames(db, table)).not.toContain(index);
    }
    applyMigration(db, migrations[2]);
    for (const [table, index] of NEW_INDEXES) {
      expect(getIndexNames(db, table)).toContain(index);
    }
  });

  test('existing data survives', () => {
    seedCoreData(db);
    const before = countRows(db, 'expenses');

    applyMigration(db, migrations[2]);

    expect(countRows(db, 'expenses')).toBe(before);
    expect(countRows(db, 'users')).toBeGreaterThan(0);
  });

  test('the user-scoped trip list uses the new index', () => {
    applyMigration(db, migrations[2]);
    const plan = db
      .query("EXPLAIN QUERY PLAN SELECT * FROM trips WHERE user_id = 'u1' ORDER BY trip_date DESC")
      .all() as Array<{ detail: string }>;
    expect(plan.map((row) => row.detail).join(' ')).toContain('trips_user_date_idx');
  });
});
