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

describe('Migration 0001: vehicle_shares.invited_email', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 0);
  });

  afterEach(() => {
    db.close();
  });

  test('adds a nullable invited_email column', () => {
    expect(getColumnNames(db, 'vehicle_shares')).not.toContain('invited_email');
    applyMigration(db, migrations[1]);
    expect(getColumnNames(db, 'vehicle_shares')).toContain('invited_email');
  });

  test('existing shares and core data survive with a null invited_email', () => {
    seedCoreData(db);
    db.run("INSERT INTO users (id, email, display_name) VALUES ('u2', 'b@example.com', 'B')");
    db.run(
      "INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status) VALUES ('s1', 'v1', 'u1', 'u2', 'viewer', 'pending')"
    );

    applyMigration(db, migrations[1]);

    expect(countRows(db, 'expenses')).toBe(1);
    expect(countRows(db, 'vehicle_shares')).toBe(1);
    expect(db.query("SELECT invited_email FROM vehicle_shares WHERE id = 's1'").get()).toEqual({
      invited_email: null,
    });
  });
});
