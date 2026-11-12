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
  sqliteDb.run('INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)', [
    USER_ID,
    'fin@test.com',
    'Fin User',
  ]);
  sqliteDb.run('INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, ?, ?, ?)', [
    VEHICLE_ID,
    USER_ID,
    'Toyota',
    'Camry',
    2022,
  ]);
}

beforeEach(() => {
  sqliteDb = new Database(':memory:');
  sqliteDb.run('PRAGMA foreign_keys = ON');
  for (const m of loadMigrations()) {
    applyMigration(sqliteDb, m);
  }
  db = drizzle(sqliteDb, { schema });
  repo = new FinancingRepository(db);
  seedTestData();
});

afterEach(() => {
  sqliteDb.close();
});

const originalAmountCentsArb = fc.integer({ min: 1_000, max: 100_000_000 });

const paymentCentsArb = fc.integer({ min: 1, max: 500_000 });

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

let financingCounter = 0;
let expenseCounter = 0;

function createFinancing(originalAmountCents: number): string {
  const id = `fin-${++financingCounter}`;
  sqliteDb.run(
    `INSERT INTO vehicle_financing (id, vehicle_id, financing_type, provider, original_amount, term_months, start_date, payment_amount, is_active)
     VALUES (?, ?, 'loan', 'TestBank', ?, 60, ?, 50000, 1)`,
    [id, VEHICLE_ID, originalAmountCents, nowSeconds()]
  );
  return id;
}

function createFinancingPayment(amountCents: number, financingId: string): void {
  sqliteDb.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, source_type, source_id)
     VALUES (?, ?, ?, 'financial', ?, ?, 'financing', ?)`,
    [`exp-fp-${++expenseCounter}`, VEHICLE_ID, USER_ID, nowSeconds(), amountCents, financingId]
  );
}

function createNonFinancingExpense(amountCents: number): void {
  sqliteDb.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount)
     VALUES (?, ?, ?, 'fuel', ?, ?)`,
    [`exp-nf-${++expenseCounter}`, VEHICLE_ID, USER_ID, nowSeconds(), amountCents]
  );
}

function clearFinancing(financingId: string): void {
  sqliteDb.run('DELETE FROM expenses WHERE vehicle_id = ?', [VEHICLE_ID]);
  sqliteDb.run('DELETE FROM vehicle_financing WHERE id = ?', [financingId]);
}

const sumCents = (amounts: number[]): number => amounts.reduce((sum, a) => sum + a, 0);

describe('financing balance computation', () => {
  test('balance = max(0, originalAmount - sum of financing payments), in exact cents', async () => {
    await fc.assert(
      fc.asyncProperty(
        originalAmountCentsArb,
        fc.array(paymentCentsArb, { minLength: 0, maxLength: 8 }),
        async (originalAmount, payments) => {
          const financingId = createFinancing(originalAmount);
          for (const payment of payments) {
            createFinancingPayment(payment, financingId);
          }

          const computedBalance = await repo.computeBalance(financingId);

          expect(computedBalance).toBe(Math.max(0, originalAmount - sumCents(payments)));
          clearFinancing(financingId);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('non-financing expenses do not affect balance', async () => {
    await fc.assert(
      fc.asyncProperty(
        originalAmountCentsArb,
        paymentCentsArb,
        paymentCentsArb,
        async (originalAmount, financingPayment, regularExpense) => {
          const financingId = createFinancing(originalAmount);
          createFinancingPayment(financingPayment, financingId);
          createNonFinancingExpense(regularExpense);

          const computedBalance = await repo.computeBalance(financingId);

          expect(computedBalance).toBe(Math.max(0, originalAmount - financingPayment));
          clearFinancing(financingId);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('balance is clamped to 0 when payments exceed original amount', async () => {
    const financingId = createFinancing(100_000);
    createFinancingPayment(60_000, financingId);
    createFinancingPayment(60_000, financingId);

    expect(await repo.computeBalance(financingId)).toBe(0);
  });

  test('balance equals originalAmount when no payments exist', async () => {
    const financingId = createFinancing(2_500_000);
    expect(await repo.computeBalance(financingId)).toBe(2_500_000);
  });

  test('returns 0 for non-existent financing', async () => {
    expect(await repo.computeBalance('non-existent-id')).toBe(0);
  });
});

describe('financing payoff eligibility flag', () => {
  test('eligibleForPayoff is true when the balance is within the payoff threshold, false otherwise', async () => {
    await fc.assert(
      fc.asyncProperty(
        originalAmountCentsArb,
        fc.array(paymentCentsArb, { minLength: 0, maxLength: 8 }),
        async (originalAmount, payments) => {
          const financingId = createFinancing(originalAmount);
          for (const payment of payments) {
            createFinancingPayment(payment, financingId);
          }

          const computedBalance = await repo.computeBalance(financingId);
          const expectedBalance = Math.max(0, originalAmount - sumCents(payments));

          expect(isEligibleForPayoff(computedBalance)).toBe(
            expectedBalance <= PAYOFF_BALANCE_THRESHOLD
          );
          clearFinancing(financingId);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('fully paid off financing is eligible for payoff', async () => {
    const financingId = createFinancing(100_000);
    createFinancingPayment(100_000, financingId);

    const balance = await repo.computeBalance(financingId);
    expect(balance).toBe(0);
    expect(isEligibleForPayoff(balance)).toBe(true);
  });

  test('financing with remaining balance is not eligible', async () => {
    const financingId = createFinancing(1_000_000);
    createFinancingPayment(10_000, financingId);

    const balance = await repo.computeBalance(financingId);
    expect(balance).toBe(990_000);
    expect(isEligibleForPayoff(balance)).toBe(false);
  });

  test('isEligibleForPayoff boundary: exactly the threshold is eligible, one cent above is not', () => {
    expect(isEligibleForPayoff(PAYOFF_BALANCE_THRESHOLD)).toBe(true);
    expect(isEligibleForPayoff(0)).toBe(true);
    expect(isEligibleForPayoff(PAYOFF_BALANCE_THRESHOLD + 1)).toBe(false);
    expect(isEligibleForPayoff(10_000)).toBe(false);
  });

  test('a remaining balance of one dollar or less counts as paid off', () => {
    expect(PAYOFF_BALANCE_THRESHOLD).toBe(100);
    expect(isEligibleForPayoff(100)).toBe(true);
    expect(isEligibleForPayoff(101)).toBe(false);
  });
});

describe('computeBalances (batch) equivalence', () => {
  test('batch result matches per-record computeBalance for many records', async () => {
    // vehicle_financing is unique per vehicle, so each financing record needs its own vehicle.
    let vehicleCounter = 0;
    const newVehicle = (): string => {
      const vid = `v-batch-${++vehicleCounter}`;
      sqliteDb.run('INSERT INTO vehicles (id, user_id, make, model, year) VALUES (?, ?, ?, ?, ?)', [
        vid,
        USER_ID,
        'Honda',
        'Civic',
        2021,
      ]);
      return vid;
    };
    const finOn = (originalAmount: number, vehicleId: string): string => {
      const id = `fin-batch-${++financingCounter}`;
      sqliteDb.run(
        `INSERT INTO vehicle_financing (id, vehicle_id, financing_type, provider, original_amount, term_months, start_date, payment_amount, is_active)
         VALUES (?, ?, 'loan', 'TestBank', ?, 60, ?, 50000, 1)`,
        [id, vehicleId, originalAmount, nowSeconds()]
      );
      return id;
    };
    const payOn = (amount: number, financingId: string, vehicleId: string): void => {
      sqliteDb.run(
        `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, source_type, source_id)
         VALUES (?, ?, ?, 'financial', ?, ?, 'financing', ?)`,
        [`exp-fpb-${++expenseCounter}`, vehicleId, USER_ID, nowSeconds(), amount, financingId]
      );
    };

    const vA = newVehicle();
    const finA = finOn(1_000_000, vA);
    payOn(250_000, finA, vA);
    payOn(250_000, finA, vA);
    const vB = newVehicle();
    const finB = finOn(500_000, vB);
    payOn(500_000, finB, vB);
    const vC = newVehicle();
    const finC = finOn(800_000, vC);
    createNonFinancingExpense(99_900);

    const expectedA = await repo.computeBalance(finA);
    const expectedB = await repo.computeBalance(finB);
    const expectedC = await repo.computeBalance(finC);

    const batch = await repo.computeBalances([finA, finB, finC]);
    expect(batch.get(finA)).toBe(expectedA);
    expect(batch.get(finB)).toBe(expectedB);
    expect(batch.get(finC)).toBe(expectedC);
    expect(batch.get(finA)).toBe(500_000);
    expect(batch.get(finB)).toBe(0);
    expect(batch.get(finC)).toBe(800_000);
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
