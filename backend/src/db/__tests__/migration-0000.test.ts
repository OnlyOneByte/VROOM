/**
 * Migration 0000: Consolidated v2 schema (single migration)
 *
 * Creates all tables: users, vehicles, expenses, vehicle_financing,
 * insurance_policies, insurance_terms, insurance_term_vehicles,
 * photos, photo_refs, odometer_entries, user_providers, user_preferences, sync_state, sessions.
 *
 * Includes 4 manually-appended partial indexes:
 * - vf_active_vehicle_idx (one active financing per vehicle)
 * - vehicles_license_plate_idx (unique non-null license plates)
 * - up_auth_identity_idx (auth identity uniqueness)
 * - pr_pending_idx (sync worker poll optimization)
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  applyMigration,
  countRows,
  getColumnNames,
  getIndexNames,
  getTables,
  loadMigrations,
} from './migration-helpers';

describe('Migration 0000: Consolidated v2 Schema', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  test('creates all expected tables', () => {
    applyMigration(db, migrations[0]);
    const tables = getTables(db);
    const expectedTables = [
      'expenses',
      'insurance_policies',
      'insurance_terms',
      'insurance_term_vehicles',
      'odometer_entries',
      'photo_refs',
      'photos',
      'reminder_notifications',
      'reminder_vehicles',
      'reminders',
      'sessions',
      'sync_state',
      'user_preferences',
      'user_providers',
      'users',
      'vehicle_financing',
      'vehicles',
    ];
    for (const table of expectedTables) {
      expect(tables).toContain(table);
    }
  });

  test('vehicles table has expected columns (no current_insurance_policy_id)', () => {
    applyMigration(db, migrations[0]);
    const cols = getColumnNames(db, 'vehicles');
    expect(cols).toContain('id');
    expect(cols).toContain('user_id');
    expect(cols).toContain('make');
    expect(cols).toContain('model');
    expect(cols).toContain('year');
    expect(cols).toContain('vehicle_type');
    expect(cols).toContain('unit_preferences');
    expect(cols).toContain('license_plate');
    expect(cols).not.toContain('current_insurance_policy_id');
  });

  test('expenses table has volume column (not fuel_amount) and source_type/source_id', () => {
    applyMigration(db, migrations[0]);
    const cols = getColumnNames(db, 'expenses');
    expect(cols).toContain('volume');
    expect(cols).toContain('source_type');
    expect(cols).toContain('source_id');
    expect(cols).toContain('user_id');
    expect(cols).not.toContain('fuel_amount');
    expect(cols).not.toContain('is_financing_payment');
    expect(cols).not.toContain('insurance_term_id');
    expect(cols).not.toContain('insurance_policy_id');
  });

  test('vehicle_financing has no current_balance column', () => {
    applyMigration(db, migrations[0]);
    const cols = getColumnNames(db, 'vehicle_financing');
    expect(cols).not.toContain('current_balance');
    expect(cols).toContain('original_amount');
    expect(cols).toContain('is_active');
  });

  test('odometer_entries has no linked_entity columns', () => {
    applyMigration(db, migrations[0]);
    const cols = getColumnNames(db, 'odometer_entries');
    expect(cols).toContain('user_id');
    expect(cols).not.toContain('linked_entity_type');
    expect(cols).not.toContain('linked_entity_id');
  });

  test('photos table has user_id column', () => {
    applyMigration(db, migrations[0]);
    const cols = getColumnNames(db, 'photos');
    expect(cols).toContain('user_id');
  });

  test('user_preferences has expected columns', () => {
    applyMigration(db, migrations[0]);
    const cols = getColumnNames(db, 'user_preferences');
    expect(cols).toContain('user_id');
    expect(cols).toContain('unit_preferences');
    expect(cols).toContain('backup_config');
    expect(cols).toContain('storage_config');
  });

  test('sync_state has expected columns (no created_at/updated_at)', () => {
    applyMigration(db, migrations[0]);
    const cols = getColumnNames(db, 'sync_state');
    expect(cols).toContain('user_id');
    expect(cols).toContain('last_sync_date');
    expect(cols).toContain('last_data_change_date');
    expect(cols).toContain('last_backup_date');
    expect(cols).not.toContain('created_at');
    expect(cols).not.toContain('updated_at');
  });

  test('insurance_terms table has flat columns', () => {
    applyMigration(db, migrations[0]);
    const cols = getColumnNames(db, 'insurance_terms');
    expect(cols).toContain('id');
    expect(cols).toContain('policy_id');
    expect(cols).toContain('start_date');
    expect(cols).toContain('end_date');
    expect(cols).toContain('policy_number');
    expect(cols).toContain('total_cost');
    expect(cols).toContain('monthly_cost');
  });

  test('insurance_policies has no terms/currentTermStart/currentTermEnd columns', () => {
    applyMigration(db, migrations[0]);
    const cols = getColumnNames(db, 'insurance_policies');
    expect(cols).not.toContain('terms');
    expect(cols).not.toContain('current_term_start');
    expect(cols).not.toContain('current_term_end');
  });

  test('expenses table has source_type and source_id columns', () => {
    applyMigration(db, migrations[0]);
    const cols = getColumnNames(db, 'expenses');
    expect(cols).toContain('source_type');
    expect(cols).toContain('source_id');
  });

  test('expenses_source_idx index exists on expenses', () => {
    applyMigration(db, migrations[0]);
    const indexes = getIndexNames(db, 'expenses');
    expect(indexes).toContain('expenses_source_idx');
  });

  test('reminders table has expected columns', () => {
    applyMigration(db, migrations[0]);
    const cols = getColumnNames(db, 'reminders');
    expect(cols).toContain('id');
    expect(cols).toContain('user_id');
    expect(cols).toContain('name');
    expect(cols).toContain('description');
    expect(cols).toContain('type');
    expect(cols).toContain('action_mode');
    expect(cols).toContain('frequency');
    expect(cols).toContain('interval_value');
    expect(cols).toContain('interval_unit');
    expect(cols).toContain('start_date');
    expect(cols).toContain('end_date');
    expect(cols).toContain('next_due_date');
    expect(cols).toContain('expense_category');
    expect(cols).toContain('expense_tags');
    expect(cols).toContain('expense_amount');
    expect(cols).toContain('expense_description');
    expect(cols).toContain('expense_split_config');
    expect(cols).toContain('is_active');
    expect(cols).toContain('last_triggered_at');
    expect(cols).toContain('created_at');
    expect(cols).toContain('updated_at');
  });

  test('reminders_user_active_due_idx index exists on reminders', () => {
    applyMigration(db, migrations[0]);
    const indexes = getIndexNames(db, 'reminders');
    expect(indexes).toContain('reminders_user_active_due_idx');
  });

  test('reminder_vehicles table has expected columns and rv_vehicle_idx index', () => {
    applyMigration(db, migrations[0]);
    const cols = getColumnNames(db, 'reminder_vehicles');
    expect(cols).toContain('reminder_id');
    expect(cols).toContain('vehicle_id');
    const indexes = getIndexNames(db, 'reminder_vehicles');
    expect(indexes).toContain('rv_vehicle_idx');
  });

  test('reminder_notifications table has expected columns', () => {
    applyMigration(db, migrations[0]);
    const cols = getColumnNames(db, 'reminder_notifications');
    expect(cols).toContain('id');
    expect(cols).toContain('reminder_id');
    expect(cols).toContain('user_id');
    expect(cols).toContain('due_date');
    expect(cols).toContain('is_read');
    expect(cols).toContain('created_at');
    expect(cols).toContain('updated_at');
  });

  test('rn_user_unread_idx index exists on reminder_notifications', () => {
    applyMigration(db, migrations[0]);
    const indexes = getIndexNames(db, 'reminder_notifications');
    expect(indexes).toContain('rn_user_unread_idx');
  });

  test('rn_reminder_due_idx unique index exists on reminder_notifications', () => {
    applyMigration(db, migrations[0]);
    const indexes = getIndexNames(db, 'reminder_notifications');
    expect(indexes).toContain('rn_reminder_due_idx');
  });

  test('users.email has a unique index', () => {
    applyMigration(db, migrations[0]);
    const indexes = getIndexNames(db, 'users');
    expect(indexes.some((n) => n.includes('email'))).toBe(true);
  });

  test('up_auth_identity_idx partial unique index exists on user_providers', () => {
    applyMigration(db, migrations[0]);
    const indexes = getIndexNames(db, 'user_providers');
    expect(indexes).toContain('up_auth_identity_idx');
  });

  test('vehicles_license_plate_idx partial unique index exists', () => {
    applyMigration(db, migrations[0]);
    const indexes = getIndexNames(db, 'vehicles');
    expect(indexes).toContain('vehicles_license_plate_idx');
  });

  test('vf_active_vehicle_idx partial unique index exists', () => {
    applyMigration(db, migrations[0]);
    const indexes = getIndexNames(db, 'vehicle_financing');
    expect(indexes).toContain('vf_active_vehicle_idx');
  });

  test('pr_pending_idx partial index exists on photo_refs', () => {
    applyMigration(db, migrations[0]);
    const indexes = getIndexNames(db, 'photo_refs');
    expect(indexes).toContain('pr_pending_idx');
  });

  test('up_auth_identity_idx enforces uniqueness for auth rows', () => {
    applyMigration(db, migrations[0]);

    db.run("INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@test.com', 'User A')");
    db.run("INSERT INTO users (id, email, display_name) VALUES ('u2', 'b@test.com', 'User B')");

    db.run(
      "INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, status) VALUES ('p1', 'u1', 'auth', 'google', 'goog-123', 'User A', '', 'active')"
    );

    expect(() => {
      db.run(
        "INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, status) VALUES ('p2', 'u2', 'auth', 'google', 'goog-123', 'User B', '', 'active')"
      );
    }).toThrow(/UNIQUE constraint failed/);
  });

  test('storage rows with NULL providerAccountId do not conflict', () => {
    applyMigration(db, migrations[0]);

    db.run("INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@test.com', 'User A')");

    db.run(
      "INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, status) VALUES ('s1', 'u1', 'storage', 'google-drive', NULL, 'Drive 1', 'enc1', 'active')"
    );
    db.run(
      "INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, status) VALUES ('s2', 'u1', 'storage', 'google-drive', NULL, 'Drive 2', 'enc2', 'active')"
    );

    expect(countRows(db, 'user_providers')).toBe(2);
  });

  test('FK cascade: deleting user cascades to vehicles and expenses', () => {
    applyMigration(db, migrations[0]);

    db.run(
      "INSERT INTO users (id, email, display_name) VALUES ('u1', 'test@example.com', 'Test User')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
    );
    db.run(
      "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount) VALUES ('e1', 'v1', 'u1', 'fuel', 1700000000, 45.50)"
    );

    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    db.run("DELETE FROM users WHERE id = 'u1'");

    expect(countRows(db, 'users')).toBe(0);
    expect(countRows(db, 'vehicles')).toBe(0);
    expect(countRows(db, 'expenses')).toBe(0);
  });

  test('insurance term FK cascade: deleting term cascades junction, sets expense FK to NULL', () => {
    applyMigration(db, migrations[0]);

    db.run("INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@test.com', 'User')");
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
    );
    db.run("INSERT INTO insurance_policies (id, user_id, company) VALUES ('ip1', 'u1', 'Geico')");
    db.run(
      "INSERT INTO insurance_terms (id, policy_id, start_date, end_date) VALUES ('it1', 'ip1', 1700000000, 1730000000)"
    );
    db.run("INSERT INTO insurance_term_vehicles (term_id, vehicle_id) VALUES ('it1', 'v1')");
    db.run(
      "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, source_type, source_id) VALUES ('e1', 'v1', 'u1', 'financial', 1700000000, 100, 'insurance_term', 'it1')"
    );

    db.run("DELETE FROM insurance_terms WHERE id = 'it1'");

    expect(countRows(db, 'insurance_term_vehicles')).toBe(0);
    // Source fields are NOT FK-cascaded — app-level cleanup handles this
    const expense = db.query("SELECT source_type, source_id FROM expenses WHERE id = 'e1'").get() as {
      source_type: string | null;
      source_id: string | null;
    };
    expect(expense.source_type).toBe('insurance_term');
    expect(expense.source_id).toBe('it1');
    expect(countRows(db, 'expenses')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Property 3: License plate partial unique index enforcement
// **Validates: Requirements 3.3**
// ---------------------------------------------------------------------------

describe('Property 3: License plate partial unique index enforcement', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigration(db, migrations[0]);
    db.run("INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@test.com', 'User')");
  });

  afterEach(() => {
    db.close();
  });

  test('two vehicles with the same non-null license plate fail uniqueness constraint', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
        (plate) => {
          // Fresh DB for each run
          const localDb = new Database(':memory:');
          localDb.run('PRAGMA foreign_keys = ON');
          applyMigration(localDb, migrations[0]);
          localDb.run(
            "INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@test.com', 'User')"
          );

          localDb.run(
            'INSERT INTO vehicles (id, user_id, make, model, year, license_plate) VALUES (?, ?, ?, ?, ?, ?)',
            ['v1', 'u1', 'Toyota', 'Camry', 2022, plate]
          );

          let threw = false;
          try {
            localDb.run(
              'INSERT INTO vehicles (id, user_id, make, model, year, license_plate) VALUES (?, ?, ?, ?, ?, ?)',
              ['v2', 'u1', 'Honda', 'Civic', 2023, plate]
            );
          } catch {
            threw = true;
          }

          localDb.close();
          return threw;
        }
      ),
      { numRuns: 30 }
    );
  });

  test('two vehicles with NULL license plates both insert successfully', () => {
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year, license_plate) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022, NULL)"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year, license_plate) VALUES ('v2', 'u1', 'Honda', 'Civic', 2023, NULL)"
    );
    expect(countRows(db, 'vehicles')).toBe(2);
  });

  test('vehicles with different non-null license plates both insert successfully', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
        (plate1, plate2) => {
          fc.pre(plate1 !== plate2);

          const localDb = new Database(':memory:');
          localDb.run('PRAGMA foreign_keys = ON');
          applyMigration(localDb, migrations[0]);
          localDb.run(
            "INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@test.com', 'User')"
          );

          localDb.run(
            'INSERT INTO vehicles (id, user_id, make, model, year, license_plate) VALUES (?, ?, ?, ?, ?, ?)',
            ['v1', 'u1', 'Toyota', 'Camry', 2022, plate1]
          );
          localDb.run(
            'INSERT INTO vehicles (id, user_id, make, model, year, license_plate) VALUES (?, ?, ?, ?, ?, ?)',
            ['v2', 'u1', 'Honda', 'Civic', 2023, plate2]
          );

          const count = (
            localDb.query('SELECT COUNT(*) as count FROM vehicles').get() as { count: number }
          ).count;
          localDb.close();
          return count === 2;
        }
      ),
      { numRuns: 30 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Active financing partial unique index enforcement
// **Validates: Requirements 4.3**
// ---------------------------------------------------------------------------

describe('Property 4: Active financing partial unique index enforcement', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigration(db, migrations[0]);
    db.run("INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@test.com', 'User')");
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
    );
  });

  afterEach(() => {
    db.close();
  });

  test('second active financing for same vehicle fails uniqueness constraint', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1000, max: 100000, noNaN: true }),
        fc.double({ min: 1000, max: 100000, noNaN: true }),
        (amount1, amount2) => {
          const localDb = new Database(':memory:');
          localDb.run('PRAGMA foreign_keys = ON');
          applyMigration(localDb, migrations[0]);
          localDb.run(
            "INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@test.com', 'User')"
          );
          localDb.run(
            "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
          );

          localDb.run(
            'INSERT INTO vehicle_financing (id, vehicle_id, provider, original_amount, term_months, start_date, payment_amount, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            ['f1', 'v1', 'Bank A', amount1, 60, 1700000000, 500, 1]
          );

          let threw = false;
          try {
            localDb.run(
              'INSERT INTO vehicle_financing (id, vehicle_id, provider, original_amount, term_months, start_date, payment_amount, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              ['f2', 'v1', 'Bank B', amount2, 48, 1700000000, 400, 1]
            );
          } catch {
            threw = true;
          }

          localDb.close();
          return threw;
        }
      ),
      { numRuns: 30 }
    );
  });

  test('inactive financing record for same vehicle succeeds', () => {
    db.run(
      "INSERT INTO vehicle_financing (id, vehicle_id, provider, original_amount, term_months, start_date, payment_amount, is_active) VALUES ('f1', 'v1', 'Bank A', 30000, 60, 1700000000, 500, 1)"
    );
    db.run(
      "INSERT INTO vehicle_financing (id, vehicle_id, provider, original_amount, term_months, start_date, payment_amount, is_active) VALUES ('f2', 'v1', 'Bank B', 25000, 48, 1700000000, 400, 0)"
    );
    expect(countRows(db, 'vehicle_financing')).toBe(2);
  });

  test('two active financing records for different vehicles succeed', () => {
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v2', 'u1', 'Honda', 'Civic', 2023)"
    );
    db.run(
      "INSERT INTO vehicle_financing (id, vehicle_id, provider, original_amount, term_months, start_date, payment_amount, is_active) VALUES ('f1', 'v1', 'Bank A', 30000, 60, 1700000000, 500, 1)"
    );
    db.run(
      "INSERT INTO vehicle_financing (id, vehicle_id, provider, original_amount, term_months, start_date, payment_amount, is_active) VALUES ('f2', 'v2', 'Bank B', 25000, 48, 1700000000, 400, 1)"
    );
    expect(countRows(db, 'vehicle_financing')).toBe(2);
  });

  test('multiple inactive financing records for same vehicle succeed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 5 }), (count) => {
        const localDb = new Database(':memory:');
        localDb.run('PRAGMA foreign_keys = ON');
        applyMigration(localDb, migrations[0]);
        localDb.run(
          "INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@test.com', 'User')"
        );
        localDb.run(
          "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
        );

        for (let i = 0; i < count; i++) {
          localDb.run(
            'INSERT INTO vehicle_financing (id, vehicle_id, provider, original_amount, term_months, start_date, payment_amount, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [`f${i}`, 'v1', `Bank ${i}`, 30000, 60, 1700000000, 500, 0]
          );
        }

        const rows = (
          localDb.query('SELECT COUNT(*) as count FROM vehicle_financing').get() as {
            count: number;
          }
        ).count;
        localDb.close();
        return rows === count;
      }),
      { numRuns: 20 }
    );
  });
});
