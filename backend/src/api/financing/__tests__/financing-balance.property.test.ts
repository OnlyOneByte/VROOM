import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fc from 'fast-check';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import {
  amortizedBalance,
  type DatedPayment,
  elapsedMonths,
  FinancingRepository,
  isEligibleForPayoff,
  PAYOFF_BALANCE_THRESHOLD,
} from '../repository';

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
  test('a loan with no APR: balance = max(0, originalAmount - sum of payments), in exact cents', async () => {
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

const LOAN_START = new Date('2024-01-15T12:00:00Z');

function monthlyPayments(count: number, amount: number): DatedPayment[] {
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2024, i + 1, 15, 12)),
    amount,
  }));
}

function closedFormBalance(principal: number, annualRate: number, payment: number, k: number) {
  const r = annualRate / 100 / 12;
  const growth = (1 + r) ** k;
  return principal * growth - (payment * (growth - 1)) / r;
}

const loan = (originalAmount: number, apr: number | null) => ({
  originalAmount,
  apr,
  startDate: LOAN_START,
  financingType: 'loan',
});

describe('amortized loan balance', () => {
  test('matches the $30,000 / 6% / 60-month amortization table', () => {
    const terms = loan(3_000_000, 6);
    expect(amortizedBalance(terms, monthlyPayments(30, 57_998))).toBe(1_612_025);
    expect(amortizedBalance(terms, monthlyPayments(52, 57_998))).toBe(453_743);
    expect(amortizedBalance(terms, monthlyPayments(60, 57_998))).toBe(29);
  });

  test('tracks the closed-form amortization balance to within a few cents', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 500_000, max: 10_000_000 }),
        fc.integer({ min: 1, max: 2_500 }).map((bp) => bp / 100),
        fc.integer({ min: 12, max: 84 }),
        fc.integer({ min: 0, max: 50_000 }),
        (principal, apr, term, extra) => {
          const r = apr / 100 / 12;
          const payment = Math.round((principal * r) / (1 - (1 + r) ** -term)) + extra;
          for (const k of [1, 6, 12]) {
            const expected = closedFormBalance(principal, apr, payment, k);
            if (expected <= 0) continue;
            const actual = amortizedBalance(loan(principal, apr), monthlyPayments(k, payment));
            expect(Math.abs(actual - expected)).toBeLessThanOrEqual(k);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  test('a recurring extra payment follows the accelerated amortization table', () => {
    const terms = loan(3_000_000, 6);
    const balance = amortizedBalance(terms, monthlyPayments(24, 67_998));
    expect(Math.abs(balance - closedFormBalance(3_000_000, 6, 67_998, 24))).toBeLessThanOrEqual(24);
    expect(balance).toBeLessThan(amortizedBalance(terms, monthlyPayments(24, 57_998)) - 240_000);
  });

  test('a lump-sum extra payment logged on a payment date is all principal', () => {
    const terms = loan(3_000_000, 6);
    const regular = monthlyPayments(12, 57_998);
    const withLump = [...regular, { date: regular[11].date, amount: 100_000 }];
    expect(amortizedBalance(terms, withLump)).toBe(amortizedBalance(terms, regular) - 100_000);
  });

  test('a missed month accrues two months of interest on the next payment', () => {
    const terms = loan(1_200_000, 12);
    const balance = amortizedBalance(terms, [
      { date: new Date('2024-02-15T12:00:00Z'), amount: 12_000 },
      { date: new Date('2024-04-15T12:00:00Z'), amount: 50_000 },
    ]);
    expect(balance).toBe(1_200_000 + 2 * 12_000 - 50_000);
  });

  test('a loan added years after its start accrues interest from one month before the first logged payment', () => {
    const terms = { ...loan(2_000_000, 4.5), startDate: new Date('2020-03-15T12:00:00Z') };
    const balance = amortizedBalance(terms, [
      { date: new Date('2026-11-15T12:00:00Z'), amount: 37_286 },
    ]);
    expect(balance).toBe(2_000_000 + 7_500 - 37_286);
  });

  test('a payment smaller than the interest grows the balance', () => {
    const terms = loan(1_000_000, 12);
    expect(amortizedBalance(terms, monthlyPayments(1, 5_000))).toBe(1_005_000);
  });

  test('zero-interest loans and leases amortize as original minus payments', () => {
    const payments = monthlyPayments(10, 100_000);
    expect(amortizedBalance(loan(1_200_000, 0), payments)).toBe(200_000);
    expect(amortizedBalance(loan(1_200_000, null), payments)).toBe(200_000);
    expect(amortizedBalance({ ...loan(1_200_000, 6), financingType: 'lease' }, payments)).toBe(
      200_000
    );
  });

  test('payment order is by date, not insertion order', () => {
    const terms = loan(3_000_000, 6);
    const payments = monthlyPayments(12, 57_998);
    expect(amortizedBalance(terms, [...payments].reverse())).toBe(
      amortizedBalance(terms, payments)
    );
  });

  test('computeBalance amortizes stored payments by date', async () => {
    const id = 'fin-amortized';
    sqliteDb.run(
      `INSERT INTO vehicle_financing (id, vehicle_id, financing_type, provider, original_amount, apr, term_months, start_date, payment_amount, is_active)
       VALUES (?, ?, 'loan', 'TestBank', 3000000, 6, 60, ?, 57998, 1)`,
      [id, VEHICLE_ID, Math.floor(LOAN_START.getTime() / 1000)]
    );
    for (const payment of monthlyPayments(30, 57_998)) {
      sqliteDb.run(
        `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, source_type, source_id)
         VALUES (?, ?, ?, 'financial', ?, ?, 'financing', ?)`,
        [
          `exp-am-${++expenseCounter}`,
          VEHICLE_ID,
          USER_ID,
          Math.floor(payment.date.getTime() / 1000),
          payment.amount,
          id,
        ]
      );
    }
    expect(await repo.computeBalance(id)).toBe(1_612_025);
  });
});

describe('elapsedMonths', () => {
  test('counts whole calendar months and day-fractions, clamping month ends', () => {
    expect(elapsedMonths(new Date('2024-01-15'), new Date('2024-03-15'))).toBe(2);
    expect(elapsedMonths(new Date('2024-01-31'), new Date('2024-02-29'))).toBe(1);
    expect(elapsedMonths(new Date('2024-01-15'), new Date('2024-01-30'))).toBeCloseTo(15 / 31);
    expect(elapsedMonths(new Date('2024-01-15'), new Date('2023-12-01'))).toBe(0);
  });

  test('ignores the time of day so local-noon dates land on whole months', () => {
    expect(elapsedMonths(new Date('2024-03-01T17:00:00Z'), new Date('2024-04-01T16:00:00Z'))).toBe(
      1
    );
  });
});
