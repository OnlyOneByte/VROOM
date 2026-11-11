// The date helpers must pass 'unixepoch'. Without it SQLite reads the seconds-epoch column as a Julian day,
// and months collapse into wrong buckets. These tests run the fragments against real SQLite.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  createTestDb,
  seedExpense,
  seedUser,
  seedVehicle,
  type TestDb,
} from '../../api/analytics/__tests__/analytics-test-generators';
import { expenses } from '../schema';
import { extractMonth, formatYearMonth, toDateTimeString } from '../sql-helpers';

let testDb: TestDb;

const USER_ID = 'user-1';
const VEHICLE_ID = 'veh-1';

beforeEach(() => {
  testDb = createTestDb();
  seedUser(testDb.sqlite, { id: USER_ID, email: 'test@test.com', displayName: 'Test' });
  seedVehicle(testDb.sqlite, {
    id: VEHICLE_ID,
    userId: USER_ID,
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
  });
});

afterEach(() => {
  testDb.sqlite.close();
});

function seedAt(id: string, date: Date): string {
  seedExpense(testDb.sqlite, {
    id,
    vehicleId: VEHICLE_ID,
    category: 'fuel',
    expenseAmount: 40,
    date,
    mileage: null,
    volume: 10,
    fuelType: 'Regular',
    missedFillup: false,
  });
  return id;
}

describe('sql-helpers over real SQLite', () => {
  test('extractMonth returns the 1-12 calendar month', async () => {
    seedAt('e-mar', new Date(2024, 2, 15));
    const [row] = await testDb.drizzle
      .select({ month: extractMonth(expenses.date) })
      .from(expenses)
      .where(eq(expenses.id, 'e-mar'));
    expect(row?.month).toBe(3);
  });

  test('extractMonth covers the boundary months (January → 1, December → 12)', async () => {
    seedAt('e-jan', new Date(2024, 0, 1));
    seedAt('e-dec', new Date(2024, 11, 31));

    const [jan] = await testDb.drizzle
      .select({ month: extractMonth(expenses.date) })
      .from(expenses)
      .where(eq(expenses.id, 'e-jan'));
    const [dec] = await testDb.drizzle
      .select({ month: extractMonth(expenses.date) })
      .from(expenses)
      .where(eq(expenses.id, 'e-dec'));

    expect(jan?.month).toBe(1);
    expect(dec?.month).toBe(12);
  });

  test('formatYearMonth returns YYYY-MM', async () => {
    seedAt('e-ym', new Date(2024, 2, 15));
    const [row] = await testDb.drizzle
      .select({ ym: formatYearMonth(expenses.date) })
      .from(expenses)
      .where(eq(expenses.id, 'e-ym'));
    expect(row?.ym).toBe('2024-03');
  });

  test('formatYearMonth keeps distinct months in distinct buckets', async () => {
    seedAt('e-a', new Date(2024, 0, 10));
    seedAt('e-b', new Date(2024, 1, 10));

    const rows = await testDb.drizzle.select({ ym: formatYearMonth(expenses.date) }).from(expenses);
    const keys = rows.map((r) => r.ym).sort();
    expect(keys).toEqual(['2024-01', '2024-02']);
  });

  test('toDateTimeString returns a UTC datetime string', async () => {
    seedAt('e-dt', new Date(Date.UTC(2024, 2, 15, 0, 0, 0)));
    const [row] = await testDb.drizzle
      .select({ dt: toDateTimeString(expenses.date) })
      .from(expenses)
      .where(eq(expenses.id, 'e-dt'));
    expect(row?.dt).toBe('2024-03-15 00:00:00');
  });
});
