/**
 * Migration 0002: Insurance claims
 *
 * Adds:
 * - insurance_claims table (FK policy_id → insurance_policies ON DELETE cascade,
 *   term_id → insurance_terms ON DELETE set null, vehicle_id → vehicles ON DELETE
 *   set null)
 * - indexes: ic_policy_id_idx, ic_policy_status_idx, ic_vehicle_idx
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  getColumnNames,
  getIndexNames,
  getTables,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0002: Insurance claims', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('creates the insurance_claims table with the expected columns', () => {
    applyMigrationsUpTo(db, migrations, 2);
    expect(getTables(db)).toContain('insurance_claims');
    const cols = getColumnNames(db, 'insurance_claims');
    for (const c of [
      'id',
      'policy_id',
      'term_id',
      'vehicle_id',
      'claim_date',
      'claim_type',
      'description',
      'status',
      'payout_amount',
      'fault_designation',
      'created_at',
      'updated_at',
    ]) {
      expect(cols).toContain(c);
    }
  });

  test('creates the claim indexes', () => {
    applyMigrationsUpTo(db, migrations, 2);
    const idx = getIndexNames(db, 'insurance_claims');
    expect(idx).toContain('ic_policy_id_idx');
    expect(idx).toContain('ic_policy_status_idx');
    expect(idx).toContain('ic_vehicle_idx');
  });

  test('seed data survives this migration', () => {
    applyMigrationsUpTo(db, migrations, 1);
    seedCoreData(db);
    expect(countRows(db, 'users')).toBe(1);

    applyMigration(db, migrations[2]);
    expect(countRows(db, 'users')).toBe(1);
  });

  test('deleting a policy cascades its claims; status defaults to filed', () => {
    applyMigrationsUpTo(db, migrations, 2);
    seedCoreData(db);
    const user = db.query('SELECT id FROM users LIMIT 1').get() as { id: string };

    db.run(`INSERT INTO insurance_policies (id, user_id, company) VALUES ('p1', ?, 'Acme')`, [
      user.id,
    ]);
    // No explicit status → DB default 'filed'.
    db.run(
      `INSERT INTO insurance_claims (id, policy_id, claim_date, claim_type) VALUES ('c1', 'p1', 0, 'collision')`
    );
    const row = db.query(`SELECT status FROM insurance_claims WHERE id = 'c1'`).get() as {
      status: string;
    };
    expect(row.status).toBe('filed');
    expect(countRows(db, 'insurance_claims')).toBe(1);

    // Cascade: deleting the policy removes its claims.
    db.run(`DELETE FROM insurance_policies WHERE id = 'p1'`);
    expect(countRows(db, 'insurance_claims')).toBe(0);
  });
});
