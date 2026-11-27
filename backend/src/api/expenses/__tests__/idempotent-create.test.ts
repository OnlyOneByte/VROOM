import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import { openAsyncDatabase } from '../../../db/async-sqlite';
import type { AppDatabase } from '../../../db/connection';
import type { NewExpense } from '../../../db/schema';
import * as schema from '../../../db/schema';
import { expenses } from '../../../db/schema';
import { ConflictError } from '../../../errors';
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
  repo = new ExpenseRepository(openAsyncDatabase(db.$client).db);
  seed();
});

afterEach(() => {
  sqliteDb.close();
});

function expenseInput(overrides: Partial<NewExpense>): NewExpense {
  return {
    vehicleId: VEHICLE_A,
    userId: USER_A,
    category: 'fuel',
    date: new Date('2026-01-15'),
    expenseAmount: 42.5,
    ...overrides,
  } as NewExpense;
}

function countRows(): number {
  return db.select().from(expenses).all().length;
}

describe('createIdempotent', () => {
  test('same (userId, clientId) twice creates exactly one row', async () => {
    const input = expenseInput({ clientId: 'client-key-1' });

    const first = await repo.createIdempotent(input);
    const second = await repo.createIdempotent(input);

    expect(second.id).toBe(first.id);
    expect(countRows()).toBe(1);
  });

  test('second call returns the original row, not a mutated copy', async () => {
    const first = await repo.createIdempotent(
      expenseInput({ clientId: 'client-key-2', expenseAmount: 10 })
    );
    const second = await repo.createIdempotent(
      expenseInput({ clientId: 'client-key-2', expenseAmount: 999 })
    );

    expect(second.id).toBe(first.id);
    expect(second.expenseAmount).toBe(10);
    expect(countRows()).toBe(1);
  });

  test('same clientId across different users yields two distinct rows', async () => {
    const a = await repo.createIdempotent(
      expenseInput({ userId: USER_A, vehicleId: VEHICLE_A, clientId: 'shared-key' })
    );
    const b = await repo.createIdempotent(
      expenseInput({ userId: USER_B, vehicleId: VEHICLE_B, clientId: 'shared-key' })
    );

    expect(b.id).not.toBe(a.id);
    expect(countRows()).toBe(2);
  });

  test('no clientId falls back to plain create (no dedup)', async () => {
    await repo.createIdempotent(expenseInput({}));
    await repo.createIdempotent(expenseInput({}));

    expect(countRows()).toBe(2);
  });

  test('findByClientId is user-scoped', async () => {
    await repo.createIdempotent(
      expenseInput({ userId: USER_A, vehicleId: VEHICLE_A, clientId: 'scoped-key' })
    );

    expect(await repo.findByClientId('scoped-key', USER_A)).not.toBeNull();
    expect(await repo.findByClientId('scoped-key', USER_B)).toBeNull();
  });
});

describe('createIdempotent replay scoping', () => {
  test('a clientId already saved on another of the same user vehicles is a conflict, not that row', async () => {
    sqliteDb.run(
      `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('veh-a2', '${USER_A}', 'Mazda', 'CX-5', 2023)`
    );
    await repo.createIdempotent(expenseInput({ clientId: 'scope-1' }));

    await expect(
      repo.createIdempotent(expenseInput({ clientId: 'scope-1', vehicleId: 'veh-a2' }))
    ).rejects.toThrow(ConflictError);
    expect(await repo.findReplay('scope-1', USER_A, VEHICLE_A)).not.toBeNull();
    await expect(repo.findReplay('scope-1', USER_A, 'veh-a2')).rejects.toThrow(ConflictError);
    expect(countRows()).toBe(1);
  });
});

describe('concurrent writes check the odometer against each other', () => {
  test('of two readings that conflict, sent at once, the second is refused', async () => {
    const check = (mileage: number, date: Date) => ({
      vehicleId: VEHICLE_A,
      mileage,
      date,
      timeZone: 'UTC',
    });
    const earlier = new Date('2026-01-10T12:00:00Z');
    const later = new Date('2026-01-20T12:00:00Z');
    const results = await Promise.allSettled([
      repo.createIdempotent(expenseInput({ date: earlier, mileage: 5000 }), check(5000, earlier)),
      repo.createIdempotent(expenseInput({ date: later, mileage: 4000 }), check(4000, later)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(countRows()).toBe(1);
  });
});
