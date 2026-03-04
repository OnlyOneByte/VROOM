/**
 * Migration 0005: Custom Drive Folder Name
 *
 * Adds `google_drive_custom_folder_name` (nullable text) column
 * to the `user_settings` table.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  getColumnNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0005: Custom Drive Folder Name', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('user_settings table has google_drive_custom_folder_name column', () => {
    applyMigrationsUpTo(db, migrations, 5);

    const cols = getColumnNames(db, 'user_settings');
    expect(cols).toContain('google_drive_custom_folder_name');
  });

  test('google_drive_custom_folder_name defaults to null', () => {
    applyMigrationsUpTo(db, migrations, 5);

    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test', 'google', 'g1')"
    );
    db.run("INSERT INTO user_settings (id, user_id) VALUES ('s1', 'u1')");

    const settings = db
      .query("SELECT google_drive_custom_folder_name FROM user_settings WHERE id = 's1'")
      .get() as { google_drive_custom_folder_name: string | null };
    expect(settings.google_drive_custom_folder_name).toBeNull();
  });

  test('seed data survives this migration', () => {
    applyMigrationsUpTo(db, migrations, 4);
    seedCoreData(db);

    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    applyMigration(db, migrations[5]);

    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    const user = db.query("SELECT * FROM users WHERE id = 'u1'").get() as { email: string };
    expect(user.email).toBe('test@example.com');
  });
});
