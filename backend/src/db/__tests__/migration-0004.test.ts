/**
 * Migration 0004: Consolidated — Vehicle Energy Tracking, Custom Drive Folder, Odometer Entries
 *
 * Combines:
 * - `track_fuel` / `track_charging` columns on `vehicles` with data migration
 * - `google_drive_custom_folder_name` column on `user_settings`
 * - `odometer_entries` table with indexes and FK cascades
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  getColumnNames,
  getIndexNames,
  getTables,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0004: Consolidated', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('odometer_entries table exists after migration 0004', () => {
    applyMigrationsUpTo(db, migrations, 4);
    expect(getTables(db)).toContain('odometer_entries');
  });

  test('odometer_entries has correct columns', () => {
    applyMigrationsUpTo(db, migrations, 4);

    const cols = getColumnNames(db, 'odometer_entries');
    const expected = [
      'id',
      'vehicle_id',
      'user_id',
      'odometer',
      'recorded_at',
      'note',
      'linked_entity_type',
      'linked_entity_id',
      'created_at',
      'updated_at',
    ];
    for (const col of expected) {
      expect(cols).toContain(col);
    }
  });

  test('vehicles table has track_fuel and track_charging columns', () => {
    applyMigrationsUpTo(db, migrations, 4);

    const cols = getColumnNames(db, 'vehicles');
    expect(cols).toContain('track_fuel');
    expect(cols).toContain('track_charging');
  });

  test('user_settings table has google_drive_custom_folder_name column', () => {
    applyMigrationsUpTo(db, migrations, 4);

    const cols = getColumnNames(db, 'user_settings');
    expect(cols).toContain('google_drive_custom_folder_name');
  });

  test('seed data from migrations 0000–0003 survives migration 0004', () => {
    applyMigrationsUpTo(db, migrations, 3);
    seedCoreData(db);

    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    applyMigration(db, migrations[4]);

    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    const user = db.query("SELECT * FROM users WHERE id = 'u1'").get() as { email: string };
    expect(user.email).toBe('test@example.com');
  });

  test('CASCADE delete from vehicles removes odometer entries', () => {
    applyMigrationsUpTo(db, migrations, 4);

    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test', 'google', 'g1')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
    );
    db.run(
      "INSERT INTO odometer_entries (id, vehicle_id, user_id, odometer, recorded_at) VALUES ('odo1', 'v1', 'u1', 50000, 1700000000)"
    );

    expect(countRows(db, 'odometer_entries')).toBe(1);

    db.run("DELETE FROM vehicles WHERE id = 'v1'");

    expect(countRows(db, 'odometer_entries')).toBe(0);
  });

  test('both indexes exist on odometer_entries', () => {
    applyMigrationsUpTo(db, migrations, 4);

    const indexes = getIndexNames(db, 'odometer_entries');
    expect(indexes).toContain('odometer_vehicle_date_idx');
    expect(indexes).toContain('odometer_linked_entity_idx');
  });
});
