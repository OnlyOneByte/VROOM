import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  getIndexNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0003: vehicle_shares.shared_with_id becomes nullable', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 2);
  });

  afterEach(() => {
    db.close();
  });

  function insertUnattachedInvite(): void {
    db.run(
      "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status, invited_email) VALUES ('s-new', 'v1', 'u1', NULL, 'viewer', 'pending', 'later@example.com')"
    );
  }

  test('accepts a pending invite with no invitee account', () => {
    seedCoreData(db);
    expect(insertUnattachedInvite).toThrow();
    applyMigration(db, migrations[3]);
    insertUnattachedInvite();
    expect(countRows(db, 'vehicle_shares')).toBe(1);
  });

  test('existing shares, their indexes and core data survive', () => {
    seedCoreData(db);
    db.run("INSERT INTO users (id, email, display_name) VALUES ('u2', 'b@example.com', 'B')");
    db.run(
      "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status, invited_email) VALUES ('s1', 'v1', 'u1', 'u2', 'editor', 'accepted', 'b@example.com')"
    );

    applyMigration(db, migrations[3]);

    expect(countRows(db, 'expenses')).toBe(1);
    expect(db.query("SELECT * FROM vehicle_shares WHERE id = 's1'").get()).toMatchObject({
      vehicle_id: 'v1',
      owner_id: 'u1',
      shared_with_id: 'u2',
      level: 'editor',
      status: 'accepted',
      invited_email: 'b@example.com',
    });
    expect(getIndexNames(db, 'vehicle_shares')).toEqual(
      expect.arrayContaining([
        'vehicle_shares_active_idx',
        'vehicle_shares_shared_with_idx',
        'vehicle_shares_owner_idx',
      ])
    );
  });

  test('deleting the invitee account still cascades to their shares', () => {
    seedCoreData(db);
    db.run("INSERT INTO users (id, email, display_name) VALUES ('u2', 'b@example.com', 'B')");
    db.run(
      "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status) VALUES ('s1', 'v1', 'u1', 'u2', 'viewer', 'pending')"
    );
    applyMigration(db, migrations[3]);

    db.run("DELETE FROM users WHERE id = 'u2'");

    expect(countRows(db, 'vehicle_shares')).toBe(0);
  });
});
