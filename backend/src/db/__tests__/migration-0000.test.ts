/**
 * Migration 0000: the collapsed baseline — the whole schema in one file.
 *
 * The fourteen incremental migrations this replaces are gone; `docs/architecture.md` records the
 * break. What matters here is that the baseline lands on the EXACT schema `schema.ts` declares,
 * because a regenerated baseline is only as good as its diff against what shipped before.
 *
 * The index inventory below is asserted as SET EQUALITY, not `toContain`, and that is the point.
 * Four of the eight partial indexes only ever existed as hand-written SQL appended to a migration —
 * absent from `schema.ts`, therefore invisible to `drizzle-kit generate`, therefore silently
 * dropped by exactly the regenerate that produced this file. Three of them (`pr_pending_idx`,
 * `up_auth_identity_idx`, `vf_active_vehicle_idx`) were in fact lost and restored by hand before
 * this landed. Set equality is what makes the next such loss loud: a `toContain` wall grows a hole
 * the moment someone deletes the matching line, while a missing key fails here with its own name.
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

/** Every table the baseline creates. Set-compared, so an addition or a drop must be deliberate. */
const EXPECTED_TABLES = [
  'expenses',
  'insurance_claims',
  'insurance_policies',
  'insurance_term_vehicles',
  'insurance_terms',
  'odometer_entries',
  'photo_refs',
  'photos',
  'push_subscriptions',
  'reminder_notifications',
  'reminder_vehicles',
  'reminders',
  'sessions',
  'sync_state',
  'trips',
  'user_preferences',
  'user_providers',
  'users',
  'vehicle_financing',
  'vehicle_shares',
  'vehicles',
];

/**
 * Every explicit index, per table. The eight PARTIAL ones are the fragile population — each
 * encodes a uniqueness rule the application relies on and cannot restate, so losing one converts a
 * hard database constraint into silent data corruption:
 *
 *  - `expenses_user_client_idx`     offline-sync idempotency: one row per (user, client_id)
 *  - `rn_reminder_odo_idx`          one notification per (reminder, due_odometer)
 *  - `up_auth_identity_idx`         one auth identity per external account
 *  - `vehicle_shares_active_idx`    one live invite per (vehicle, invitee)
 *  - `vehicles_user_license_plate_idx`  one plate per user, NULLs exempt
 *  - `vf_active_vehicle_idx`        one ACTIVE financing per vehicle
 *  - `pr_pending_idx`               (non-unique) keeps the retry sweep off the `active` majority
 *  - `ps_user_endpoint_idx`         one subscription per (user, endpoint)
 */
const EXPECTED_INDEXES: Record<string, string[]> = {
  expenses: [
    'expenses_category_date_idx',
    'expenses_group_idx',
    'expenses_source_idx',
    'expenses_user_category_date_idx',
    'expenses_user_client_idx',
    'expenses_user_date_idx',
    'expenses_vehicle_category_date_idx',
    'expenses_vehicle_date_idx',
  ],
  insurance_claims: ['ic_policy_id_idx', 'ic_policy_status_idx', 'ic_vehicle_idx'],
  insurance_policies: ['insurance_policies_user_id_idx'],
  insurance_term_vehicles: ['itv_vehicle_idx'],
  insurance_terms: ['it_policy_end_date_idx', 'it_policy_id_idx'],
  odometer_entries: ['odometer_vehicle_date_idx'],
  photo_refs: ['pr_pending_idx', 'pr_photo_provider_idx'],
  photos: ['photos_entity_idx', 'photos_user_entity_type_idx'],
  push_subscriptions: ['ps_user_endpoint_idx', 'ps_user_idx'],
  reminder_notifications: ['rn_reminder_due_idx', 'rn_reminder_odo_idx', 'rn_user_unread_idx'],
  reminder_vehicles: ['rv_vehicle_idx'],
  reminders: ['reminders_user_active_due_idx'],
  trips: ['trips_vehicle_date_idx'],
  user_providers: ['up_auth_identity_idx', 'up_user_domain_idx'],
  users: ['users_email_unique'],
  vehicle_financing: ['vf_active_vehicle_idx', 'vf_vehicle_id_idx'],
  vehicle_shares: [
    'vehicle_shares_active_idx',
    'vehicle_shares_owner_idx',
    'vehicle_shares_shared_with_idx',
  ],
  vehicles: ['vehicles_user_id_idx', 'vehicles_user_license_plate_idx'],
};

/** Money is stored as integer CENTS everywhere. Float dollars round-trip wrong; see `money.ts`. */
const MONEY_COLUMNS: Record<string, string[]> = {
  expenses: ['expense_amount', 'group_total'],
  insurance_claims: ['payout_amount'],
  insurance_terms: [
    'coverage_limit',
    'deductible_amount',
    'monthly_cost',
    'payment_amount',
    'total_cost',
  ],
  reminders: ['expense_amount'],
  vehicle_financing: ['excess_mileage_fee', 'original_amount', 'payment_amount', 'residual_value'],
  vehicles: ['purchase_price'],
};

describe('Migration 0000: collapsed baseline schema', () => {
  let db: Database;
  const migrations = loadMigrations();

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
    applyMigration(db, migrations[0]);
  });

  afterEach(() => {
    db.close();
  });

  test('the baseline is the only migration', () => {
    // The collapse's defining property. A second file here means someone added a migration, which
    // is fine — but then `migration-general`'s journal guard must have been updated to match.
    expect(migrations.map((m) => m.tag)).toEqual(['0000_baseline']);
  });

  test('creates exactly the expected tables', () => {
    expect(getTables(db)).toEqual([...EXPECTED_TABLES].sort());
  });

  test('creates exactly the expected indexes, partial ones included', () => {
    const actual = Object.fromEntries(
      getTables(db)
        .map((table) => [table, getIndexNames(db, table).filter((n) => !n.startsWith('sqlite_'))])
        .filter(([, indexes]) => indexes.length > 0)
        .map(([table, indexes]) => [table, (indexes as string[]).sort()])
    );
    expect(actual).toEqual(
      Object.fromEntries(
        Object.entries(EXPECTED_INDEXES).map(([table, indexes]) => [table, [...indexes].sort()])
      )
    );
  });

  test('every partial index really is partial (a WHERE clause, not just the right name)', () => {
    // An index can keep its name and lose its predicate — a regenerate that drops the `.where()`
    // turns `vf_active_vehicle_idx` into a plain unique on vehicle_id, which rejects the SECOND
    // financing agreement a vehicle ever has rather than the second ACTIVE one.
    const partial = db
      .query<{ name: string; sql: string }, []>(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql LIKE '%WHERE%'"
      )
      .all()
      .map((row) => row.name)
      .sort();
    expect(partial).toEqual([
      'expenses_user_client_idx',
      'pr_pending_idx',
      'rn_reminder_odo_idx',
      'up_auth_identity_idx',
      'vehicle_shares_active_idx',
      'vehicles_user_license_plate_idx',
      'vf_active_vehicle_idx',
    ]);
  });

  test('every money column has INTEGER affinity (cents, not float dollars)', () => {
    // The chain this baseline replaces never got here: its money-to-cents migration rewrote the
    // VALUES with fourteen UPDATEs and left the declared types `real`, so the database disagreed
    // with `schema.ts` for the rest of its life. SQLite's loose typing hid it.
    const wrong: string[] = [];
    for (const [table, columns] of Object.entries(MONEY_COLUMNS)) {
      const info = db
        .query<{ name: string; type: string }, []>(`PRAGMA table_info('${table}')`)
        .all();
      for (const column of columns) {
        const found = info.find((c) => c.name === column);
        if (found?.type.toUpperCase() !== 'INTEGER') {
          wrong.push(`${table}.${column}: ${found?.type ?? 'MISSING'}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  test('vehicles carries the v2 column set (no current_insurance_policy_id)', () => {
    const cols = getColumnNames(db, 'vehicles');
    for (const column of [
      'id',
      'user_id',
      'make',
      'model',
      'year',
      'vehicle_type',
      'unit_preferences',
      'license_plate',
      'purchase_price',
    ]) {
      expect(cols).toContain(column);
    }
    expect(cols).not.toContain('current_insurance_policy_id');
  });

  test('expenses carries volume, the polymorphic source pair, and the late additions', () => {
    const cols = getColumnNames(db, 'expenses');
    for (const column of [
      'volume',
      'source_type',
      'source_id',
      'user_id',
      // Added by the migrations this baseline absorbed, so easy to lose in a regenerate.
      'client_id',
      'created_by',
      'location',
      'group_id',
      'group_total',
    ]) {
      expect(cols).toContain(column);
    }
    expect(cols).not.toContain('fuel_amount');
    expect(cols).not.toContain('is_financing_payment');
    expect(cols).not.toContain('insurance_term_id');
    expect(cols).not.toContain('insurance_policy_id');
  });

  test('vehicle_financing has no current_balance column', () => {
    const cols = getColumnNames(db, 'vehicle_financing');
    expect(cols).not.toContain('current_balance');
    expect(cols).toContain('original_amount');
    expect(cols).toContain('is_active');
  });

  test('odometer_entries has no linked_entity columns', () => {
    const cols = getColumnNames(db, 'odometer_entries');
    expect(cols).toContain('user_id');
    expect(cols).not.toContain('linked_entity_type');
    expect(cols).not.toContain('linked_entity_id');
  });

  test('photos table has user_id column', () => {
    expect(getColumnNames(db, 'photos')).toContain('user_id');
  });

  test('user_preferences carries the config blobs and both late scalar columns', () => {
    const cols = getColumnNames(db, 'user_preferences');
    for (const column of [
      'user_id',
      'unit_preferences',
      'backup_config',
      'storage_config',
      'theme_preference',
      'business_mileage_rate',
    ]) {
      expect(cols).toContain(column);
    }
  });

  test('sync_state has expected columns (no created_at/updated_at)', () => {
    const cols = getColumnNames(db, 'sync_state');
    for (const column of [
      'user_id',
      'last_sync_date',
      'last_data_change_date',
      'last_backup_date',
    ]) {
      expect(cols).toContain(column);
    }
    expect(cols).not.toContain('created_at');
    expect(cols).not.toContain('updated_at');
  });

  test('insurance_terms table has flat columns', () => {
    const cols = getColumnNames(db, 'insurance_terms');
    for (const column of [
      'id',
      'policy_id',
      'start_date',
      'end_date',
      'policy_number',
      'total_cost',
      'monthly_cost',
    ]) {
      expect(cols).toContain(column);
    }
  });

  test('insurance_policies has no terms/currentTermStart/currentTermEnd columns', () => {
    const cols = getColumnNames(db, 'insurance_policies');
    expect(cols).not.toContain('terms');
    expect(cols).not.toContain('current_term_start');
    expect(cols).not.toContain('current_term_end');
  });

  test('reminders carries the time columns and the mileage-trigger columns', () => {
    const cols = getColumnNames(db, 'reminders');
    for (const column of [
      'id',
      'user_id',
      'name',
      'description',
      'type',
      'action_mode',
      'frequency',
      'interval_value',
      'interval_unit',
      'start_date',
      'end_date',
      'next_due_date',
      'expense_category',
      'expense_tags',
      'expense_amount',
      'expense_description',
      'expense_split_config',
      'is_active',
      'last_triggered_at',
      'created_at',
      'updated_at',
      // Mileage triggering, absorbed from a later migration.
      'trigger_mode',
      'interval_mileage',
      'last_service_odometer',
      'next_due_odometer',
    ]) {
      expect(cols).toContain(column);
    }
  });

  test('reminder_notifications carries due_date and due_odometer', () => {
    const cols = getColumnNames(db, 'reminder_notifications');
    for (const column of [
      'id',
      'reminder_id',
      'user_id',
      'due_date',
      'due_odometer',
      'is_read',
      'created_at',
      'updated_at',
    ]) {
      expect(cols).toContain(column);
    }
  });

  test('up_auth_identity_idx enforces uniqueness for auth rows', () => {
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

  test('the same external account may be linked twice outside the auth domain', () => {
    // The predicate's whole purpose: storage/llm rows legitimately repeat a provider account.
    db.run("INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@test.com', 'User A')");
    db.run(
      "INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, status) VALUES ('s1', 'u1', 'storage', 'google-drive', 'goog-123', 'Drive A', 'enc1', 'active')"
    );
    db.run(
      "INSERT INTO user_providers (id, user_id, domain, provider_type, provider_account_id, display_name, credentials, status) VALUES ('s2', 'u1', 'storage', 'google-drive', 'goog-123', 'Drive B', 'enc2', 'active')"
    );
    expect(countRows(db, 'user_providers')).toBe(2);
  });

  test('storage rows with NULL providerAccountId do not conflict', () => {
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
    db.run(
      "INSERT INTO users (id, email, display_name) VALUES ('u1', 'test@example.com', 'Test User')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
    );
    db.run(
      "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount) VALUES ('e1', 'v1', 'u1', 'fuel', 1700000000, 4550)"
    );

    expect(countRows(db, 'vehicles')).toBe(1);
    expect(countRows(db, 'expenses')).toBe(1);

    db.run("DELETE FROM users WHERE id = 'u1'");

    expect(countRows(db, 'users')).toBe(0);
    expect(countRows(db, 'vehicles')).toBe(0);
    expect(countRows(db, 'expenses')).toBe(0);
  });

  test('insurance term FK cascade: deleting term cascades junction, leaves the expense', () => {
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
      "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, source_type, source_id) VALUES ('e1', 'v1', 'u1', 'financial', 1700000000, 10000, 'insurance_term', 'it1')"
    );

    db.run("DELETE FROM insurance_terms WHERE id = 'it1'");

    expect(countRows(db, 'insurance_term_vehicles')).toBe(0);
    // `source_type`/`source_id` are a polymorphic pair, not a foreign key, so nothing cascades
    // through them — the cost-history row survives and app-level cleanup owns the dangling ref.
    const expense = db
      .query<{ source_type: string | null; source_id: string | null }, []>(
        "SELECT source_type, source_id FROM expenses WHERE id = 'e1'"
      )
      .get();
    expect(expense?.source_type).toBe('insurance_term');
    expect(expense?.source_id).toBe('it1');
    expect(countRows(db, 'expenses')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Property: license plate partial unique index enforcement
// ---------------------------------------------------------------------------

describe('Property: license plate partial unique index enforcement', () => {
  let db: Database;
  const migrations = loadMigrations();

  /** A fresh schema per property run — the constraint under test is per-database. */
  function freshDb(): Database {
    const local = new Database(':memory:');
    local.run('PRAGMA foreign_keys = ON');
    applyMigration(local, migrations[0]);
    local.run("INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@test.com', 'User')");
    return local;
  }

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  test('one user may not hold the same non-null plate twice', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
        (plate) => {
          const localDb = freshDb();
          try {
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
            return threw;
          } finally {
            localDb.close();
          }
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

          const localDb = freshDb();
          try {
            localDb.run(
              'INSERT INTO vehicles (id, user_id, make, model, year, license_plate) VALUES (?, ?, ?, ?, ?, ?)',
              ['v1', 'u1', 'Toyota', 'Camry', 2022, plate1]
            );
            localDb.run(
              'INSERT INTO vehicles (id, user_id, make, model, year, license_plate) VALUES (?, ?, ?, ?, ?, ?)',
              ['v2', 'u1', 'Honda', 'Civic', 2023, plate2]
            );
            return countRows(localDb, 'vehicles') === 2;
          } finally {
            localDb.close();
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  test('the plate index is scoped PER USER — two users may hold the same plate', () => {
    // The index is keyed (user_id, license_plate), not (license_plate). A global unique would
    // reject the second user here, which is what it did before the per-user swap.
    db.run("INSERT INTO users (id, email, display_name) VALUES ('u2', 'b@test.com', 'User B')");
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year, license_plate) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022, 'ABC123')"
    );
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year, license_plate) VALUES ('v2', 'u2', 'Honda', 'Civic', 2023, 'ABC123')"
    );
    expect(countRows(db, 'vehicles')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Property: active financing partial unique index enforcement
// ---------------------------------------------------------------------------

describe('Property: active financing partial unique index enforcement', () => {
  let db: Database;
  const migrations = loadMigrations();

  function freshDb(): Database {
    const local = new Database(':memory:');
    local.run('PRAGMA foreign_keys = ON');
    applyMigration(local, migrations[0]);
    local.run("INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@test.com', 'User')");
    local.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
    );
    return local;
  }

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  test('second active financing for same vehicle fails uniqueness constraint', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100000, max: 10000000 }),
        fc.integer({ min: 100000, max: 10000000 }),
        (amount1, amount2) => {
          const localDb = freshDb();
          try {
            localDb.run(
              'INSERT INTO vehicle_financing (id, vehicle_id, provider, original_amount, term_months, start_date, payment_amount, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              ['f1', 'v1', 'Bank A', amount1, 60, 1700000000, 50000, 1]
            );
            let threw = false;
            try {
              localDb.run(
                'INSERT INTO vehicle_financing (id, vehicle_id, provider, original_amount, term_months, start_date, payment_amount, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                ['f2', 'v1', 'Bank B', amount2, 48, 1700000000, 40000, 1]
              );
            } catch {
              threw = true;
            }
            return threw;
          } finally {
            localDb.close();
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  test('inactive financing record for same vehicle succeeds', () => {
    db.run(
      "INSERT INTO vehicle_financing (id, vehicle_id, provider, original_amount, term_months, start_date, payment_amount, is_active) VALUES ('f1', 'v1', 'Bank A', 3000000, 60, 1700000000, 50000, 1)"
    );
    db.run(
      "INSERT INTO vehicle_financing (id, vehicle_id, provider, original_amount, term_months, start_date, payment_amount, is_active) VALUES ('f2', 'v1', 'Bank B', 2500000, 48, 1700000000, 40000, 0)"
    );
    expect(countRows(db, 'vehicle_financing')).toBe(2);
  });

  test('two active financing records for different vehicles succeed', () => {
    db.run(
      "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v2', 'u1', 'Honda', 'Civic', 2023)"
    );
    db.run(
      "INSERT INTO vehicle_financing (id, vehicle_id, provider, original_amount, term_months, start_date, payment_amount, is_active) VALUES ('f1', 'v1', 'Bank A', 3000000, 60, 1700000000, 50000, 1)"
    );
    db.run(
      "INSERT INTO vehicle_financing (id, vehicle_id, provider, original_amount, term_months, start_date, payment_amount, is_active) VALUES ('f2', 'v2', 'Bank B', 2500000, 48, 1700000000, 40000, 1)"
    );
    expect(countRows(db, 'vehicle_financing')).toBe(2);
  });

  test('multiple inactive financing records for same vehicle succeed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 5 }), (count) => {
        const localDb = freshDb();
        try {
          for (let i = 0; i < count; i++) {
            localDb.run(
              'INSERT INTO vehicle_financing (id, vehicle_id, provider, original_amount, term_months, start_date, payment_amount, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [`f${i}`, 'v1', `Bank ${i}`, 3000000, 60, 1700000000, 50000, 0]
            );
          }
          return countRows(localDb, 'vehicle_financing') === count;
        } finally {
          localDb.close();
        }
      }),
      { numRuns: 20 }
    );
  });
});
