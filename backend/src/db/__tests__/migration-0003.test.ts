/**
 * Migration 0003: Expense Groups & Term Vehicle Coverage
 *
 * Creates `expense_groups` table, rebuilds `insurance_policy_vehicles`
 * with `(policy_id, term_id, vehicle_id)` composite PK, and adds
 * `expense_group_id` FK on `expenses`.
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

describe('Migration 0003: Expense Groups & Term Vehicle Coverage', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('creates expense_groups table', () => {
    applyMigrationsUpTo(db, migrations, 3);

    const tables = getTables(db);
    expect(tables).toContain('expense_groups');
  });

  test('expense_groups table has all expected columns', () => {
    applyMigrationsUpTo(db, migrations, 3);

    const cols = getColumnNames(db, 'expense_groups');
    const expected = [
      'id',
      'user_id',
      'split_config',
      'category',
      'tags',
      'date',
      'description',
      'total_amount',
      'insurance_policy_id',
      'insurance_term_id',
      'created_at',
      'updated_at',
    ];
    for (const col of expected) {
      expect(cols).toContain(col);
    }
  });

  test('expenses table has expense_group_id column after migration', () => {
    applyMigrationsUpTo(db, migrations, 3);

    const cols = getColumnNames(db, 'expenses');
    expect(cols).toContain('expense_group_id');
  });

  test('insurance_policy_vehicles has term_id column after migration', () => {
    applyMigrationsUpTo(db, migrations, 3);

    const cols = getColumnNames(db, 'insurance_policy_vehicles');
    expect(cols).toContain('term_id');
  });

  test('insurance_policy_vehicles columns include policy_id, term_id, vehicle_id', () => {
    applyMigrationsUpTo(db, migrations, 3);

    const cols = getColumnNames(db, 'insurance_policy_vehicles');
    expect(cols).toContain('policy_id');
    expect(cols).toContain('term_id');
    expect(cols).toContain('vehicle_id');
  });

  test('seed data survives this migration', () => {
    applyMigrationsUpTo(db, migrations, 2);
    seedCoreData(db);

    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    applyMigration(db, migrations[3]);

    expect(countRows(db, 'users')).toBe(1);
    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    const user = db.query("SELECT * FROM users WHERE id = 'u1'").get() as { email: string };
    expect(user.email).toBe('test@example.com');

    const expense = db.query("SELECT * FROM expenses WHERE id = 'e1'").get() as {
      expense_amount: number;
      expense_group_id: string | null;
    };
    expect(expense.expense_amount).toBe(45.5);
    expect(expense.expense_group_id).toBeNull();
  });

  test('expense_group_id FK constraint prevents deleting a group with children', () => {
    applyMigrationsUpTo(db, migrations, 3);

    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test User', 'google', 'gid-123')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
    );
    db.run(
      'INSERT INTO expense_groups (id, user_id, split_config, category, date, total_amount) VALUES (\'eg1\', \'u1\', \'{"method":"even","vehicleIds":["v1"]}\', \'financial\', 1700000000, 100.00)'
    );
    db.run(
      "INSERT INTO expenses (id, vehicle_id, category, date, expense_amount, expense_group_id) VALUES ('e1', 'v1', 'financial', 1700000000, 100.00, 'eg1')"
    );

    expect(countRows(db, 'expense_groups')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    // SQLite ALTER TABLE ADD COLUMN doesn't support ON DELETE CASCADE,
    // so the FK blocks parent deletion. Drizzle ORM handles cascade at
    // the application level; the raw migration enforces referential integrity.
    expect(() => {
      db.run("DELETE FROM expense_groups WHERE id = 'eg1'");
    }).toThrow();

    // Deleting children first, then the group works
    db.run("DELETE FROM expenses WHERE expense_group_id = 'eg1'");
    db.run("DELETE FROM expense_groups WHERE id = 'eg1'");

    expect(countRows(db, 'expense_groups')).toBe(0);
    expect(countRows(db, 'expenses')).toBe(0);
  });

  test('expense_group_id FK enforces referential integrity', () => {
    applyMigrationsUpTo(db, migrations, 3);

    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test User', 'google', 'gid-123')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
    );

    // Inserting an expense with a non-existent expense_group_id should fail
    expect(() => {
      db.run(
        "INSERT INTO expenses (id, vehicle_id, category, date, expense_amount, expense_group_id) VALUES ('e1', 'v1', 'financial', 1700000000, 100.00, 'nonexistent')"
      );
    }).toThrow();
  });

  test('insurance_policy_vehicles accepts rows with composite key (policy_id, term_id, vehicle_id)', () => {
    applyMigrationsUpTo(db, migrations, 3);

    db.run(
      "INSERT INTO users (id, email, display_name, provider, provider_id) VALUES ('u1', 'test@example.com', 'Test User', 'google', 'gid-123')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v2', 'u1', 'Honda', 'Civic', 2023)"
    );
    db.run(
      "INSERT INTO insurance_policies (id, company, terms) VALUES ('ip1', 'State Farm', '[]')"
    );

    db.run(
      "INSERT INTO insurance_policy_vehicles (policy_id, term_id, vehicle_id) VALUES ('ip1', 'term-1', 'v1')"
    );
    db.run(
      "INSERT INTO insurance_policy_vehicles (policy_id, term_id, vehicle_id) VALUES ('ip1', 'term-1', 'v2')"
    );
    db.run(
      "INSERT INTO insurance_policy_vehicles (policy_id, term_id, vehicle_id) VALUES ('ip1', 'term-2', 'v1')"
    );

    expect(countRows(db, 'insurance_policy_vehicles')).toBe(3);

    // Duplicate composite key should fail
    expect(() => {
      db.run(
        "INSERT INTO insurance_policy_vehicles (policy_id, term_id, vehicle_id) VALUES ('ip1', 'term-1', 'v1')"
      );
    }).toThrow();
  });
});
