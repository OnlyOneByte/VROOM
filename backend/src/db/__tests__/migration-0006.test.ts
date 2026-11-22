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

describe('Migration 0006: odometer entries can name the trip that wrote them', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 5);
  });

  afterEach(() => {
    db.close();
  });

  test('adds source_trip_id and keeps existing data', () => {
    seedCoreData(db);
    const before = countRows(db, 'expenses');

    applyMigration(db, migrations[6]);

    expect(getColumnNames(db, 'odometer_entries')).toContain('source_trip_id');
    expect(countRows(db, 'expenses')).toBe(before);
  });
});
