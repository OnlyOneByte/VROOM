/**
 * Migration 0005: Expense Indexes
 *
 * Adds three indexes to the expenses table for analytics and query performance:
 * - expenses_vehicle_date_idx (vehicle_id, date)
 * - expenses_vehicle_category_date_idx (vehicle_id, category, date)
 * - expenses_group_idx (expense_group_id)
 */

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

describe('Migration 0005: Expense Indexes', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('all three indexes exist on expenses after migration 0005', () => {
    applyMigrationsUpTo(db, migrations, 5);

    const indexes = getIndexNames(db, 'expenses');
    expect(indexes).toContain('expenses_vehicle_date_idx');
    expect(indexes).toContain('expenses_vehicle_category_date_idx');
    expect(indexes).toContain('expenses_group_idx');
  });

  test('seed data from migrations 0000–0004 survives migration 0005', () => {
    applyMigrationsUpTo(db, migrations, 4);
    seedCoreData(db);

    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    applyMigration(db, migrations[5]);

    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);
  });
});
