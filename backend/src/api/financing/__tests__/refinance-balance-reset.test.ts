/**
 * Refinance-after-payoff balance reset (C240 deep-review guard). The POST create-or-replace financing
 * route REUSES the same financing row when re-financing a vehicle whose prior financing was paid off
 * (isActive=false → true again, the #67/C206 fix). For the new financing's balance to be correct,
 * computeBalance must NOT subtract the OLD loan's payments — which holds ONLY because payoff/DELETE
 * call onFinancingDeactivated → clearSource('financing', id, userId), nulling sourceType+sourceId on
 * the old payment rows so the SUM (filtered by source_id) excludes them.
 *
 * The financing-balance property test covers computeBalance's math but NOT this multi-step interaction
 * (pay down → payoff/clearSource → re-finance reuses row → fresh balance). A regression in either
 * clearSource or the reactivation would silently show a WRONG balance on a re-financed vehicle
 * (NORTH_STAR #1/#2 — a headline $ figure). This pins the invariant against the REAL repo + clearSource
 * over an in-memory DB (the financing-balance.property.test.ts setup).
 */

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
  // The shared expenseRepository singleton binds getDb(); for clearSource over THIS in-memory db we
  // call it on a repo bound to the same connection via the exported class. expenseRepository is a
  // singleton on getDb(), so use a fresh instance bound to our db for the source-clear step.
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_ID}', 'refi@test.com', 'Refi User')`
  );
  sqliteDb.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${VEHICLE_ID}', '${USER_ID}', 'Toyota', 'Camry', 2022)`
  );
  expenseCounter = 0;
});

afterEach(() => sqliteDb.close());

describe('refinance-after-payoff balance reset (#67/C206 + clearSource interaction)', () => {
  test('clearing the old payment source links resets the reused row to a full fresh balance', async () => {
    // 1) Original $20k loan, paid down by $5k + $3k = $8k → balance $12k.
    seedFinancing('fin-refi', 20000);
    seedFinancingPayment(5000, 'fin-refi');
    seedFinancingPayment(3000, 'fin-refi');
    expect(await repo.computeBalance('fin-refi')).toBe(12000);

    // 2) Payoff severs the old payment links (onFinancingDeactivated → clearSource). Use a repo bound
    //    to THIS db (the expenseRepository singleton binds getDb(), not our in-memory connection).
    const localExpenseRepo = new ExpenseRepository(db);
    const cleared = await localExpenseRepo.clearSource('financing', 'fin-refi', USER_ID);
    expect(cleared).toBe(2); // both payment rows severed

    // 3) Re-finance reuses the SAME row with a new originalAmount (the create-or-replace path), now
    //    reactivated. Its balance must be the FULL new amount — the old payments no longer count.
    await repo.update('fin-refi', { originalAmount: 30000, isActive: true, endDate: null });
    expect(await repo.computeBalance('fin-refi')).toBe(30000);
  });

  test('WITHOUT the source-clear, the reused row would wrongly carry the old payments (proves the dependency)', async () => {
    // Same setup but SKIP clearSource — demonstrates exactly the bug the clear prevents: the new
    // $30k loan would show $30k − $8k = $22k, silently crediting the old loan's payments. This pins
    // WHY payoff must clearSource (a regression dropping the hook call resurfaces this).
    seedFinancing('fin-norefi', 20000);
    seedFinancingPayment(5000, 'fin-norefi');
    seedFinancingPayment(3000, 'fin-norefi');

    await repo.update('fin-norefi', { originalAmount: 30000, isActive: true, endDate: null });
    // The old payments STILL count (no clear) → wrong balance. Documents the invariant's necessity.
    expect(await repo.computeBalance('fin-norefi')).toBe(22000);
  });
});
