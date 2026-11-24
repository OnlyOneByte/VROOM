import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  getColumnNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0019: odometer readings and reminders record who added them', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 18);
  });

  afterEach(() => {
    db.close();
  });

  test('adds a nullable created_by to both tables and keeps existing rows', () => {
    seedCoreData(db);
    db.run(
      "INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at) VALUES ('o1', 'v1', 'u1', 1000, 1700000000)"
    );

    applyMigration(db, migrations[19]);

    expect(getColumnNames(db, 'odometer_entries')).toContain('created_by');
    expect(getColumnNames(db, 'reminders')).toContain('created_by');
    expect(db.query("SELECT created_by FROM odometer_entries WHERE id = 'o1'").get()).toEqual({
      created_by: null,
    });
  });
});
