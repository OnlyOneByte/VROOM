/**
 * Migration 0000: Consolidated schema (single migration)
 *
 * Creates all tables: users, vehicles, expenses, vehicle_financing,
 * insurance_policies, insurance_policy_vehicles,
 * photos, photo_refs, odometer_entries, user_providers, user_settings, sessions.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  countRows,
  getColumnNames,
  getIndexNames,
  getTables,
  loadMigrations,
} from './migration-helpers';

describe('Migration 0000: Consolidated Schema', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('creates all expected tables', () => {
    applyMigration(db, migrations[0]);
    const tables = getTables(db);
    const expectedTables = [
      'expenses',
      'insurance_policies',
      'insurance_policy_vehicles',
      'odometer_entries',
      'photo_refs',
      'photos',
      'sessions',
      'user_providers',
      'user_settings',
      'users',
      'vehicle_financing',
      'vehicles',
    ];
    for (const table of expectedTables) {
      expect(tables).toContain(table);
    }
  });

  test('vehicles table has expected columns', () => {
    applyMigration(db, migrations[0]);
    const cols = getColumnNames(db, 'vehicles');
    expect(cols).toContain('id');
    expect(cols).toContain('user_id');
    expect(cols).toContain('make');
    expect(cols).toContain('model');
    expect(cols).toContain('year');
    expect(cols).toContain('vehicle_type');
    expect(cols).toContain('unit_preferences');
  });

  test('user_settings has backup_config column', () => {
    applyMigration(db, migrations[0]);
    const cols = getColumnNames(db, 'user_settings');
    expect(cols).toContain('backup_config');
    expect(cols).toContain('storage_config');
    // Legacy columns should NOT exist
    expect(cols).not.toContain('google_drive_backup_enabled');
    expect(cols).not.toContain('google_sheets_sync_enabled');
  });

  test('users.email has a unique index', () => {
    applyMigration(db, migrations[0]);
    const indexes = getIndexNames(db, 'users');
    expect(indexes.some((n) => n.includes('email'))).toBe(true);
  });

  test('insurance_policies has user_id column with NOT NULL and index', () => {
    applyMigration(db, migrations[0]);
    const cols = getColumnNames(db, 'insurance_policies');
    expect(cols).toContain('user_id');
    const info = db.query("PRAGMA table_info('insurance_policies')").all() as {
      name: string;
      notnull: number;
    }[];
    const userIdCol = info.find((c) => c.name === 'user_id');
    expect(userIdCol).toBeDefined();
    expect(userIdCol?.notnull).toBe(1);
    const indexes = getIndexNames(db, 'insurance_policies');
    expect(indexes).toContain('insurance_policies_user_id_idx');
  });

  test('user_settings.user_id has a unique index', () => {
    applyMigration(db, migrations[0]);
    const indexes = getIndexNames(db, 'user_settings');
    expect(indexes.some((n) => n.includes('user_id'))).toBe(true);
  });

  test('FK cascade: deleting insurance policy sets vehicle.current_insurance_policy_id to NULL', () => {
    applyMigration(db, migrations[0]);

    db.run(
      "INSERT INTO users (id, email, display_name) VALUES ('u1', 'test@example.com', 'Test User')"
    );
    db.run(
      "INSERT INTO insurance_policies (id, user_id, company, terms) VALUES ('ip1', 'u1', 'Geico', '[]')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year, current_insurance_policy_id) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022, 'ip1')"
    );

    const before = db
      .query("SELECT current_insurance_policy_id FROM vehicles WHERE id = 'v1'")
      .get() as { current_insurance_policy_id: string | null };
    expect(before.current_insurance_policy_id).toBe('ip1');

    db.run("DELETE FROM insurance_policies WHERE id = 'ip1'");

    const after = db
      .query("SELECT current_insurance_policy_id FROM vehicles WHERE id = 'v1'")
      .get() as { current_insurance_policy_id: string | null };
    expect(after.current_insurance_policy_id).toBeNull();
    expect(countRows(db, 'vehicles')).toBe(1);
  });

  test('FK constraint: inserting vehicle with non-existent policy ID is rejected', () => {
    applyMigration(db, migrations[0]);

    db.run(
      "INSERT INTO users (id, email, display_name) VALUES ('u1', 'test@example.com', 'Test User')"
    );

    expect(() => {
      db.run(
        "INSERT INTO vehicles (id, user_id, make, model, year, current_insurance_policy_id) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022, 'nonexistent')"
      );
    }).toThrow();
  });
});
