import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  getColumnNames,
  loadMigrations,
} from './migration-helpers';

describe('Migration 0016: community_stats keeps the average only', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 15);
  });

  afterEach(() => {
    db.close();
  });

  test('drops the quantile columns and keeps existing rows', () => {
    db.run(
      "INSERT INTO community_stats (id, scope, metric, bucket_key, unit, n_published, mean, p25, p50, p75, computed_at, schema_version) VALUES ('r', 'local', 'efficiency', 'k', 'km_per_l', 10, 12, 11, 12, 13, 0, 1)"
    );

    applyMigration(db, migrations[16]);

    const columns = getColumnNames(db, 'community_stats');
    expect(columns).not.toContain('p25');
    expect(columns).not.toContain('p50');
    expect(columns).not.toContain('p75');
    expect(db.query('SELECT bucket_key, mean FROM community_stats').all()).toEqual([
      { bucket_key: 'k', mean: 12 },
    ]);
  });
});
