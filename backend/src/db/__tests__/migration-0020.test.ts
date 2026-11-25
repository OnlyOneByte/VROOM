import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  getColumnNames,
  loadMigrations,
} from './migration-helpers';

describe('Migration 0020: a per-scope key for stable community-stats noise', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 19);
  });

  afterEach(() => {
    db.close();
  });

  test('creates community_noise_keys with one key per scope and leaves the refresh table alone', () => {
    db.run("INSERT INTO community_refreshes (scope, refreshed_at) VALUES ('local', 1700000000)");

    applyMigration(db, migrations[20]);

    expect(getColumnNames(db, 'community_noise_keys').sort()).toEqual(['noise_key', 'scope']);
    db.run("INSERT INTO community_noise_keys (scope, noise_key) VALUES ('local', 'k')");
    expect(() =>
      db.run("INSERT INTO community_noise_keys (scope, noise_key) VALUES ('local', 'k2')")
    ).toThrow();
    expect(db.query('SELECT scope FROM community_refreshes').all()).toEqual([{ scope: 'local' }]);
  });
});
