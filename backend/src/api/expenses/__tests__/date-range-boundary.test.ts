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
const VEHICLE_A = 'veh-a';

function seed(): void {
  sqliteDb.run(
    `INSERT INTO users (id, email, display_name) VALUES ('${USER_A}', 'a@test.com', 'A')`
  );
  sqliteDb.run(
    `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('${VEHICLE_A}', '${USER_A}', 'Toyota', 'Camry', 2022)`
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
    date: new Date(2026, 0, 15),
    expenseAmount: 42.5,
    ...overrides,
  } as NewExpense;
}

describe('findPaginated endDate boundary includes the whole end day', () => {
  test('an afternoon expense on the endDate day is included', async () => {
    await repo.create(
      input({ description: 'mar 31 afternoon', date: new Date(2026, 2, 31, 14, 0) })
    );

    const result = await repo.findPaginated({
      userId: USER_A,
      startDate: new Date(2026, 2, 1),
      endDate: new Date(2026, 2, 31),
    });

    expect(result.totalCount).toBe(1);
    expect(result.data[0]?.description).toBe('mar 31 afternoon');
  });

  test('the last instant of the endDate day (23:59:59.999) is included; the next day is excluded', async () => {
    await repo.create(
      input({ description: 'edge last ms', date: new Date(2026, 2, 31, 23, 59, 59, 999) })
    );
    await repo.create(
      input({ description: 'next day midnight', date: new Date(2026, 3, 1, 0, 0, 0, 0) })
    );

    const result = await repo.findPaginated({
      userId: USER_A,
      endDate: new Date(2026, 2, 31),
    });

    expect(result.totalCount).toBe(1);
    expect(result.data[0]?.description).toBe('edge last ms');
  });

  test('startDate still excludes the day before (lower bound unaffected by the fix)', async () => {
    await repo.create(input({ description: 'feb 28', date: new Date(2026, 1, 28, 12, 0) }));
    await repo.create(input({ description: 'mar 1 morning', date: new Date(2026, 2, 1, 8, 0) }));

    const result = await repo.findPaginated({
      userId: USER_A,
      startDate: new Date(2026, 2, 1),
      endDate: new Date(2026, 2, 31),
    });

    expect(result.totalCount).toBe(1);
    expect(result.data[0]?.description).toBe('mar 1 morning');
  });

  test('a non-midnight endDate (deliberate full timestamp) is honored verbatim, not extended', async () => {
    await repo.create(input({ description: 'before noon', date: new Date(2026, 2, 31, 9, 0) }));
    await repo.create(input({ description: 'after noon', date: new Date(2026, 2, 31, 15, 0) }));

    const result = await repo.findPaginated({
      userId: USER_A,
      endDate: new Date(2026, 2, 31, 12, 0),
    });

    expect(result.totalCount).toBe(1);
    expect(result.data[0]?.description).toBe('before noon');
  });

  test('findAll (CSV export path) shares the same inclusive boundary', async () => {
    await repo.create(
      input({ description: 'export mar 31 pm', date: new Date(2026, 2, 31, 16, 30) })
    );

    const rows = await repo.findAll({
      userId: USER_A,
      startDate: new Date(2026, 2, 1),
      endDate: new Date(2026, 2, 31),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.description).toBe('export mar 31 pm');
  });
});

describe('date-only filters follow the client time zone', () => {
  const descriptions = async (filters: { startDate: Date; endDate: Date; timeZone: string }) =>
    (await repo.findPaginated({ userId: USER_A, ...filters })).data
      .map((e) => e.description)
      .sort();

  test('UTC+13: the user’s whole day is included and the neighbouring days are not', async () => {
    await repo.create(input({ description: 'day before', date: new Date('2026-03-30T10:30:00Z') }));
    await repo.create(input({ description: 'noon', date: new Date('2026-03-30T23:00:00Z') }));
    await repo.create(input({ description: 'late', date: new Date('2026-03-31T10:59:00Z') }));
    await repo.create(input({ description: 'day after', date: new Date('2026-03-31T11:30:00Z') }));

    const got = await descriptions({
      startDate: new Date('2026-03-31'),
      endDate: new Date('2026-03-31'),
      timeZone: 'Pacific/Tongatapu',
    });
    expect(got).toEqual(['late', 'noon']);
  });

  test('UTC-10: an evening expense on the last filtered day is included', async () => {
    await repo.create(input({ description: 'evening', date: new Date('2026-04-01T06:00:00Z') }));
    await repo.create(input({ description: 'next day', date: new Date('2026-04-01T10:30:00Z') }));

    const got = await descriptions({
      startDate: new Date('2026-03-01'),
      endDate: new Date('2026-03-31'),
      timeZone: 'Pacific/Honolulu',
    });
    expect(got).toEqual(['evening']);
  });

  test('a full timestamp is honoured verbatim', async () => {
    await repo.create(input({ description: 'before', date: new Date('2026-03-31T09:00:00Z') }));
    await repo.create(input({ description: 'after', date: new Date('2026-03-31T11:00:00Z') }));

    const got = await descriptions({
      startDate: new Date('2026-03-31T08:00:00Z'),
      endDate: new Date('2026-03-31T10:00:00Z'),
      timeZone: 'Pacific/Tongatapu',
    });
    expect(got).toEqual(['before']);
  });
});
