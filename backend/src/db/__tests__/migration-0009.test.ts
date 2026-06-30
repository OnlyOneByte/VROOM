/**
 * Migration 0009: money columns float-dollars → integer-cents (money-cents-migration T1).
 *
 * The 14 money columns (design §1) flip from `real` (binary-float dollars) to `integer` (cents). The
 * hand-authored migration converts every stored value in place:
 *   UPDATE <table> SET <col> = CAST(ROUND(<col> * 100) AS INTEGER) WHERE <col> IS NOT NULL;
 *
 * ROUND-BEFORE-CAST is mandatory and is the whole point of these tests: `CAST(12.34 * 100 AS INTEGER)`
 * is `1233` (the binary float 12.34*100 = 1233.9999… truncates), not `1234`. The ROUND fixes that. The
 * `WHERE … IS NOT NULL` preserves NULLs (an absent optional money value must stay absent, not become 0).
 *
 * Unlike 0004 this is the 0003-style in-place UPDATE class — no table rebuild, no FK touch — so the
 * cascade footgun does NOT apply; these tests prove it by asserting row counts are unchanged (no
 * DROP/cascade) in addition to the exact-cents conversion. They apply 0009 inside the same BEGIN/COMMIT
 * the production migrator uses (applyMigration), with foreign_keys ON.
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyMigration,
  applyMigrationsUpTo,
  countRows,
  loadMigrations,
  seedCoreData,
} from './migration-helpers';

describe('Migration 0009: money float-dollars → integer-cents', () => {
  let db: Database;
  const migrations = loadMigrations();
  // 0009 is the highest migration; applyMigrationsUpTo needs its index. Resolve it from the loaded
  // list rather than hard-coding 9, so the test does not silently mis-target if a migration is inserted.
  const idx0009 = migrations.findIndex((m) => m.tag === '0009_money_to_cents');
  const idxPrev = idx0009 - 1;

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  /** Seed a user + one vehicle + one financing row at the PRE-0009 (float-dollar) state. */
  function seedFinancing(originalAmount: number, paymentAmount: number): void {
    seedCoreData(db); // u1 / v1 / e1 (expense_amount 45.50 float)
    db.run(
      `INSERT INTO vehicle_financing (id, vehicle_id, financing_type, provider, original_amount, term_months, start_date, payment_amount, is_active)
       VALUES ('f1', 'v1', 'loan', 'Test Bank', ?, 60, 1700000000, ?, 1)`,
      [originalAmount, paymentAmount]
    );
  }

  test('the 0009 migration is registered and discoverable', () => {
    expect(idx0009).toBeGreaterThan(0);
    expect(migrations[idx0009].tag).toBe('0009_money_to_cents');
  });

  test('expense_amount converts exact-cents (the seeded 45.50 → 4550)', () => {
    applyMigrationsUpTo(db, migrations, idxPrev);
    seedCoreData(db); // expense e1 at 45.50
    applyMigration(db, migrations[idx0009]);

    const e = db.query(`SELECT expense_amount FROM expenses WHERE id = 'e1'`).get() as {
      expense_amount: number;
    };
    expect(e.expense_amount).toBe(4550);
    expect(Number.isInteger(e.expense_amount)).toBe(true);
  });

  test('binary-float edge values round correctly (12.34→1234, 19.99→1999, 0.07→7, 0.01→1)', () => {
    applyMigrationsUpTo(db, migrations, idxPrev);
    seedCoreData(db);
    // These are the classic IEEE-754 traps: 12.34*100 = 1233.9999…, 19.99*100 = 1998.9999…, etc.
    // A bare CAST (no ROUND) would truncate each one a cent low.
    const edges: [string, number, number][] = [
      ['ee_1234', 12.34, 1234],
      ['ee_1999', 19.99, 1999],
      ['ee_0007', 0.07, 7],
      ['ee_0001', 0.01, 1],
      ['ee_big', 999999.99, 99999999],
    ];
    for (const [id, dollars] of edges) {
      db.run(
        `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount) VALUES (?, 'v1', 'u1', 'fuel', 1700000000, ?)`,
        [id, dollars]
      );
    }
    applyMigration(db, migrations[idx0009]);

    for (const [id, _dollars, cents] of edges) {
      const row = db.query(`SELECT expense_amount FROM expenses WHERE id = ?`).get(id) as {
        expense_amount: number;
      };
      expect(row.expense_amount).toBe(cents);
      expect(Number.isInteger(row.expense_amount)).toBe(true);
    }
  });

  test('zero is preserved as 0, and a NULL optional money value stays NULL', () => {
    applyMigrationsUpTo(db, migrations, idxPrev);
    // seedFinancing seeds core (u1/v1/e1) AND f1 with a NULL residual_value (a loan, no lease buyout).
    seedFinancing(20000.5, 372.86);
    // expense at exactly 0 ($0 expense is unusual but legal) — added after core is seeded.
    db.run(
      `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount) VALUES ('e_zero', 'v1', 'u1', 'misc', 1700000000, 0)`
    );
    applyMigration(db, migrations[idx0009]);

    const z = db.query(`SELECT expense_amount FROM expenses WHERE id = 'e_zero'`).get() as {
      expense_amount: number;
    };
    expect(z.expense_amount).toBe(0);

    const f = db
      .query(
        `SELECT original_amount, payment_amount, residual_value FROM vehicle_financing WHERE id = 'f1'`
      )
      .get() as {
      original_amount: number;
      payment_amount: number;
      residual_value: number | null;
    };
    expect(f.original_amount).toBe(2000050); // 20000.50 → 2000050 cents
    expect(f.payment_amount).toBe(37286); // 372.86 → 37286 cents
    expect(f.residual_value).toBeNull(); // NULL preserved, NOT coerced to 0
  });

  test('every money table keeps its row count (in-place UPDATE, no DROP/cascade — the 0004 contrast)', () => {
    applyMigrationsUpTo(db, migrations, idxPrev);
    seedFinancing(20000, 372.86); // u1 / v1 / e1 (expense) / f1 (financing)
    const before = {
      users: countRows(db, 'users'),
      vehicles: countRows(db, 'vehicles'),
      expenses: countRows(db, 'expenses'),
      vehicle_financing: countRows(db, 'vehicle_financing'),
    };
    applyMigration(db, migrations[idx0009]);
    expect(countRows(db, 'users')).toBe(before.users);
    expect(countRows(db, 'vehicles')).toBe(before.vehicles);
    expect(countRows(db, 'expenses')).toBe(before.expenses);
    expect(countRows(db, 'vehicle_financing')).toBe(before.vehicle_financing);
  });

  test('the migration is in-place: physical column affinity stays REAL (no rebuild), values become integers', () => {
    // KEY design §3 invariant. The hand-authored migration does an in-place UPDATE — it does NOT rebuild
    // the table — so the DECLARED column affinity is still REAL (a rebuild is exactly the 0004 cascade
    // footgun this migration deliberately avoids: SQLite dynamic typing means integer VALUES live happily
    // in a REAL-affinity column). The `integer` change in schema.ts drives the Drizzle TS type +
    // drizzle-zod + coerceRow's branch selection (columnType SQLiteInteger), which is what the cents
    // contract needs; the physical affinity is intentionally left untouched. This test pins that contract
    // so a future "let me also rebuild the columns to INTEGER affinity" change is a conscious decision,
    // not an accident — and proves the stored values are genuine integers post-migration.
    applyMigrationsUpTo(db, migrations, idxPrev);
    seedCoreData(db); // e1 = 45.50
    applyMigration(db, migrations[idx0009]);

    const expenseCols = db.query(`PRAGMA table_info('expenses')`).all() as {
      name: string;
      type: string;
    }[];
    // Affinity unchanged by the in-place UPDATE (no __new_ rebuild).
    expect(expenseCols.find((c) => c.name === 'expense_amount')?.type.toUpperCase()).toBe('REAL');
    // The stored value is integer-VALUED (whole cents). Because the column keeps REAL affinity, SQLite
    // stores 4550 with the 'real' storage class (4550.0) — but it is an EXACT whole number (integers up
    // to 2^53 are representable exactly in a float), JS reads it as 4550, and z.number().int() (the
    // integer-mode drizzle-zod validator) accepts it. The cents contract is about integer VALUES, not
    // the physical storage class — that is what we pin here.
    const e = db.query(`SELECT expense_amount AS v FROM expenses WHERE id = 'e1'`).get() as {
      v: number;
    };
    expect(e.v).toBe(4550);
    expect(Number.isInteger(e.v)).toBe(true); // whole cents — no fractional drift survived
  });

  test('double-apply re-scales (NOT idempotent) — the migration must never be hand-replayed', () => {
    // This documents the design §3 idempotency HAZARD: UPDATE …*100 run twice multiplies by 10000.
    // The __drizzle_migrations ledger guards the normal path; this test pins WHY a manual replay is unsafe.
    applyMigrationsUpTo(db, migrations, idxPrev);
    seedCoreData(db); // e1 = 45.50
    applyMigration(db, migrations[idx0009]); // → 4550
    applyMigration(db, migrations[idx0009]); // → 455000 (re-scaled — proves non-idempotency)
    const e = db.query(`SELECT expense_amount FROM expenses WHERE id = 'e1'`).get() as {
      expense_amount: number;
    };
    expect(e.expense_amount).toBe(455000);
  });
});
