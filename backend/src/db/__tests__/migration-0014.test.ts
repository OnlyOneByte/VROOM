import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  getColumnNames,
  getTables,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0014: community_refreshes records each refresh', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 13);
  });

  afterEach(() => {
    db.close();
  });

  test('creates one row per scope with no user column and keeps existing data', () => {
    seedCoreData(db);
    const vehiclesBefore = db.query('SELECT COUNT(*) AS n FROM vehicles').get();

    applyMigration(db, migrations[14]);

    expect(getTables(db)).toContain('community_refreshes');
    expect(getColumnNames(db, 'community_refreshes').sort()).toEqual(['refreshed_at', 'scope']);
    expect(db.query('SELECT COUNT(*) AS n FROM vehicles').get()).toEqual(vehiclesBefore);
  });
});
