/**
 * Characterization net for the dialect-aware SQL date/time helpers (C98 guard,
 * C81-coverage-steered: sql-helpers.ts was 33% func, never directly tested — only
 * exercised incidentally through analytics queries).
 *
 * These three helpers are the ONLY SQLite-specific raw SQL in the codebase, and their
 * doc comments record two REAL past bugs, both from the same root cause — the column is
 * a Unix-epoch integer in SECONDS (Drizzle `mode: 'timestamp'`), so every strftime/
 * datetime call MUST pass 'unixepoch' or SQLite reads the integer as a Julian day number:
 *   - omitting it on formatYearMonth collapsed distinct months into bogus GROUP BY
 *     buckets → blank dashboard charts + a $0 monthly average;
 *   - omitting it on extractMonth returned garbage month numbers.
 * This pins the 'unixepoch' invariant directly against real SQLite (a regression that
 * dropped it would change these outputs), executing each fragment via a Drizzle select
 * over a seeded expense — the same shape the analytics queries use.
 *
 * Uses the analytics in-memory DB harness (full schema, seedExpense writes date as
 * Math.floor(getTime()/1000) = seconds, matching the helpers' contract).
 */

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

/** Seed one fuel expense at a known instant and return its id. */
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

describe('sql-helpers — dialect-aware date/time fragments over real SQLite', () => {
  test('extractMonth returns the 1-12 calendar month (unixepoch honored, not a Julian-day garbage value)', async () => {
    // March → 3. A missing 'unixepoch' would read the seconds-epoch as a Julian day
    // and yield a wrong/garbage month, never a clean 3.
    seedAt('e-mar', new Date(2024, 2, 15)); // month index 2 = March
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

  test('formatYearMonth returns YYYY-MM (the GROUP BY key that collapsed to bogus buckets without unixepoch)', async () => {
    seedAt('e-ym', new Date(2024, 2, 15));
    const [row] = await testDb.drizzle
      .select({ ym: formatYearMonth(expenses.date) })
      .from(expenses)
      .where(eq(expenses.id, 'e-ym'));
    expect(row?.ym).toBe('2024-03');
  });

  test('formatYearMonth keeps distinct months in distinct buckets (the real monthly-trend regression)', async () => {
    // Two expenses one month apart MUST produce two different keys — the exact property
    // that broke (everything collapsed into one bogus bucket) when unixepoch was dropped.
    seedAt('e-a', new Date(2024, 0, 10));
    seedAt('e-b', new Date(2024, 1, 10));

    const rows = await testDb.drizzle.select({ ym: formatYearMonth(expenses.date) }).from(expenses);
    const keys = rows.map((r) => r.ym).sort();
    expect(keys).toEqual(['2024-01', '2024-02']);
  });

  test('toDateTimeString returns an ISO-ish datetime (unixepoch honored)', async () => {
    // 2024-03-15 00:00:00 UTC. SQLite datetime(...,'unixepoch') yields 'YYYY-MM-DD HH:MM:SS' in UTC.
    seedAt('e-dt', new Date(Date.UTC(2024, 2, 15, 0, 0, 0)));
    const [row] = await testDb.drizzle
      .select({ dt: toDateTimeString(expenses.date) })
      .from(expenses)
      .where(eq(expenses.id, 'e-dt'));
    expect(row?.dt).toBe('2024-03-15 00:00:00');
  });
});
