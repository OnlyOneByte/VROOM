import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  getColumnNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0011: vehicles can name a catalogue model', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 10);
  });

  afterEach(() => {
    db.close();
  });

  test('adds a nullable catalog_model_id and keeps existing vehicles', () => {
    seedCoreData(db);
    const before = db.query('SELECT id, make, model FROM vehicles ORDER BY id').all();

    applyMigration(db, migrations[11]);

    expect(getColumnNames(db, 'vehicles')).toContain('catalog_model_id');
    expect(db.query('SELECT id, make, model FROM vehicles ORDER BY id').all()).toEqual(before);
    expect(
      db.query('SELECT COUNT(*) AS n FROM vehicles WHERE catalog_model_id IS NOT NULL').get()
    ).toEqual({ n: 0 });
  });
});
