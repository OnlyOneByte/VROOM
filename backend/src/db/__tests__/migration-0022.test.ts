import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  getColumnNames,
  loadMigrations,
} from './migration-helpers';

function admins(db: Database) {
  return db
    .query(
      "SELECT user_id FROM role_assignments WHERE role_id = 'builtin_admin' AND scope_id IS NULL"
    )
    .all();
}

describe('Migration 0022: sign-up modes, invites and the waiting state', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 21);
  });

  afterEach(() => {
    db.close();
  });

  test('an existing server stays open, and its oldest account becomes the only admin', () => {
    for (const [id, created] of [
      ['demo-garage', 1],
      ['newer', 300],
      ['oldest', 200],
    ] as const) {
      db.run('INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)', [
        id,
        `${id}@test.com`,
        id,
        created,
      ]);
    }

    applyMigration(db, migrations[22]);

    expect(
      db.query('SELECT id, signup_mode, allowed_email_domains FROM server_settings').all()
    ).toEqual([{ id: 1, signup_mode: 'open', allowed_email_domains: '' }]);
    expect(admins(db)).toEqual([{ user_id: 'oldest' }]);
    expect(getColumnNames(db, 'users')).toContain('pending_approval_at');
    expect(
      db.query('SELECT COUNT(*) AS n FROM users WHERE pending_approval_at IS NOT NULL').get()
    ).toEqual({ n: 0 });
  });

  test('a server that already has an admin keeps it and gains no other', () => {
    db.run(
      "INSERT INTO users (id, email, display_name, created_at) VALUES ('a', 'a@test.com', 'a', 1)"
    );
    db.run(
      "INSERT INTO users (id, email, display_name, created_at) VALUES ('b', 'b@test.com', 'b', 2)"
    );
    db.run(
      "INSERT INTO role_assignments (id, user_id, role_id, scope_id) VALUES ('ra', 'b', 'builtin_admin', NULL)"
    );
    applyMigration(db, migrations[22]);
    expect(admins(db)).toEqual([{ user_id: 'b' }]);
  });

  test('a new, empty server gets no settings row, so it starts invite only on first sign-up', () => {
    db.run(
      "INSERT INTO users (id, email, display_name) VALUES ('demo-garage', 'demo@vroom.invalid', 'Demo')"
    );
    applyMigration(db, migrations[22]);
    expect(db.query('SELECT COUNT(*) AS n FROM server_settings').get()).toEqual({ n: 0 });
    expect(admins(db)).toEqual([]);
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
