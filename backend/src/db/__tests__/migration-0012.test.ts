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

describe('Migration 0012: community_stats holds aggregates only', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 11);
  });

  afterEach(() => {
    db.close();
  });

  test('creates the table with one row per scope and bucket and no user column', () => {
    seedCoreData(db);
    const vehiclesBefore = db.query('SELECT COUNT(*) AS n FROM vehicles').get();

    applyMigration(db, migrations[12]);

    expect(getTables(db)).toContain('community_stats');
    expect(getIndexNames(db, 'community_stats')).toContain('community_stats_scope_bucket_idx');
    expect(getColumnNames(db, 'community_stats').filter((c) => c.includes('user'))).toEqual([]);
    expect(db.query('SELECT COUNT(*) AS n FROM vehicles').get()).toEqual(vehiclesBefore);
  });
});
