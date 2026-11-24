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

describe('Migration 0017: roles, role permissions, role assignments and permission overrides', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 16);
  });

  afterEach(() => {
    db.close();
  });

  test('creates the four tables, their unique indexes and users.disabled_at', () => {
    seedCoreData(db);
    const vehiclesBefore = db.query('SELECT COUNT(*) AS n FROM vehicles').get();

    applyMigration(db, migrations[17]);

    expect(getTables(db)).toEqual(
      expect.arrayContaining([
        'roles',
        'role_permissions',
        'role_assignments',
        'permission_overrides',
      ])
    );
    expect(getIndexNames(db, 'roles')).toContain('roles_scope_key_idx');
    expect(getIndexNames(db, 'role_assignments')).toEqual(
      expect.arrayContaining(['ra_user_role_scope_idx', 'ra_server_user_role_idx'])
    );
    expect(getIndexNames(db, 'permission_overrides')).toEqual(
      expect.arrayContaining(['po_user_scope_permission_idx', 'po_server_user_permission_idx'])
    );
    expect(getColumnNames(db, 'users')).toContain('disabled_at');
    expect(db.query('SELECT disabled_at FROM users').get()).toEqual({ disabled_at: null });
    expect(db.query('SELECT COUNT(*) AS n FROM vehicles').get()).toEqual(vehiclesBefore);
  });
});
