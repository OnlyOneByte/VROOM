/**
 * Data Migration Tests: Auto-create Google Drive providers and backfill photo_refs.
 *
 * Tests the TypeScript data migration hook that runs after Drizzle migrations.
 * Verifies provider creation, storage_config population, and photo_refs backfill.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runDataMigration } from '../data-migration';
import { applyMigrationsUpTo, countRows, loadMigrations } from './migration-helpers';

describe('Data Migration: Auto-create providers and backfill photo_refs', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    // Apply all migrations through 0007 (which creates temp table + photo_refs)
    applyMigrationsUpTo(db, migrations, 7);
  });

  afterEach(() => {
    db.close();
  });

  // Set the encryption key for tests
  const TEST_KEY = 'a'.repeat(64); // 32-byte hex key
  const originalKey = process.env.PROVIDER_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.PROVIDER_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    if (originalKey) {
      process.env.PROVIDER_ENCRYPTION_KEY = originalKey;
    } else {
      delete process.env.PROVIDER_ENCRYPTION_KEY;
    }
  });

  function insertUserWithToken(id: string, token: string | null) {
    db.run(
      `INSERT INTO users (id, email, display_name, provider, provider_id, google_refresh_token)
       VALUES (?, ?, 'Test User', 'google', 'gid-${id}', ?)`,
      [id, `${id}@test.com`, token]
    );
  }

  function insertVehicle(id: string, userId: string) {
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, 'Toyota', 'Camry', 2022)",
      [id, userId]
    );
  }

  function insertDrivePhoto(
    photoId: string,
    entityType: string,
    entityId: string,
    driveFileId: string,
    webViewLink: string | null
  ) {
    // Insert into photos table (post-migration 0007, no drive columns)
    db.run(
      "INSERT INTO photos (id, entity_type, entity_id, file_name, mime_type, file_size) VALUES (?, ?, ?, 'photo.jpg', 'image/jpeg', 1024)",
      [photoId, entityType, entityId]
    );
    // Insert into temp table (created by migration 0007)
    db.run(
      'INSERT INTO _photos_drive_data (photo_id, drive_file_id, web_view_link) VALUES (?, ?, ?)',
      [photoId, driveFileId, webViewLink]
    );
  }

  test('creates provider for user with google refresh token', async () => {
    insertUserWithToken('u1', 'refresh-token-abc');

    await runDataMigration(db);

    expect(countRows(db, 'user_providers')).toBe(1);

    const provider = db.query("SELECT * FROM user_providers WHERE user_id = 'u1'").get() as Record<
      string,
      unknown
    >;
    expect(provider.domain).toBe('storage');
    expect(provider.provider_type).toBe('google-drive');
    expect(provider.display_name).toBe('Google Drive');
    expect(provider.status).toBe('active');

    // Config should have rootPath
    const config = JSON.parse(provider.config as string);
    expect(config.rootPath).toBe('/VROOM');

    // Credentials should be encrypted (not plaintext)
    expect(provider.credentials).not.toContain('refresh-token-abc');
    expect(typeof provider.credentials).toBe('string');
    expect((provider.credentials as string).length).toBeGreaterThan(0);
  });

  test('does NOT create provider for user without google refresh token', async () => {
    insertUserWithToken('u1', null);

    await runDataMigration(db);

    expect(countRows(db, 'user_providers')).toBe(0);
  });

  test('creates providers for multiple users with tokens', async () => {
    insertUserWithToken('u1', 'token-1');
    insertUserWithToken('u2', 'token-2');
    insertUserWithToken('u3', null); // no token

    await runDataMigration(db);

    expect(countRows(db, 'user_providers')).toBe(2);
  });

  test('populates storage_config correctly in user_settings', async () => {
    insertUserWithToken('u1', 'refresh-token-abc');

    await runDataMigration(db);

    const settings = db.query("SELECT * FROM user_settings WHERE user_id = 'u1'").get() as Record<
      string,
      unknown
    >;
    expect(settings).not.toBeNull();

    const storageConfig = JSON.parse(settings.storage_config as string);
    const provider = db.query("SELECT id FROM user_providers WHERE user_id = 'u1'").get() as {
      id: string;
    };

    // All defaults should point to the created provider
    expect(storageConfig.defaults.vehicle_photos).toBe(provider.id);
    expect(storageConfig.defaults.expense_receipts).toBe(provider.id);
    expect(storageConfig.defaults.insurance_docs).toBe(provider.id);

    // Provider categories should be populated
    const categories = storageConfig.providerCategories[provider.id];
    expect(categories.vehicle_photos).toEqual({ enabled: true, folderPath: '/Vehicle Photos' });
    expect(categories.expense_receipts).toEqual({ enabled: true, folderPath: '/Receipts' });
    expect(categories.insurance_docs).toEqual({ enabled: true, folderPath: '/Insurance' });
  });

  test('updates existing user_settings row instead of creating duplicate', async () => {
    insertUserWithToken('u1', 'refresh-token-abc');

    // Pre-create a user_settings row
    db.run("INSERT INTO user_settings (id, user_id, currency_unit) VALUES ('s1', 'u1', 'EUR')");

    await runDataMigration(db);

    expect(countRows(db, 'user_settings')).toBe(1);

    const settings = db.query("SELECT * FROM user_settings WHERE user_id = 'u1'").get() as Record<
      string,
      unknown
    >;
    expect(settings.currency_unit).toBe('EUR'); // preserved
    expect(settings.storage_config).not.toBeNull(); // updated
  });

  test('creates photo_refs from _photos_drive_data for vehicle photos', async () => {
    insertUserWithToken('u1', 'refresh-token-abc');
    insertVehicle('v1', 'u1');
    insertDrivePhoto('ph1', 'vehicle', 'v1', 'drive-file-123', 'https://drive.google.com/view/123');

    await runDataMigration(db);

    expect(countRows(db, 'photo_refs')).toBe(1);

    const ref = db.query("SELECT * FROM photo_refs WHERE photo_id = 'ph1'").get() as Record<
      string,
      unknown
    >;
    expect(ref.storage_ref).toBe('drive-file-123');
    expect(ref.external_url).toBe('https://drive.google.com/view/123');
    expect(ref.status).toBe('active');

    // Provider should match the auto-created one
    const provider = db.query("SELECT id FROM user_providers WHERE user_id = 'u1'").get() as {
      id: string;
    };
    expect(ref.provider_id).toBe(provider.id);
  });

  test('creates photo_refs for expense photos via vehicle ownership chain', async () => {
    insertUserWithToken('u1', 'refresh-token-abc');
    insertVehicle('v1', 'u1');
    db.run(
      "INSERT INTO expenses (id, vehicle_id, category, date, expense_amount) VALUES ('e1', 'v1', 'fuel', 1700000000, 45.50)"
    );
    insertDrivePhoto('ph1', 'expense', 'e1', 'drive-expense-file', null);

    await runDataMigration(db);

    expect(countRows(db, 'photo_refs')).toBe(1);

    const ref = db.query("SELECT * FROM photo_refs WHERE photo_id = 'ph1'").get() as Record<
      string,
      unknown
    >;
    expect(ref.storage_ref).toBe('drive-expense-file');
    expect(ref.external_url).toBeNull();
    expect(ref.status).toBe('active');
  });

  test('handles multiple photos for same user', async () => {
    insertUserWithToken('u1', 'refresh-token-abc');
    insertVehicle('v1', 'u1');
    insertDrivePhoto('ph1', 'vehicle', 'v1', 'drive-1', 'https://link1');
    insertDrivePhoto('ph2', 'vehicle', 'v1', 'drive-2', 'https://link2');

    await runDataMigration(db);

    expect(countRows(db, 'photo_refs')).toBe(2);
  });

  test('drops _photos_drive_data temp table after migration', async () => {
    insertUserWithToken('u1', 'refresh-token-abc');

    await runDataMigration(db);

    const tempTable = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='_photos_drive_data'")
      .get();
    expect(tempTable).toBeNull();
  });

  test('idempotent — running twice does not create duplicate providers', async () => {
    insertUserWithToken('u1', 'refresh-token-abc');
    insertVehicle('v1', 'u1');
    insertDrivePhoto('ph1', 'vehicle', 'v1', 'drive-1', null);

    await runDataMigration(db);

    const providerCount1 = countRows(db, 'user_providers');
    const refCount1 = countRows(db, 'photo_refs');

    // Run again — should be a no-op
    await runDataMigration(db);

    expect(countRows(db, 'user_providers')).toBe(providerCount1);
    expect(countRows(db, 'photo_refs')).toBe(refCount1);
  });

  test('skips photos with null drive_file_id', async () => {
    insertUserWithToken('u1', 'refresh-token-abc');
    insertVehicle('v1', 'u1');

    // Photo in photos table
    db.run(
      "INSERT INTO photos (id, entity_type, entity_id, file_name, mime_type, file_size) VALUES ('ph1', 'vehicle', 'v1', 'photo.jpg', 'image/jpeg', 1024)"
    );
    // Temp table entry with null drive_file_id
    db.run(
      "INSERT INTO _photos_drive_data (photo_id, drive_file_id, web_view_link) VALUES ('ph1', NULL, NULL)"
    );

    await runDataMigration(db);

    expect(countRows(db, 'photo_refs')).toBe(0);
  });

  test('handles no users gracefully', async () => {
    // No users at all
    await runDataMigration(db);

    expect(countRows(db, 'user_providers')).toBe(0);
    expect(countRows(db, 'photo_refs')).toBe(0);
  });

  test('handles users with tokens but no photos', async () => {
    insertUserWithToken('u1', 'refresh-token-abc');

    await runDataMigration(db);

    expect(countRows(db, 'user_providers')).toBe(1);
    expect(countRows(db, 'photo_refs')).toBe(0);
  });
});
