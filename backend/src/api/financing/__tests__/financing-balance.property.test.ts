/**
 * Property-Based Tests for Financing Balance Computation and Payoff Eligibility
 *
 * Tests Properties 5 and 6 against a real in-memory SQLite database.
 *
 * **Validates: Requirements 4.2, 4.4, 17.1, 17.3**
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fc from 'fast-check';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { FinancingRepository, isEligibleForPayoff, PAYOFF_BALANCE_THRESHOLD } from '../repository';

let sqliteDb: Database;
let db: AppDatabase;
let repo: FinancingRepository;

const USER_ID = 'test-user-fin';
const VEHICLE_ID = 'v-fin-1';

function seedTestData(): void {
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_ID}', 'fin@test.com', 'Fin User')`
  );
  sqliteDb.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${VEHICLE_ID}', '${USER_ID}', 'Toyota', 'Camry', 2022)`
  );
}

beforeEach(() => {
  sqliteDb = new Database(':memory:');
  sqliteDb.run('PRAGMA foreign_keys = ON');
  const migrations = loadMigrations();
  for (const m of migrations) {
    applyMigration(sqliteDb, m);
  }
  db = drizzle(sqliteDb, { schema });
  repo = new FinancingRepository(db);
  seedTestData();
});

afterEach(() => {
  sqliteDb.close();
});

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Positive dollar amount between 1000 and 100000 */
const originalAmountArb = fc
  .double({ min: 1000, max: 100000, noNaN: true })
  .map((v) => Math.round(v * 100) / 100);

/** Payment amount between 1 and 5000 */
const paymentAmountArb = fc
  .double({ min: 1, max: 5000, noNaN: true })
  .map((v) => Math.round(v * 100) / 100);

/** Number of financing payment expenses (0–10) */
const _paymentCountArb = fc.integer({ min: 0, max: 10 });

let financingCounter = 0;
let expenseCounter = 0;

function createFinancing(originalAmount: number): string {
  const id = `fin-${++financingCounter}`;
  sqliteDb.run(
    `INSERT INTO vehicle_financing (id, vehicle_id, financing_type, provider, original_amount, term_months, start_date, payment_amount, is_active)
     VALUES ('${id}', '${VEHICLE_ID}', 'loan', 'TestBank', ${originalAmount}, 60, ${Math.floor(Date.now() / 1000)}, 500, 1)`
  );
  return id;
}

function createFinancingPayment(amount: number, financingId: string): void {
  const id = `exp-fp-${++expenseCounter}`;
  sqliteDb.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, source_type, source_id)
     VALUES ('${id}', '${VEHICLE_ID}', '${USER_ID}', 'financial', ${Math.floor(Date.now() / 1000)}, ${amount}, 'financing', '${financingId}')`
  );
}

function createNonFinancingExpense(amount: number): void {
  const id = `exp-nf-${++expenseCounter}`;
  sqliteDb.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount)
     VALUES ('${id}', '${VEHICLE_ID}', '${USER_ID}', 'fuel', ${Math.floor(Date.now() / 1000)}, ${amount})`
  );
}

// ===========================================================================
// Property 5: Financing balance computation
// **Validates: Requirements 4.2, 17.1**
// ===========================================================================
describe('Property 5: Financing balance computation', () => {
  test('balance = max(0, originalAmount - sum of financing payments)', async () => {
    await fc.assert(
      fc.asyncProperty(
        originalAmountArb,
        fc.array(paymentAmountArb, { minLength: 0, maxLength: 8 }),
        async (originalAmount, payments) => {
          const financingId = createFinancing(originalAmount);

          for (const payment of payments) {
            createFinancingPayment(payment, financingId);
          }

          const computedBalance = await repo.computeBalance(financingId);
          const totalPayments = payments.reduce((sum, p) => sum + p, 0);
          const expectedBalance = Math.max(0, originalAmount - totalPayments);

          // Allow small floating point tolerance
          expect(Math.abs(computedBalance - expectedBalance)).toBeLessThan(0.02);

          // Clean up for next iteration
          sqliteDb.run(`DELETE FROM expenses WHERE vehicle_id = '${VEHICLE_ID}'`);
          sqliteDb.run(`DELETE FROM vehicle_financing WHERE id = '${financingId}'`);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('non-financing expenses do not affect balance', async () => {
    await fc.assert(
      fc.asyncProperty(
        originalAmountArb,
        paymentAmountArb,
        paymentAmountArb,
        async (originalAmount, financingPayment, regularExpense) => {
          const financingId = createFinancing(originalAmount);

          createFinancingPayment(financingPayment, financingId);
          createNonFinancingExpense(regularExpense);

          const computedBalance = await repo.computeBalance(financingId);
          const expectedBalance = Math.max(0, originalAmount - financingPayment);

          expect(Math.abs(computedBalance - expectedBalance)).toBeLessThan(0.02);

          sqliteDb.run(`DELETE FROM expenses WHERE vehicle_id = '${VEHICLE_ID}'`);
          sqliteDb.run(`DELETE FROM vehicle_financing WHERE id = '${financingId}'`);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('balance is clamped to 0 when payments exceed original amount', async () => {
    const financingId = createFinancing(1000);
    createFinancingPayment(600, financingId);
    createFinancingPayment(600, financingId);

    const balance = await repo.computeBalance(financingId);
    expect(balance).toBe(0);
  });

  test('balance equals originalAmount when no payments exist', async () => {
    const financingId = createFinancing(25000);
    const balance = await repo.computeBalance(financingId);
    expect(balance).toBe(25000);
  });

  test('returns 0 for non-existent financing', async () => {
    const balance = await repo.computeBalance('non-existent-id');
    expect(balance).toBe(0);
  });
});

// ===========================================================================
// Property 6: Financing payoff eligibility flag
// **Validates: Requirements 4.4, 17.3**
// ===========================================================================
describe('Property 6: Financing payoff eligibility flag', () => {
  test('eligibleForPayoff is true when balance <= 0.01, false otherwise', async () => {
    await fc.assert(
      fc.asyncProperty(
        originalAmountArb,
        fc.array(paymentAmountArb, { minLength: 0, maxLength: 8 }),
        async (originalAmount, payments) => {
          const financingId = createFinancing(originalAmount);

          for (const payment of payments) {
            createFinancingPayment(payment, financingId);
          }

          const computedBalance = await repo.computeBalance(financingId);
          // C182: call the REAL exported rule (was a local `<= 0.01` copy — the C181 theater
          // pattern). isEligibleForPayoff is now the one source of truth the 3 route sites use.
          const eligibleForPayoff = isEligibleForPayoff(computedBalance);

          const totalPayments = payments.reduce((sum, p) => sum + p, 0);
          const expectedBalance = Math.max(0, originalAmount - totalPayments);

          if (expectedBalance <= PAYOFF_BALANCE_THRESHOLD) {
            expect(eligibleForPayoff).toBe(true);
          } else {
            expect(eligibleForPayoff).toBe(false);
          }

          sqliteDb.run(`DELETE FROM expenses WHERE vehicle_id = '${VEHICLE_ID}'`);
          sqliteDb.run(`DELETE FROM vehicle_financing WHERE id = '${financingId}'`);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('fully paid off financing is eligible for payoff', async () => {
    const financingId = createFinancing(1000);
    createFinancingPayment(1000, financingId);

    const balance = await repo.computeBalance(financingId);
    expect(balance).toBe(0);
    expect(isEligibleForPayoff(balance)).toBe(true);
  });

  test('financing with remaining balance is not eligible', async () => {
    const financingId = createFinancing(10000);
    createFinancingPayment(100, financingId);

    const balance = await repo.computeBalance(financingId);
    expect(balance).toBeGreaterThan(PAYOFF_BALANCE_THRESHOLD);
    expect(isEligibleForPayoff(balance)).toBe(false);
  });

  // C182: pin the extracted predicate's BOUNDARY directly (the 3 route sites + the property
  // test above all route through it now). Exactly-at-threshold is eligible; a cent above is not.
  test('isEligibleForPayoff boundary: exactly the threshold is eligible, just above is not', () => {
    expect(isEligibleForPayoff(PAYOFF_BALANCE_THRESHOLD)).toBe(true); // 0.01 → paid off
    expect(isEligibleForPayoff(0)).toBe(true);
    expect(isEligibleForPayoff(PAYOFF_BALANCE_THRESHOLD + 0.0001)).toBe(false); // 0.0101 → still owed
    expect(isEligibleForPayoff(100)).toBe(false);
  });
});

// ===========================================================================
// Batch balance computation (computeBalances) — must match per-record computeBalance
// ===========================================================================
describe('computeBalances (batch) equivalence', () => {
  test('batch result matches per-record computeBalance for many records', async () => {
    // vehicle_financing has a UNIQUE(vehicle_id) constraint (one financing per
    // vehicle), so each financing record needs its own vehicle.
    let vehicleCounter = 0;
    const newVehicle = (): string => {
      const vid = `v-batch-${++vehicleCounter}`;
      sqliteDb.run(
        `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${vid}', '${USER_ID}', 'Honda', 'Civic', 2021)`
      );
      return vid;
    };
    const finOn = (originalAmount: number, vehicleId: string): string => {
      const id = `fin-batch-${++financingCounter}`;
      sqliteDb.run(
        `INSERT INTO vehicle_financing (id, vehicle_id, financing_type, provider, original_amount, term_months, start_date, payment_amount, is_active)
         VALUES ('${id}', '${vehicleId}', 'loan', 'TestBank', ${originalAmount}, 60, ${Math.floor(Date.now() / 1000)}, 500, 1)`
      );
      return id;
    };
    const payOn = (amount: number, financingId: string, vehicleId: string): void => {
      sqliteDb.run(
        `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, source_type, source_id)
         VALUES ('exp-fpb-${++expenseCounter}', '${vehicleId}', '${USER_ID}', 'financial', ${Math.floor(Date.now() / 1000)}, ${amount}, 'financing', '${financingId}')`
      );
    };

    // Three financing records (distinct vehicles) with distinct payment profiles.
    const vA = newVehicle();
    const finA = finOn(10000, vA);
    payOn(2500, finA, vA);
    payOn(2500, finA, vA);
    const vB = newVehicle();
    const finB = finOn(5000, vB);
    payOn(5000, finB, vB); // fully paid → clamps to 0
    const vC = newVehicle();
    const finC = finOn(8000, vC); // no payments
    createNonFinancingExpense(999); // must not affect any balance

    const expectedA = await repo.computeBalance(finA);
    const expectedB = await repo.computeBalance(finB);
    const expectedC = await repo.computeBalance(finC);

    const batch = await repo.computeBalances([finA, finB, finC]);
    expect(batch.get(finA)).toBe(expectedA);
    expect(batch.get(finB)).toBe(expectedB);
    expect(batch.get(finC)).toBe(expectedC);
    expect(batch.get(finB)).toBe(0);
    expect(batch.get(finC)).toBe(8000);
  });

  test('empty input returns an empty map', async () => {
    const batch = await repo.computeBalances([]);
    expect(batch.size).toBe(0);
  });

  test('non-existent financing id is omitted from the map', async () => {
    const batch = await repo.computeBalances(['non-existent-id']);
    expect(batch.has('non-existent-id')).toBe(false);
  });
});
