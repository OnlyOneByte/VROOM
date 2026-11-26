import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  getColumnNames,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0027: undo records for driver backfills', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 26);
    seedCoreData(db);
    applyMigration(db, migrations[27]);
  });

  afterEach(() => {
    db.close();
  });

  test('the table starts empty and touches no existing entry', () => {
    expect(getColumnNames(db, 'driver_backfills')).toEqual(
      expect.arrayContaining(['vehicle_id', 'mode', 'entries', 'undone_at'])
    );
    expect(db.query('SELECT count(*) AS n FROM driver_backfills').get()).toEqual({ n: 0 });
    expect(db.query("SELECT paid_by_driver_id FROM expenses WHERE id = 'e1'").get()).toEqual({
      paid_by_driver_id: null,
    });
  });

  test('deleting a car deletes its backfill records', () => {
    db.run(
      "INSERT INTO driver_backfills (id, vehicle_id, mode, entries) VALUES ('b1', 'v1', 'logged', '[]')"
    );
    db.run("DELETE FROM vehicles WHERE id = 'v1'");
    expect(db.query('SELECT count(*) AS n FROM driver_backfills').get()).toEqual({ n: 0 });
  });
});
