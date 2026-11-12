import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import { ExpenseRepository } from '../../expenses/repository';
import { FinancingRepository } from '../repository';

let sqliteDb: Database;
let db: AppDatabase;
let repo: FinancingRepository;

const USER_ID = 'test-user-refi';
const VEHICLE_ID = 'v-refi-1';

let expenseCounter = 0;

function seedFinancing(id: string, originalAmount: number, isActive = true): void {
  sqliteDb.run(
    `INSERT INTO vehicle_financing (id, vehicle_id, financing_type, provider, original_amount, term_months, start_date, payment_amount, is_active)
     VALUES (?, ?, 'loan', 'TestBank', ?, 60, ?, 500, ?)`,
    [id, VEHICLE_ID, originalAmount, Math.floor(Date.now() / 1000), isActive ? 1 : 0]
  );
}

function seedFinancingPayment(amount: number, financingId: string): void {
  sqliteDb.run(
    `INSERT INTO expenses (id, vehicle_id, user_id, category, date, expense_amount, source_type, source_id)
     VALUES (?, ?, ?, 'financial', ?, ?, 'financing', ?)`,
    [
      `exp-${++expenseCounter}`,
      VEHICLE_ID,
      USER_ID,
      Math.floor(Date.now() / 1000),
      amount,
      financingId,
    ]
  );
}

beforeEach(() => {
  sqliteDb = new Database(':memory:');
  sqliteDb.run('PRAGMA foreign_keys = ON');
  for (const m of loadMigrations()) applyMigration(sqliteDb, m);
  db = drizzle(sqliteDb, { schema });
  repo = new FinancingRepository(db);
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_ID}', 'refi@test.com', 'Refi User')`
  );
  sqliteDb.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${VEHICLE_ID}', '${USER_ID}', 'Toyota', 'Camry', 2022)`
  );
  expenseCounter = 0;
});

afterEach(() => sqliteDb.close());

describe('refinance after payoff resets the balance', () => {
  test('clearing the old payment source links resets the reused row to a full fresh balance', async () => {
    seedFinancing('fin-refi', 20000);
    seedFinancingPayment(5000, 'fin-refi');
    seedFinancingPayment(3000, 'fin-refi');
    expect(await repo.computeBalance('fin-refi')).toBe(12000);

    const localExpenseRepo = new ExpenseRepository(db);
    const cleared = await localExpenseRepo.clearSource('financing', 'fin-refi', USER_ID);
    expect(cleared).toBe(2);

    await repo.update('fin-refi', { originalAmount: 30000, isActive: true, endDate: null });
    expect(await repo.computeBalance('fin-refi')).toBe(30000);
  });

  test('WITHOUT the source-clear, the reused row would wrongly carry the old payments (proves the dependency)', async () => {
    seedFinancing('fin-norefi', 20000);
    seedFinancingPayment(5000, 'fin-norefi');
    seedFinancingPayment(3000, 'fin-norefi');

    await repo.update('fin-norefi', { originalAmount: 30000, isActive: true, endDate: null });
    expect(await repo.computeBalance('fin-norefi')).toBe(22000);
  });
});
