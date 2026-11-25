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

describe('Migration 0024: sign-up modes, invites and the waiting state', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 23);
  });

  afterEach(() => {
    db.close();
  });

  test('an existing server stays open, and its data and roles are untouched', () => {
    seedCoreData(db);
    const rolesBefore = countRows(db, 'role_assignments');
    applyMigration(db, migrations[24]);

    expect(
      db.query('SELECT id, signup_mode, allowed_email_domains FROM server_settings').all()
    ).toEqual([{ id: 1, signup_mode: 'open', allowed_email_domains: '' }]);
    expect(db.query("SELECT email, pending_approval_at FROM users WHERE id = 'u1'").get()).toEqual({
      email: 'test@example.com',
      pending_approval_at: null,
    });
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);
    expect(countRows(db, 'role_assignments')).toBe(rolesBefore);
  });

  test('a new, empty server gets no settings row, so it starts invite only on first sign-up', () => {
    db.run(
      "INSERT INTO users (id, email, display_name) VALUES ('demo-garage', 'demo@vroom.invalid', 'Demo')"
    );
    applyMigration(db, migrations[24]);
    expect(countRows(db, 'server_settings')).toBe(0);
    expect(getColumnNames(db, 'server_invites').sort()).toEqual([
      'created_at',
      'created_by',
      'email',
      'expires_at',
      'id',
      'revoked_at',
      'used_at',
      'used_by',
    ]);
  });
});
