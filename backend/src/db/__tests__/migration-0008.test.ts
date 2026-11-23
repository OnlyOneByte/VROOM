import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  getColumnNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0008: providers record their last health check', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 7);
  });

  afterEach(() => {
    db.close();
  });

  test('adds last_error_code, last_checked_at and failure_count, and keeps existing providers', () => {
    seedCoreData(db);
    db.run(
      `INSERT INTO user_providers (id, user_id, domain, provider_type, display_name, credentials, status)
       VALUES ('p1', 'u1', 'storage', 's3', 'S3', 'x', 'active')`
    );

    applyMigration(db, migrations[8]);

    expect(getColumnNames(db, 'user_providers')).toEqual(
      expect.arrayContaining(['last_error_code', 'last_checked_at', 'failure_count'])
    );
    expect(
      db
        .query('SELECT status, last_error_code, last_checked_at, failure_count FROM user_providers')
        .get()
    ).toEqual({ status: 'active', last_error_code: null, last_checked_at: null, failure_count: 0 });
  });
});
