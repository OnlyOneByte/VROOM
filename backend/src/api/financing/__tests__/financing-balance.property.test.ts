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
import { FinancingRepository } from '../repository';

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

function createFinancingPayment(amount: number): void {
  const id = `exp-fp-${++expenseCounter}`;
  sqliteDb.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, is_financing_payment)
     VALUES ('${id}', '${VEHICLE_ID}', '${USER_ID}', 'financial', ${Math.floor(Date.now() / 1000)}, ${amount}, 1)`
  );
}

function createNonFinancingExpense(amount: number): void {
  const id = `exp-nf-${++expenseCounter}`;
  sqliteDb.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, is_financing_payment)
     VALUES ('${id}', '${VEHICLE_ID}', '${USER_ID}', 'fuel', ${Math.floor(Date.now() / 1000)}, ${amount}, 0)`
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
            createFinancingPayment(payment);
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

          createFinancingPayment(financingPayment);
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
    createFinancingPayment(600);
    createFinancingPayment(600);

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
            createFinancingPayment(payment);
          }

          const computedBalance = await repo.computeBalance(financingId);
          const eligibleForPayoff = computedBalance <= 0.01;

          const totalPayments = payments.reduce((sum, p) => sum + p, 0);
          const expectedBalance = Math.max(0, originalAmount - totalPayments);

          if (expectedBalance <= 0.01) {
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
    createFinancingPayment(1000);

    const balance = await repo.computeBalance(financingId);
    expect(balance).toBe(0);
    expect(balance <= 0.01).toBe(true);
  });

  test('financing with remaining balance is not eligible', async () => {
    const financingId = createFinancing(10000);
    createFinancingPayment(100);

    const balance = await repo.computeBalance(financingId);
    expect(balance).toBeGreaterThan(0.01);
    expect(balance <= 0.01).toBe(false);
  });
});
