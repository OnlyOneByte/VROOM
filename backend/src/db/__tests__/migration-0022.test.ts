import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0022: insurance term vehicles get a position column', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigrationsUpTo(db, migrations, 21);
    seedCoreData(db);
    db.run(
      "INSERT INTO insurance_policies (id, user_id, company, is_active) VALUES ('p1', 'u1', 'Acme', 1)"
    );
    db.run(
      "INSERT INTO insurance_terms (id, policy_id, start_date, end_date) VALUES ('t1', 'p1', 1, 2)"
    );
    db.run("INSERT INTO insurance_term_vehicles (term_id, vehicle_id) VALUES ('t1', 'v1')");
  });

  afterEach(() => {
    db.close();
  });

  test('adds a NOT NULL position that existing rows read as 0', () => {
    applyMigration(db, migrations[22]);
    const column = (
      db
        .query(
          'SELECT name, "notnull", dflt_value FROM pragma_table_info(\'insurance_term_vehicles\')'
        )
        .all() as {
        name: string;
        notnull: number;
        dflt_value: string | null;
      }[]
    ).find((c) => c.name === 'position');
    expect(column).toEqual({ name: 'position', notnull: 1, dflt_value: '0' });
    expect(
      db.query('SELECT term_id, vehicle_id, position FROM insurance_term_vehicles').all()
    ).toEqual([{ term_id: 't1', vehicle_id: 'v1', position: 0 }]);
  });
});
