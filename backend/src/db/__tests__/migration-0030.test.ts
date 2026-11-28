import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  getColumnNames,
  loadMigrations,
} from './migration-helpers';

describe('Migration 0030: the owners behind each released community group', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 29);
  });

  afterEach(() => {
    db.close();
  });

  test('creates community_release_members keyed by scope, group and member', () => {
    db.run("INSERT INTO community_refreshes (scope, refreshed_at) VALUES ('local', 1700000000)");

    applyMigration(db, migrations[30]);

    expect(getColumnNames(db, 'community_release_members').sort()).toEqual([
      'bucket_key',
      'member_tag',
      'scope',
    ]);
    const insert = "INSERT INTO community_release_members VALUES ('local', 'g', 't')";
    db.run(insert);
    expect(() => db.run(insert)).toThrow();
    expect(db.query('SELECT scope FROM community_refreshes').all()).toEqual([{ scope: 'local' }]);
  });
});
