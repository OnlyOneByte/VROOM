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

describe('Migration 0005: user emails are unique regardless of case', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 4);
  });

  afterEach(() => {
    db.close();
  });

  test('adds the index and keeps existing data', () => {
    seedCoreData(db);
    const before = countRows(db, 'expenses');

    applyMigration(db, migrations[5]);

    expect(getIndexNames(db, 'users')).toContain('users_email_lower_idx');
    expect(countRows(db, 'expenses')).toBe(before);
  });
});
