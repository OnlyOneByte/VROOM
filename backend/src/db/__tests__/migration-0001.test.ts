/**
 * Migration 0001: Photos table
 *
 * Adds the polymorphic `photos` table with a composite index
 * on (entity_type, entity_id).
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

describe('Migration 0001: Photos Table', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('creates photos table', () => {
    applyMigrationsUpTo(db, migrations, 1);

    const tables = getTables(db);
    expect(tables).toContain('photos');
  });

  test('photos table has all expected columns', () => {
    applyMigrationsUpTo(db, migrations, 1);

    const cols = getColumnNames(db, 'photos');
    expect(cols).toContain('id');
    expect(cols).toContain('entity_type');
    expect(cols).toContain('entity_id');
    expect(cols).toContain('drive_file_id');
    expect(cols).toContain('file_name');
    expect(cols).toContain('mime_type');
    expect(cols).toContain('file_size');
    expect(cols).toContain('web_view_link');
    expect(cols).toContain('is_cover');
    expect(cols).toContain('sort_order');
    expect(cols).toContain('created_at');
  });

  test('composite index on (entity_type, entity_id) exists', () => {
    applyMigrationsUpTo(db, migrations, 1);

    const indexes = getIndexNames(db, 'photos');
    expect(indexes.some((n) => n.includes('entity'))).toBe(true);
  });

  test('seed data in core tables survives this migration', () => {
    applyMigrationsUpTo(db, migrations, 0);
    seedCoreData(db);

    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    // Apply only migration 0001
    applyMigration(db, migrations[1]);

    // All seed data must survive
    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    // Verify data integrity
    const user = db.query("SELECT * FROM users WHERE id = 'u1'").get() as { email: string };
    expect(user.email).toBe('test@example.com');

    const vehicle = db.query("SELECT * FROM vehicles WHERE id = 'v1'").get() as {
      make: string;
      model: string;
    };
    expect(vehicle.make).toBe('Toyota');
    expect(vehicle.model).toBe('Camry');

    // New photos table should be empty but functional
    expect(countRows(db, 'photos')).toBe(0);
  });

  test('enforces NOT NULL on entity_type', () => {
    applyMigrationsUpTo(db, migrations, 1);

    expect(() => {
      db.run(
        "INSERT INTO photos (id, entity_id, drive_file_id, file_name, mime_type, file_size, is_cover, sort_order) VALUES ('p1', 'v1', 'drive-abc', 'photo.jpg', 'image/jpeg', 1024, 0, 0)"
      );
    }).toThrow();
  });

  test('enforces NOT NULL on drive_file_id', () => {
    applyMigrationsUpTo(db, migrations, 1);

    expect(() => {
      db.run(
        "INSERT INTO photos (id, entity_type, entity_id, file_name, mime_type, file_size, is_cover, sort_order) VALUES ('p1', 'vehicle', 'v1', 'photo.jpg', 'image/jpeg', 1024, 0, 0)"
      );
    }).toThrow();
  });

  test('accepts a valid photo row', () => {
    applyMigrationsUpTo(db, migrations, 1);

    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test User', 'google', 'gid-123')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Honda', 'Civic', 2023)"
    );
    db.run(
      "INSERT INTO photos (id, entity_type, entity_id, drive_file_id, file_name, mime_type, file_size, is_cover, sort_order) VALUES ('p1', 'vehicle', 'v1', 'drive-abc', 'photo.jpg', 'image/jpeg', 1024, 1, 0)"
    );

    expect(countRows(db, 'photos')).toBe(1);
  });
});
