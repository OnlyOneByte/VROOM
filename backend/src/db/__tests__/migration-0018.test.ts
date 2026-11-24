import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

function assignments(db: Database) {
  return db
    .query(
      'SELECT user_id, role_id, scope_id, granted_by FROM role_assignments ORDER BY user_id, role_id'
    )
    .all();
}

describe('Migration 0018: built-in roles and assignments for existing members', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 17);
    seedCoreData(db);
    for (const [id, email] of [
      ['demo-garage', 'demo@vroom.invalid'],
      ['u2', 'editor@test.com'],
      ['u3', 'viewer@test.com'],
      ['u4', 'pending@test.com'],
    ]) {
      db.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [id, email, id]);
    }
    for (const [id, sharedWith, level, status] of [
      ['s2', 'u2', 'editor', 'accepted'],
      ['s3', 'u3', 'viewer', 'accepted'],
      ['s4', 'u4', 'editor', 'pending'],
    ]) {
      db.run(
        "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status) VALUES (?, 'v1', 'u1', ?, ?, ?)",
        [id, sharedWith, level, status]
      );
    }
  });

  afterEach(() => {
    db.close();
  });

  test('seeds the built-in role rows with stable ids and keys', () => {
    applyMigration(db, migrations[18]);
    expect(db.query('SELECT id, scope, key, built_in FROM roles ORDER BY id').all()).toEqual([
      { id: 'builtin_admin', scope: 'server', key: 'admin', built_in: 1 },
      { id: 'builtin_co_owner', scope: 'vehicle', key: 'co_owner', built_in: 1 },
      { id: 'builtin_demo', scope: 'server', key: 'demo', built_in: 1 },
      { id: 'builtin_editor', scope: 'vehicle', key: 'editor', built_in: 1 },
      { id: 'builtin_member', scope: 'server', key: 'member', built_in: 1 },
      { id: 'builtin_viewer', scope: 'vehicle', key: 'viewer', built_in: 1 },
    ]);
  });

  test('accepted shares become Editor or Viewer assignments; everyone holds Member, the demo user Demo', () => {
    applyMigration(db, migrations[18]);
    expect(assignments(db)).toEqual([
      { user_id: 'demo-garage', role_id: 'builtin_demo', scope_id: null, granted_by: null },
      { user_id: 'u1', role_id: 'builtin_member', scope_id: null, granted_by: null },
      { user_id: 'u2', role_id: 'builtin_editor', scope_id: 'v1', granted_by: 'u1' },
      { user_id: 'u2', role_id: 'builtin_member', scope_id: null, granted_by: null },
      { user_id: 'u3', role_id: 'builtin_member', scope_id: null, granted_by: null },
      { user_id: 'u3', role_id: 'builtin_viewer', scope_id: 'v1', granted_by: 'u1' },
      { user_id: 'u4', role_id: 'builtin_member', scope_id: null, granted_by: null },
    ]);
    expect(db.query('SELECT COUNT(*) AS n FROM expenses').get()).toEqual({ n: 1 });
  });

  test('running the backfill twice adds nothing', () => {
    applyMigration(db, migrations[18]);
    const once = assignments(db);
    applyMigration(db, migrations[18]);
    expect(assignments(db)).toEqual(once);
  });
});
