import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  getColumnNames,
  getIndexNames,
  getTables,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0015: calendar_feeds stores a token hash, one feed per user', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 14);
  });

  afterEach(() => {
    db.close();
  });

  test('creates the table with unique user and hash indexes and no raw token column', () => {
    seedCoreData(db);
    const vehiclesBefore = db.query('SELECT COUNT(*) AS n FROM vehicles').get();

    applyMigration(db, migrations[15]);

    expect(getTables(db)).toContain('calendar_feeds');
    expect(getIndexNames(db, 'calendar_feeds')).toEqual(
      expect.arrayContaining(['cf_user_idx', 'cf_token_hash_idx'])
    );
    expect(getColumnNames(db, 'calendar_feeds')).not.toContain('token');
    expect(db.query('SELECT COUNT(*) AS n FROM vehicles').get()).toEqual(vehiclesBefore);
  });
});
