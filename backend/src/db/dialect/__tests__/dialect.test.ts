import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import {
  createTestDb,
  seedExpense,
  seedUser,
  seedVehicle,
  type TestDb,
} from '../../../api/analytics/__tests__/analytics-test-generators';
import { openAsyncDatabase } from '../../async-sqlite';
import { expenses } from '../../schema';
import {
  classifyDbError,
  countNum,
  extractMonth,
  formatYearMonth,
  isDriverError,
  jsonArrayIsEmpty,
  jsonArraySome,
  jsonMergePatch,
  looksLikeDriverError,
  sqlFalse,
  sqlTrue,
  sumNum,
  toDateTimeString,
  typedParam,
} from '..';

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

describe('portable fragments over real SQLite', () => {
  function tag(id: string, tags: string[] | null): void {
    testDb.sqlite.run('UPDATE expenses SET tags = ? WHERE id = ?', [
      tags === null ? null : JSON.stringify(tags),
      id,
    ]);
  }

  async function idsWhere(where: ReturnType<typeof sql>): Promise<string[]> {
    const rows = await testDb.drizzle.select({ id: expenses.id }).from(expenses).where(where);
    return rows.map((r) => r.id).sort();
  }

  test('sqlTrue() and sqlFalse() keep or drop every row', async () => {
    seedAt('e-1', new Date(2024, 0, 1));
    expect(await idsWhere(sqlTrue())).toEqual(['e-1']);
    expect(await idsWhere(sqlFalse())).toEqual([]);
  });

  test('jsonArraySome and jsonArrayIsEmpty read a JSON array column', async () => {
    tag(seedAt('e-road', new Date(2024, 0, 1)), ['road trip', 'work']);
    tag(seedAt('e-none', new Date(2024, 0, 2)), []);
    tag(seedAt('e-null', new Date(2024, 0, 3)), null);

    expect(await idsWhere(jsonArraySome(expenses.tags, (el) => sql`${el} = ${'work'}`))).toEqual([
      'e-road',
    ]);
    expect(await idsWhere(jsonArraySome(expenses.tags, (el) => sql`${el} = ${'home'}`))).toEqual(
      []
    );
    expect(await idsWhere(jsonArrayIsEmpty(expenses.tags))).toEqual(['e-none', 'e-null']);
  });

  test('jsonMergePatch merges nested objects and deletes keys set to null', () => {
    const [row] = testDb.drizzle.all<{ merged: string; fromNull: string }>(
      sql`SELECT ${jsonMergePatch(sql`'{"a":{"b":1,"c":2},"d":1}'`, { a: { b: 3 }, d: null })} AS merged,
        ${jsonMergePatch(sql`NULL`, { x: 1 })} AS fromNull`
    );
    expect(JSON.parse(String(row?.merged))).toEqual({ a: { b: 3, c: 2 } });
    expect(JSON.parse(String(row?.fromNull))).toEqual({ x: 1 });
  });

  test('countNum and sumNum return numbers, and sumNum of no rows is 0', async () => {
    seedAt('e-a', new Date(2024, 0, 1));
    seedAt('e-b', new Date(2024, 0, 2));
    const [all] = await testDb.drizzle
      .select({ n: countNum(), total: sumNum(expenses.expenseAmount) })
      .from(expenses);
    expect(all).toEqual({ n: 2, total: 80 });
    const [none] = await testDb.drizzle
      .select({ n: countNum(), total: sumNum(expenses.expenseAmount) })
      .from(expenses)
      .where(sqlFalse());
    expect(none).toEqual({ n: 0, total: 0 });
  });
});

describe('classifyDbError over real SQLite errors', () => {
  function errorOf(statement: string): unknown {
    try {
      testDb.sqlite.run(statement);
    } catch (error) {
      return error;
    }
    throw new Error(`expected "${statement}" to fail`);
  }

  test('names unique, foreign-key and not-null violations, through a wrapping error too', () => {
    const unique = errorOf(
      `INSERT INTO users (id, email, display_name) VALUES ('${USER_ID}', 'x@x', 'X')`
    );
    expect(classifyDbError(unique)).toBe('unique');
    expect(classifyDbError(new Error('wrapped', { cause: unique }))).toBe('unique');
    expect(
      classifyDbError(
        errorOf(
          "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v2', 'nobody', 'A', 'B', 2020)"
        )
      )
    ).toBe('foreign_key');
    expect(
      classifyDbError(
        errorOf("INSERT INTO users (id, email, display_name) VALUES ('u2', NULL, 'X')")
      )
    ).toBe('not_null');
  });

  test('the async session wraps the driver error, and it is still classified', async () => {
    const asyncDb = openAsyncDatabase(testDb.sqlite).db;
    const failure = (statement: string) =>
      asyncDb.run(sql.raw(statement)).then(
        () => null,
        (e) => e
      );
    expect(
      classifyDbError(
        await failure(
          "INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('v3', 'nobody', 'A', 'B', 2020)"
        )
      )
    ).toBe('foreign_key');
    expect(
      classifyDbError(
        await failure("INSERT INTO users (id, email, display_name) VALUES ('u3', NULL, 'X')")
      )
    ).toBe('not_null');
  });

  test('anything else is not a classified database error', () => {
    expect(classifyDbError(new Error('plain failure'))).toBeNull();
    expect(classifyDbError('a string')).toBeNull();
    expect(isDriverError(new Error('plain failure'))).toBe(false);
    expect(
      isDriverError(
        errorOf(`INSERT INTO users (id, email, display_name) VALUES ('${USER_ID}', 'y@y', 'Y')`)
      )
    ).toBe(true);
    expect(looksLikeDriverError(new Error('SQLITE_BUSY: database is locked'))).toBe(true);
  });
});

describe('typedParam', () => {
  test('casts a bound value, and refuses a fractional bigint rather than truncating it', () => {
    const [row] = testDb.drizzle.all<{ n: number; r: number; t: string }>(
      sql`SELECT ${typedParam(1795000000, 'bigint')} AS n, ${typedParam(1, 'real')} AS r, ${typedParam(7, 'text')} AS t`
    );
    expect(row).toEqual({ n: 1795000000, r: 1, t: '7' });
    expect(() => typedParam(1.5, 'bigint')).toThrow(TypeError);
  });
});
