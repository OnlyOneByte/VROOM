/**
 * General migration tests — applies to the full migration set.
 *
 * Verifies that all migrations load, apply in sequence, and produce
 * the expected final schema with working foreign key cascades.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  countRows,
  getTables,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migrations: General', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('all migration files are loadable and non-empty', () => {
    expect(migrations.length).toBeGreaterThanOrEqual(2);
    for (const m of migrations) {
      expect(m.sql.length).toBeGreaterThan(0);
    }
  });

  test('all migrations apply cleanly in sequence on a fresh database', () => {
    for (const migration of migrations) {
      applyMigration(db, migration);
    }

    const tables = getTables(db);
    const expectedTables = [
      'expense_groups',
      'expenses',
      'insurance_policies',
      'insurance_policy_vehicles',
      'odometer_entries',
      'photos',
      'sessions',
      'user_settings',
      'users',
      'vehicle_financing',
      'vehicles',
    ];
    for (const table of expectedTables) {
      expect(tables).toContain(table);
    }
  });

  test('foreign key cascade: deleting a user cascades to vehicles and expenses', () => {
    for (const migration of migrations) {
      applyMigration(db, migration);
    }

    seedCoreData(db);

    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    db.run("DELETE FROM users WHERE id = 'u1'");

    expect(countRows(db, 'users')).toBe(0);
    expect(countRows(db, 'vehicles')).toBe(0);
    expect(countRows(db, 'expenses')).toBe(0);
  });
});
