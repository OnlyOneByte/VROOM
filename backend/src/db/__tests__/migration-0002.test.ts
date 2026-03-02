/**
 * Migration 0002: Insurance schema overhaul
 *
 * - Creates `insurance_policy_vehicles` junction table with composite PK and cascade deletes
 * - Replaces `insurance_policies` table with new column set (company, is_active, terms JSON, etc.)
 * - Adds `current_insurance_policy_id` to `vehicles`
 * - Adds `insurance_policy_id`, `insurance_term_id`, and `missed_fillup` to `expenses`
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  getColumnNames,
  getTables,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0002: Insurance Schema Overhaul', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('creates insurance_policy_vehicles junction table', () => {
    applyMigrationsUpTo(db, migrations, 2);

    const tables = getTables(db);
    expect(tables).toContain('insurance_policy_vehicles');
  });

  test('insurance_policy_vehicles has correct columns', () => {
    applyMigrationsUpTo(db, migrations, 2);

    const cols = getColumnNames(db, 'insurance_policy_vehicles');
    expect(cols).toContain('policy_id');
    expect(cols).toContain('vehicle_id');
    expect(cols).toHaveLength(2);
  });

  test('insurance_policy_vehicles has composite primary key', () => {
    applyMigrationsUpTo(db, migrations, 2);

    // Insert a policy and vehicle first
    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test User', 'google', 'gid-123')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
    );
    db.run(
      "INSERT INTO insurance_policies (id, company, is_active, terms) VALUES ('ip1', 'State Farm', 1, '[]')"
    );

    // First insert should succeed
    db.run("INSERT INTO insurance_policy_vehicles (policy_id, vehicle_id) VALUES ('ip1', 'v1')");
    expect(countRows(db, 'insurance_policy_vehicles')).toBe(1);

    // Duplicate insert should fail (composite PK constraint)
    expect(() => {
      db.run("INSERT INTO insurance_policy_vehicles (policy_id, vehicle_id) VALUES ('ip1', 'v1')");
    }).toThrow();
  });

  test('insurance_policies table has correct columns after migration', () => {
    applyMigrationsUpTo(db, migrations, 2);

    const cols = getColumnNames(db, 'insurance_policies');
    const expectedCols = [
      'id',
      'company',
      'is_active',
      'current_term_start',
      'current_term_end',
      'terms',
      'notes',
      'created_at',
      'updated_at',
    ];
    for (const col of expectedCols) {
      expect(cols).toContain(col);
    }
    // Old columns like vehicle_id, policy_number should be gone
    expect(cols).not.toContain('vehicle_id');
    expect(cols).not.toContain('policy_number');
    expect(cols).not.toContain('provider');
    expect(cols).not.toContain('premium_amount');
    expect(cols).not.toContain('coverage_type');
  });

  test('vehicles table has current_insurance_policy_id column', () => {
    applyMigrationsUpTo(db, migrations, 2);

    const cols = getColumnNames(db, 'vehicles');
    expect(cols).toContain('current_insurance_policy_id');
  });

  test('expenses table has insurance_policy_id column', () => {
    applyMigrationsUpTo(db, migrations, 2);

    const cols = getColumnNames(db, 'expenses');
    expect(cols).toContain('insurance_policy_id');
  });

  test('expenses table has insurance_term_id column', () => {
    applyMigrationsUpTo(db, migrations, 2);

    const cols = getColumnNames(db, 'expenses');
    expect(cols).toContain('insurance_term_id');
  });

  test('expenses table has missed_fillup column', () => {
    applyMigrationsUpTo(db, migrations, 2);

    const cols = getColumnNames(db, 'expenses');
    expect(cols).toContain('missed_fillup');
  });

  test('seed data survives the migration', () => {
    applyMigrationsUpTo(db, migrations, 1);
    seedCoreData(db);

    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    // Apply migration 0002
    applyMigration(db, migrations[2]);

    // All seed data must survive
    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    // Verify data integrity
    const user = db.query("SELECT * FROM users WHERE id = 'u1'").get() as { email: string };
    expect(user.email).toBe('test@example.com');

    const vehicle = db.query("SELECT * FROM vehicles WHERE id = 'v1'").get() as {
      make: string;
      model: string;
    };
    expect(vehicle.make).toBe('Toyota');
    expect(vehicle.model).toBe('Camry');

    const expense = db.query("SELECT * FROM expenses WHERE id = 'e1'").get() as {
      expense_amount: number;
    };
    expect(expense.expense_amount).toBe(45.5);

    // New junction table should be empty but functional
    expect(countRows(db, 'insurance_policy_vehicles')).toBe(0);
  });

  test('FK cascade: deleting a vehicle cascades to junction table', () => {
    applyMigrationsUpTo(db, migrations, 2);

    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test User', 'google', 'gid-123')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
    );
    db.run(
      "INSERT INTO insurance_policies (id, company, is_active, terms) VALUES ('ip1', 'State Farm', 1, '[]')"
    );
    db.run("INSERT INTO insurance_policy_vehicles (policy_id, vehicle_id) VALUES ('ip1', 'v1')");

    expect(countRows(db, 'insurance_policy_vehicles')).toBe(1);

    db.run("DELETE FROM vehicles WHERE id = 'v1'");

    expect(countRows(db, 'insurance_policy_vehicles')).toBe(0);
    // Policy itself should still exist
    expect(countRows(db, 'insurance_policies')).toBe(1);
  });

  test('FK cascade: deleting a policy cascades to junction table', () => {
    applyMigrationsUpTo(db, migrations, 2);

    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test User', 'google', 'gid-123')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
    );
    db.run(
      "INSERT INTO insurance_policies (id, company, is_active, terms) VALUES ('ip1', 'State Farm', 1, '[]')"
    );
    db.run("INSERT INTO insurance_policy_vehicles (policy_id, vehicle_id) VALUES ('ip1', 'v1')");

    expect(countRows(db, 'insurance_policy_vehicles')).toBe(1);

    db.run("DELETE FROM insurance_policies WHERE id = 'ip1'");

    expect(countRows(db, 'insurance_policy_vehicles')).toBe(0);
    // Vehicle should still exist
    expect(countRows(db, 'vehicles')).toBe(1);
  });

  test('missed_fillup defaults to false (0)', () => {
    applyMigrationsUpTo(db, migrations, 2);
    seedCoreData(db);

    const expense = db.query("SELECT missed_fillup FROM expenses WHERE id = 'e1'").get() as {
      missed_fillup: number;
    };
    expect(expense.missed_fillup).toBe(0);
  });

  test('insurance_policy_id and insurance_term_id default to null on expenses', () => {
    applyMigrationsUpTo(db, migrations, 2);
    seedCoreData(db);

    const expense = db
      .query("SELECT insurance_policy_id, insurance_term_id FROM expenses WHERE id = 'e1'")
      .get() as { insurance_policy_id: string | null; insurance_term_id: string | null };
    expect(expense.insurance_policy_id).toBeNull();
    expect(expense.insurance_term_id).toBeNull();
  });
});
