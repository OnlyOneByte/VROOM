import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  getColumnNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0021: trips and photos record who added them', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 20);
  });

  afterEach(() => {
    db.close();
  });

  test('adds a nullable created_by to both tables and keeps existing rows', () => {
    seedCoreData(db);
    db.run(
      "INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date) VALUES ('t1', 'v1', 'u1', 100, 200, 'business', 1700000000)"
    );

    applyMigration(db, migrations[21]);

    expect(getColumnNames(db, 'trips')).toContain('created_by');
    expect(getColumnNames(db, 'photos')).toContain('created_by');
    expect(db.query("SELECT created_by FROM trips WHERE id = 't1'").get()).toEqual({
      created_by: null,
    });
  });
});
