/**
 * Migration 0007: User Providers, Storage Config, Photo Refs & Photos Column Removal
 *
 * Creates `user_providers` table for domain-agnostic provider connections.
 * Adds `storage_config` JSON column to `user_settings` with default value.
 * Creates `photo_refs` table for provider-agnostic photo storage references.
 * Removes `drive_file_id` and `web_view_link` columns from `photos` table.
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

describe('Migration 0007: User Providers, Storage Config, Photo Refs & Photos Column Removal', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('creates user_providers table', () => {
    applyMigrationsUpTo(db, migrations, 7);
    expect(getTables(db)).toContain('user_providers');
  });

  test('user_providers has correct columns', () => {
    applyMigrationsUpTo(db, migrations, 7);
    const cols = getColumnNames(db, 'user_providers');
    expect(cols).toContain('id');
    expect(cols).toContain('user_id');
    expect(cols).toContain('domain');
    expect(cols).toContain('provider_type');
    expect(cols).toContain('display_name');
    expect(cols).toContain('credentials');
    expect(cols).toContain('config');
    expect(cols).toContain('status');
    expect(cols).toContain('last_sync_at');
    expect(cols).toContain('created_at');
    expect(cols).toContain('updated_at');
  });

  test('user_providers has composite index on (user_id, domain)', () => {
    applyMigrationsUpTo(db, migrations, 7);
    const indexes = getIndexNames(db, 'user_providers');
    expect(indexes).toContain('up_user_domain_idx');
  });

  test('user_providers enforces NOT NULL on required columns', () => {
    applyMigrationsUpTo(db, migrations, 7);

    // Insert a user first for FK
    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test', 'google', 'gid-1')"
    );

    // Missing domain should fail
    expect(() => {
      db.run(
        "INSERT INTO user_providers (id, user_id, provider_type, display_name, credentials) VALUES ('p1', 'u1', 'google-drive', 'My Drive', 'encrypted')"
      );
    }).toThrow();
  });

  test('user_providers cascades on user delete', () => {
    applyMigrationsUpTo(db, migrations, 7);

    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test', 'google', 'gid-1')"
    );
    db.run(
      "INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials) VALUES ('p1', 'u1', 'storage', 'google-drive', 'My Drive', 'encrypted')"
    );
    expect(countRows(db, 'user_providers')).toBe(1);

    db.run("DELETE FROM users WHERE id = 'u1'");
    expect(countRows(db, 'user_providers')).toBe(0);
  });

  test('user_settings has storage_config column', () => {
    applyMigrationsUpTo(db, migrations, 7);
    const cols = getColumnNames(db, 'user_settings');
    expect(cols).toContain('storage_config');
  });

  test('storage_config has correct default value', () => {
    applyMigrationsUpTo(db, migrations, 7);

    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test', 'google', 'gid-1')"
    );
    db.run("INSERT INTO user_settings (id, user_id) VALUES ('s1', 'u1')");

    const row = db.query("SELECT storage_config FROM user_settings WHERE id = 's1'").get() as {
      storage_config: string;
    };
    const config = JSON.parse(row.storage_config);
    expect(config.defaults.vehicle_photos).toBeNull();
    expect(config.defaults.expense_receipts).toBeNull();
    expect(config.defaults.insurance_docs).toBeNull();
    expect(config.providerCategories).toEqual({});
  });

  test('creates photo_refs table', () => {
    applyMigrationsUpTo(db, migrations, 7);
    expect(getTables(db)).toContain('photo_refs');
  });

  test('photo_refs has correct columns', () => {
    applyMigrationsUpTo(db, migrations, 7);
    const cols = getColumnNames(db, 'photo_refs');
    expect(cols).toContain('id');
    expect(cols).toContain('photo_id');
    expect(cols).toContain('provider_id');
    expect(cols).toContain('storage_ref');
    expect(cols).toContain('external_url');
    expect(cols).toContain('status');
    expect(cols).toContain('error_message');
    expect(cols).toContain('retry_count');
    expect(cols).toContain('synced_at');
    expect(cols).toContain('created_at');
  });

  test('photo_refs has unique index on (photo_id, provider_id)', () => {
    applyMigrationsUpTo(db, migrations, 7);
    const indexes = getIndexNames(db, 'photo_refs');
    expect(indexes).toContain('pr_photo_provider_idx');
  });

  test('photo_refs has index on status', () => {
    applyMigrationsUpTo(db, migrations, 7);
    const indexes = getIndexNames(db, 'photo_refs');
    expect(indexes).toContain('pr_pending_idx');
  });

  test('photo_refs enforces NOT NULL on required columns', () => {
    applyMigrationsUpTo(db, migrations, 7);

    // Set up prerequisite data
    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test', 'google', 'gid-1')"
    );
    db.run(
      "INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials) VALUES ('prov1', 'u1', 'storage', 'google-drive', 'My Drive', 'encrypted')"
    );
    db.run(
      "INSERT INTO photos (id, entity_type, entity_id, file_name, mime_type, file_size) VALUES ('ph1', 'vehicle', 'v1', 'photo.jpg', 'image/jpeg', 1024)"
    );

    // Missing storage_ref should fail
    expect(() => {
      db.run(
        "INSERT INTO photo_refs (id, photo_id, provider_id, status) VALUES ('pr1', 'ph1', 'prov1', 'active')"
      );
    }).toThrow();
  });

  test('photo_refs enforces unique constraint on (photo_id, provider_id)', () => {
    applyMigrationsUpTo(db, migrations, 7);

    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test', 'google', 'gid-1')"
    );
    db.run(
      "INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials) VALUES ('prov1', 'u1', 'storage', 'google-drive', 'My Drive', 'encrypted')"
    );
    db.run(
      "INSERT INTO photos (id, entity_type, entity_id, file_name, mime_type, file_size) VALUES ('ph1', 'vehicle', 'v1', 'photo.jpg', 'image/jpeg', 1024)"
    );
    db.run(
      "INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, status) VALUES ('pr1', 'ph1', 'prov1', 'drive-abc', 'active')"
    );

    // Duplicate (photo_id, provider_id) should fail
    expect(() => {
      db.run(
        "INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, status) VALUES ('pr2', 'ph1', 'prov1', 'drive-xyz', 'pending')"
      );
    }).toThrow();
  });

  test('photo_refs cascades on photo delete', () => {
    applyMigrationsUpTo(db, migrations, 7);

    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test', 'google', 'gid-1')"
    );
    db.run(
      "INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials) VALUES ('prov1', 'u1', 'storage', 'google-drive', 'My Drive', 'encrypted')"
    );
    db.run(
      "INSERT INTO photos (id, entity_type, entity_id, file_name, mime_type, file_size) VALUES ('ph1', 'vehicle', 'v1', 'photo.jpg', 'image/jpeg', 1024)"
    );
    db.run(
      "INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, status) VALUES ('pr1', 'ph1', 'prov1', 'drive-abc', 'active')"
    );
    expect(countRows(db, 'photo_refs')).toBe(1);

    db.run("DELETE FROM photos WHERE id = 'ph1'");
    expect(countRows(db, 'photo_refs')).toBe(0);
  });

  test('photo_refs cascades on provider delete', () => {
    applyMigrationsUpTo(db, migrations, 7);

    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test', 'google', 'gid-1')"
    );
    db.run(
      "INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials) VALUES ('prov1', 'u1', 'storage', 'google-drive', 'My Drive', 'encrypted')"
    );
    db.run(
      "INSERT INTO photos (id, entity_type, entity_id, file_name, mime_type, file_size) VALUES ('ph1', 'vehicle', 'v1', 'photo.jpg', 'image/jpeg', 1024)"
    );
    db.run(
      "INSERT INTO photo_refs (id, photo_id, provider_id, storage_ref, status) VALUES ('pr1', 'ph1', 'prov1', 'drive-abc', 'active')"
    );
    expect(countRows(db, 'photo_refs')).toBe(1);

    db.run("DELETE FROM user_providers WHERE id = 'prov1'");
    expect(countRows(db, 'photo_refs')).toBe(0);
  });

  test('photos table no longer has drive_file_id column', () => {
    applyMigrationsUpTo(db, migrations, 7);
    const cols = getColumnNames(db, 'photos');
    expect(cols).not.toContain('drive_file_id');
  });

  test('photos table no longer has web_view_link column', () => {
    applyMigrationsUpTo(db, migrations, 7);
    const cols = getColumnNames(db, 'photos');
    expect(cols).not.toContain('web_view_link');
  });

  test('photos table retains metadata columns', () => {
    applyMigrationsUpTo(db, migrations, 7);
    const cols = getColumnNames(db, 'photos');
    expect(cols).toContain('id');
    expect(cols).toContain('entity_type');
    expect(cols).toContain('entity_id');
    expect(cols).toContain('file_name');
    expect(cols).toContain('mime_type');
    expect(cols).toContain('file_size');
    expect(cols).toContain('is_cover');
    expect(cols).toContain('sort_order');
    expect(cols).toContain('created_at');
  });

  test('existing photo data survives migration', () => {
    applyMigrationsUpTo(db, migrations, 6);

    // Insert prerequisite data and a photo (with drive_file_id since it still exists)
    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test', 'google', 'gid-1')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
    );
    db.run(
      "INSERT INTO photos (id, entity_type, entity_id, drive_file_id, file_name, mime_type, file_size, is_cover, sort_order) VALUES ('ph1', 'vehicle', 'v1', 'drive-abc', 'car.jpg', 'image/jpeg', 2048, 1, 0)"
    );
    expect(countRows(db, 'photos')).toBe(1);

    // Apply migration 0007
    applyMigration(db, migrations[7]);

    // Photo row survives
    expect(countRows(db, 'photos')).toBe(1);

    // Verify metadata is preserved
    const photo = db.query("SELECT * FROM photos WHERE id = 'ph1'").get() as Record<
      string,
      unknown
    >;
    expect(photo.entity_type).toBe('vehicle');
    expect(photo.entity_id).toBe('v1');
    expect(photo.file_name).toBe('car.jpg');
    expect(photo.mime_type).toBe('image/jpeg');
    expect(photo.file_size).toBe(2048);
    expect(photo.is_cover).toBe(1);
    expect(photo.sort_order).toBe(0);
  });

  test('seed data survives this migration', () => {
    applyMigrationsUpTo(db, migrations, 6);
    seedCoreData(db);
    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    applyMigration(db, migrations[7]);

    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);
  });
});
