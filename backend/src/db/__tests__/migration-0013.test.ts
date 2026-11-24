import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  getColumnNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0013: vehicles record a kind', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 12);
  });

  afterEach(() => {
    db.close();
  });

  test('adds vehicle_kind, and every existing vehicle becomes a car', () => {
    seedCoreData(db);
    const before = db.query('SELECT id, make, model, vehicle_type FROM vehicles ORDER BY id').all();

    applyMigration(db, migrations[13]);

    expect(getColumnNames(db, 'vehicles')).toContain('vehicle_kind');
    expect(
      db.query('SELECT id, make, model, vehicle_type FROM vehicles ORDER BY id').all()
    ).toEqual(before);
    expect(
      db.query("SELECT COUNT(*) AS n FROM vehicles WHERE vehicle_kind <> 'car'").get()
    ).toEqual({ n: 0 });
  });

  test('a vehicle inserted without a kind defaults to car', () => {
    applyMigration(db, migrations[13]);
    seedCoreData(db);
    const kinds = db.query('SELECT DISTINCT vehicle_kind AS kind FROM vehicles').all();
    expect(kinds).toEqual([{ kind: 'car' }]);
  });
});
