// Behavioral invariants the database enforces: partial-index predicates, uniqueness, and cascade rules.
// Table structure is pinned separately in migration-0000.test.ts.

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { applyMigration, countRows, loadMigrations } from './migration-helpers';

const migrations = loadMigrations();

function seeded(): Database {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  applyMigration(db, migrations[0]);
  db.run("INSERT INTO users (id, email, display_name) VALUES ('u1', 'a@test.com', 'User A')");
  db.run(
    "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v1', 'u1', 'Toyota', 'Camry', 2022)"
  );
  return db;
}

describe('offline-sync idempotency: expenses_user_client_idx', () => {
  let db: Database;
  beforeEach(() => {
    db = seeded();
  });
  afterEach(() => db.close());

  function insertExpense(id: string, userId: string, clientId: string | null): void {
    db.run(
      'INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, client_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, 'v1', userId, 'fuel', 1700000000, 4550, clientId]
    );
  }

  test('a client_id cannot be replayed by the same user', () => {
    // Makes a retried offline flush safe: the database rejects the replayed client_id.
    insertExpense('e1', 'u1', 'client-abc');
    expect(() => insertExpense('e2', 'u1', 'client-abc')).toThrow(/UNIQUE constraint failed/);
  });

  test('the same client_id from a DIFFERENT user is accepted (tenant-scoped)', () => {
    db.run("INSERT INTO users (id, email, display_name) VALUES ('u2', 'b@test.com', 'User B')");
    insertExpense('e1', 'u1', 'client-abc');
    insertExpense('e2', 'u2', 'client-abc');
    expect(countRows(db, 'expenses')).toBe(2);
  });

  test('server-created expenses carry NULL client_id and never collide', () => {
    // Partial so NULL client_ids are exempt. A plain unique would allow one server-created expense per user.
    for (const id of ['e1', 'e2', 'e3']) insertExpense(id, 'u1', null);
    expect(countRows(db, 'expenses')).toBe(3);
  });
});

describe('insurance claims', () => {
  let db: Database;
  beforeEach(() => {
    db = seeded();
    db.run("INSERT INTO insurance_policies (id, user_id, company) VALUES ('ip1', 'u1', 'Geico')");
  });
  afterEach(() => db.close());

  test('a new claim defaults to status "filed"', () => {
    db.run(
      "INSERT INTO insurance_claims (id, policy_id, claim_date, claim_type) VALUES ('c1', 'ip1', 1700000000, 'collision')"
    );
    const row = db
      .query<{ status: string }, []>("SELECT status FROM insurance_claims WHERE id = 'c1'")
      .get();
    expect(row?.status).toBe('filed');
  });

  test('deleting a policy cascades to its claims', () => {
    db.run(
      "INSERT INTO insurance_claims (id, policy_id, claim_date, claim_type) VALUES ('c1', 'ip1', 1700000000, 'collision')"
    );
    db.run("DELETE FROM insurance_policies WHERE id = 'ip1'");
    expect(countRows(db, 'insurance_claims')).toBe(0);
  });

  test('deleting a claimed-against term SETS NULL rather than deleting the claim', () => {
    // A claim is financial history. Tidying up an expired term must not erase it.
    db.run(
      "INSERT INTO insurance_terms (id, policy_id, start_date, end_date) VALUES ('it1', 'ip1', 1700000000, 1730000000)"
    );
    db.run(
      "INSERT INTO insurance_claims (id, policy_id, term_id, claim_date, claim_type) VALUES ('c1', 'ip1', 'it1', 1700000000, 'collision')"
    );
    db.run("DELETE FROM insurance_terms WHERE id = 'it1'");
    const row = db
      .query<{ term_id: string | null }, []>("SELECT term_id FROM insurance_claims WHERE id = 'c1'")
      .get();
    expect(countRows(db, 'insurance_claims')).toBe(1);
    expect(row?.term_id).toBeNull();
  });
});

describe('mileage-triggered reminders', () => {
  let db: Database;
  beforeEach(() => {
    db = seeded();
  });
  afterEach(() => db.close());

  test('a mileage-only reminder persists with a NULL next_due_date', () => {
    // next_due_date must be nullable: a NOT NULL column would force a sentinel date onto mileage-only reminders.
    db.run(
      `INSERT INTO reminders (id, user_id, name, type, action_mode, frequency, trigger_mode,
         interval_mileage, last_service_odometer, next_due_odometer, start_date, next_due_date, is_active)
       VALUES ('r1', 'u1', 'Oil change', 'maintenance', 'automatic', 'mileage', 'mileage',
         5000, 30000, 35000, 1700000000, NULL, 1)`
    );
    const row = db
      .query<{ next_due_date: number | null; next_due_odometer: number }, []>(
        "SELECT next_due_date, next_due_odometer FROM reminders WHERE id = 'r1'"
      )
      .get();
    expect(row?.next_due_date).toBeNull();
    expect(row?.next_due_odometer).toBe(35000);
  });

  test('rn_reminder_odo_idx dedups on (reminder, due_odometer)', () => {
    db.run(
      `INSERT INTO reminders (id, user_id, name, type, action_mode, frequency, trigger_mode, start_date, next_due_date, is_active)
       VALUES ('r1', 'u1', 'Oil change', 'maintenance', 'automatic', 'mileage', 'mileage', 1700000000, NULL, 1)`
    );
    db.run(
      "INSERT INTO reminder_notifications (id, reminder_id, user_id, due_date, due_odometer, is_read) VALUES ('n1', 'r1', 'u1', NULL, 35000, 0)"
    );
    expect(() =>
      db.run(
        "INSERT INTO reminder_notifications (id, reminder_id, user_id, due_date, due_odometer, is_read) VALUES ('n2', 'r1', 'u1', NULL, 35000, 0)"
      )
    ).toThrow(/UNIQUE constraint failed/);
  });

  test('the odometer index leaves the time axis free (NULL due_odometer never collides)', () => {
    db.run(
      `INSERT INTO reminders (id, user_id, name, type, action_mode, frequency, trigger_mode, start_date, next_due_date, is_active)
       VALUES ('r1', 'u1', 'Registration', 'maintenance', 'automatic', 'yearly', 'time', 1700000000, 1730000000, 1)`
    );
    db.run(
      "INSERT INTO reminder_notifications (id, reminder_id, user_id, due_date, is_read) VALUES ('n1', 'r1', 'u1', 1730000000, 0)"
    );
    db.run(
      "INSERT INTO reminder_notifications (id, reminder_id, user_id, due_date, is_read) VALUES ('n2', 'r1', 'u1', 1760000000, 0)"
    );
    expect(countRows(db, 'reminder_notifications')).toBe(2);
  });
});

describe('user preference defaults', () => {
  let db: Database;
  beforeEach(() => {
    db = seeded();
  });
  afterEach(() => db.close());

  test('an insert omitting both scalar preferences takes their defaults', () => {
    db.run("INSERT INTO user_preferences (user_id) VALUES ('u1')");
    const row = db
      .query<{ theme_preference: string; business_mileage_rate: number }, []>(
        "SELECT theme_preference, business_mileage_rate FROM user_preferences WHERE user_id = 'u1'"
      )
      .get();
    expect(row?.theme_preference).toBe('default');
    expect(row?.business_mileage_rate).toBe(0);
  });

  test('business_mileage_rate keeps fractional precision (a real, not cents)', () => {
    // A rate, not an amount, so it stays real rather than integer cents.
    db.run("INSERT INTO user_preferences (user_id, business_mileage_rate) VALUES ('u1', 0.655)");
    const row = db
      .query<{ business_mileage_rate: number }, []>(
        "SELECT business_mileage_rate FROM user_preferences WHERE user_id = 'u1'"
      )
      .get();
    expect(row?.business_mileage_rate).toBeCloseTo(0.655, 10);
  });
});

describe('trips', () => {
  let db: Database;
  beforeEach(() => {
    db = seeded();
  });
  afterEach(() => db.close());

  function insertTrip(id = 't1'): void {
    db.run(
      `INSERT INTO trips (id, vehicle_id, user_id, start_odometer, end_odometer, purpose, trip_date)
       VALUES (?, 'v1', 'u1', 30000, 30120, 'business', 1700000000)`,
      [id]
    );
  }

  test('the odometer/purpose/date core is NOT NULL; locations and note are optional', () => {
    insertTrip();
    const row = db
      .query<{ start_location: string | null; note: string | null }, []>(
        "SELECT start_location, note FROM trips WHERE id = 't1'"
      )
      .get();
    expect(row?.start_location).toBeNull();
    expect(row?.note).toBeNull();
    expect(() =>
      db.run(
        `INSERT INTO trips (id, vehicle_id, user_id, start_odometer, purpose, trip_date)
         VALUES ('t2', 'v1', 'u1', 30000, 'business', 1700000000)`
      )
    ).toThrow(/NOT NULL constraint failed/);
  });

  test('deleting the owning vehicle cascades to its trips', () => {
    insertTrip();
    db.run("DELETE FROM vehicles WHERE id = 'v1'");
    expect(countRows(db, 'trips')).toBe(0);
  });

  test('deleting the owning user cascades to its trips', () => {
    insertTrip();
    db.run("DELETE FROM users WHERE id = 'u1'");
    expect(countRows(db, 'trips')).toBe(0);
  });
});

describe('vehicle sharing: vehicle_shares_active_idx', () => {
  let db: Database;
  beforeEach(() => {
    db = seeded();
    db.run("INSERT INTO users (id, email, display_name) VALUES ('u2', 'b@test.com', 'User B')");
  });
  afterEach(() => db.close());

  function share(id: string, status: string, sharedWith = 'u2'): void {
    db.run(
      'INSERT INTO vehicle_shares (id, vehicle_id, owner_id, shared_with_id, level, status) VALUES (?, ?, ?, ?, ?, ?)',
      [id, 'v1', 'u1', sharedWith, 'editor', status]
    );
  }

  test('a second LIVE invite for the same (vehicle, invitee) is rejected', () => {
    share('s1', 'pending');
    expect(() => share('s2', 'accepted')).toThrow(/UNIQUE constraint failed/);
  });

  test('a declined or revoked share does NOT block re-inviting the same user', () => {
    // The index predicate covers only pending/accepted. Without it, one decline would bar the invitee for good.
    share('s1', 'declined');
    share('s2', 'revoked');
    share('s3', 'pending');
    expect(countRows(db, 'vehicle_shares')).toBe(3);
  });

  test('deleting the vehicle cascades to its shares', () => {
    share('s1', 'accepted');
    db.run("DELETE FROM vehicles WHERE id = 'v1'");
    expect(countRows(db, 'vehicle_shares')).toBe(0);
  });

  test('deleting the invitee cascades their shares but leaves the owner vehicle', () => {
    share('s1', 'accepted');
    db.run("DELETE FROM users WHERE id = 'u2'");
    expect(countRows(db, 'vehicle_shares')).toBe(0);
    expect(countRows(db, 'vehicles')).toBe(1);
  });
});

describe('expense provenance: created_by', () => {
  let db: Database;
  beforeEach(() => {
    db = seeded();
    db.run("INSERT INTO users (id, email, display_name) VALUES ('u2', 'b@test.com', 'User B')");
  });
  afterEach(() => db.close());

  function insertExpense(id: string, createdBy: string | null): void {
    db.run(
      'INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, 'v1', 'u1', 'fuel', 1700000000, 4550, createdBy]
    );
  }

  test('created_by is nullable for self-created rows', () => {
    insertExpense('e1', null);
    expect(countRows(db, 'expenses')).toBe(1);
  });

  test('created_by may name a different user than the owner (editor on a shared vehicle)', () => {
    insertExpense('e1', 'u2');
    const row = db
      .query<{ user_id: string; created_by: string | null }, []>(
        "SELECT user_id, created_by FROM expenses WHERE id = 'e1'"
      )
      .get();
    expect(row?.user_id).toBe('u1');
    expect(row?.created_by).toBe('u2');
  });

  test('deleting the AUTHOR nulls the provenance and keeps the owner cost row', () => {
    // SET NULL, not CASCADE (would delete the owner's cost history) and not NO ACTION (would block deleting the editor).
    insertExpense('e1', 'u2');
    db.run("DELETE FROM users WHERE id = 'u2'");
    const row = db
      .query<{ user_id: string; created_by: string | null }, []>(
        "SELECT user_id, created_by FROM expenses WHERE id = 'e1'"
      )
      .get();
    expect(countRows(db, 'expenses')).toBe(1);
    expect(row?.user_id).toBe('u1');
    expect(row?.created_by).toBeNull();
  });

  test('expenses.location is optional free text', () => {
    db.run(
      "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount) VALUES ('e1', 'v1', 'u1', 'fuel', 1700000000, 4550)"
    );
    db.run(
      "INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, location) VALUES ('e2', 'v1', 'u1', 'fuel', 1700000000, 4550, 'Shell on 5th')"
    );
    const rows = db
      .query<{ location: string | null }, []>('SELECT location FROM expenses ORDER BY id')
      .all();
    expect(rows.map((r) => r.location)).toEqual([null, 'Shell on 5th']);
  });
});

describe('push subscriptions', () => {
  let db: Database;
  beforeEach(() => {
    db = seeded();
  });
  afterEach(() => db.close());

  function subscribe(id: string, userId: string, endpoint: string): void {
    db.run(
      'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)',
      [id, userId, endpoint, 'key', 'auth']
    );
  }

  test('failure_count defaults to 0', () => {
    subscribe('s1', 'u1', 'https://push.example/1');
    const row = db
      .query<{ failure_count: number }, []>(
        "SELECT failure_count FROM push_subscriptions WHERE id = 's1'"
      )
      .get();
    expect(row?.failure_count).toBe(0);
  });

  test('the same (user, endpoint) cannot be stored twice', () => {
    subscribe('s1', 'u1', 'https://push.example/1');
    expect(() => subscribe('s2', 'u1', 'https://push.example/1')).toThrow(
      /UNIQUE constraint failed/
    );
  });

  test('a second device for the same user is allowed', () => {
    subscribe('s1', 'u1', 'https://push.example/1');
    subscribe('s2', 'u1', 'https://push.example/2');
    expect(countRows(db, 'push_subscriptions')).toBe(2);
  });

  test('the unique key is tenant-scoped — two users may carry the same endpoint', () => {
    db.run("INSERT INTO users (id, email, display_name) VALUES ('u2', 'b@test.com', 'User B')");
    subscribe('s1', 'u1', 'https://push.example/1');
    subscribe('s2', 'u2', 'https://push.example/1');
    expect(countRows(db, 'push_subscriptions')).toBe(2);
  });

  test('deleting the user cascades to their subscriptions', () => {
    subscribe('s1', 'u1', 'https://push.example/1');
    db.run("DELETE FROM users WHERE id = 'u1'");
    expect(countRows(db, 'push_subscriptions')).toBe(0);
  });

  test('an unknown user_id is rejected by the foreign key', () => {
    expect(() => subscribe('s1', 'nobody', 'https://push.example/1')).toThrow(
      /FOREIGN KEY constraint failed/
    );
  });
});
