import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { applyMigration, applyMigrationsUpTo, loadMigrations } from './migration-helpers';

describe('Migration 0024: the next term vehicle position is read from an index', () => {
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

  test('adds itv_position_idx, and MAX(position) uses it instead of scanning the table', () => {
    applyMigration(db, migrations[24]);
    const indexes = db
      .query("SELECT name FROM pragma_index_list('insurance_term_vehicles')")
      .all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('itv_position_idx');
    const plan = db
      .query(
        'EXPLAIN QUERY PLAN SELECT COALESCE(MAX(position), 0) + 1 FROM insurance_term_vehicles'
      )
      .all() as { detail: string }[];
    expect(plan.map((p) => p.detail).join('\n')).toContain('itv_position_idx');
  });
});
