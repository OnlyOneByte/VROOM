import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import type { NewExpense } from '../../../db/schema';
import * as schema from '../../../db/schema';
import { ExpenseRepository } from '../repository';

let sqliteDb: Database;
let db: AppDatabase;
let repo: ExpenseRepository;

const USER_A = 'user-a';
const USER_B = 'user-b';
const VEHICLE_A = 'veh-a';
const VEHICLE_B = 'veh-b';

function seed(): void {
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_A}', 'a@test.com', 'A'), ('${USER_B}', 'b@test.com', 'B')`
  );
  sqliteDb.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${VEHICLE_A}', '${USER_A}', 'Toyota', 'Camry', 2022), ('${VEHICLE_B}', '${USER_B}', 'Honda', 'Civic', 2021)`
  );
}

beforeEach(() => {
  sqliteDb = new Database(':memory:');
  sqliteDb.run('PRAGMA foreign_keys = ON');
  for (const m of loadMigrations()) applyMigration(sqliteDb, m);
  db = drizzle(sqliteDb, { schema });
  repo = new ExpenseRepository(db);
  seed();
});

afterEach(() => {
  sqliteDb.close();
});

function input(overrides: Partial<NewExpense>): NewExpense {
  return {
    vehicleId: VEHICLE_A,
    userId: USER_A,
    category: 'fuel',
    date: new Date('2026-01-15'),
    expenseAmount: 42.5,
    ...overrides,
  } as NewExpense;
}

describe('getMonthlyTotals', () => {
  test('totals every matching expense by local month, newest month first', async () => {
    await repo.create(input({ expenseAmount: 1000, date: new Date('2026-01-05T12:00:00Z') }));
    await repo.create(input({ expenseAmount: 250, date: new Date('2026-01-20T12:00:00Z') }));
    await repo.create(input({ expenseAmount: 4000, date: new Date('2026-03-02T12:00:00Z') }));

    expect(await repo.getMonthlyTotals({ userId: USER_A })).toEqual([
      { month: '2026-03', amount: 4000, count: 1 },
      { month: '2026-01', amount: 1250, count: 2 },
    ]);
  });

  test("uses the caller's time zone for the month edge", async () => {
    await repo.create(input({ expenseAmount: 500, date: new Date('2026-02-01T03:00:00Z') }));

    expect(await repo.getMonthlyTotals({ userId: USER_A, timeZone: 'UTC' })).toEqual([
      { month: '2026-02', amount: 500, count: 1 },
    ]);
    expect(
      await repo.getMonthlyTotals({ userId: USER_A, timeZone: 'America/Los_Angeles' })
    ).toEqual([{ month: '2026-01', amount: 500, count: 1 }]);
  });

  test('applies the same filters as the list, across every page', async () => {
    for (let i = 0; i < 30; i++) {
      await repo.create(
        input({ expenseAmount: 100, description: 'fill-up', date: new Date(2026, 4, 1 + i, 12) })
      );
    }
    await repo.create(
      input({ expenseAmount: 9999, category: 'maintenance', description: 'tyres' })
    );

    const fuel = await repo.getMonthlyTotals({ userId: USER_A, category: 'fuel', search: 'fill' });
    expect(fuel).toEqual([{ month: '2026-05', amount: 3000, count: 30 }]);
  });

  test("never counts another user's expenses", async () => {
    await repo.create(input({ userId: USER_B, vehicleId: VEHICLE_B, expenseAmount: 777 }));

    expect(await repo.getMonthlyTotals({ userId: USER_A })).toEqual([]);
  });
});
