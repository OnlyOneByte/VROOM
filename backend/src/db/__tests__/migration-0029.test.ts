import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  getColumnNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0029: charging expenses can record a charger type', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 28);
  });

  afterEach(() => {
    db.close();
  });

  test('adds charger_type, leaves existing expenses unchanged and empty', () => {
    seedCoreData(db);
    const before = db.query('SELECT id, expense_amount, fuel_type FROM expenses').all();

    applyMigration(db, migrations[29]);

    expect(getColumnNames(db, 'expenses')).toContain('charger_type');
    expect(db.query('SELECT id, expense_amount, fuel_type FROM expenses').all()).toEqual(before);
    expect(db.query('SELECT charger_type FROM expenses').all()).toEqual([{ charger_type: null }]);
  });
});
