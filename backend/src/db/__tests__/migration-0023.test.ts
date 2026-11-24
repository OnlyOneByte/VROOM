import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0023: term vehicle positions keep the order the vehicles were chosen in', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 22);
    seedCoreData(db);
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v0', 'u1', 'A', 'A', 2020), ('v9', 'u1', 'B', 'B', 2020)"
    );
    db.run(
      "INSERT INTO insurance_policies (id, user_id, company, is_active) VALUES ('p1', 'u1', 'Acme', 1)"
    );
    db.run(
      "INSERT INTO insurance_terms (id, policy_id, start_date, end_date) VALUES ('t1', 'p1', 1, 2), ('t2', 'p1', 3, 4)"
    );
    for (const [term, vehicle] of [
      ['t1', 'v9'],
      ['t1', 'v0'],
      ['t2', 'v1'],
      ['t1', 'v1'],
    ]) {
      db.run('INSERT INTO insurance_term_vehicles (term_id, vehicle_id) VALUES (?, ?)', [
        term,
        vehicle,
      ]);
    }
  });

  afterEach(() => {
    db.close();
  });

  test('ordering by position reads back exactly the old rowid order', () => {
    const before = db
      .query('SELECT term_id, vehicle_id FROM insurance_term_vehicles ORDER BY rowid')
      .all();
    applyMigration(db, migrations[23]);
    const after = db
      .query('SELECT term_id, vehicle_id FROM insurance_term_vehicles ORDER BY position')
      .all();
    expect(after).toEqual(before);
    const positions = db
      .query('SELECT position FROM insurance_term_vehicles ORDER BY position')
      .all();
    expect(new Set(positions.map((p) => (p as { position: number }).position)).size).toBe(4);
  });
});
