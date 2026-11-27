import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import { openAsyncDatabase } from '../../../db/async-sqlite';
import type { AppDatabase } from '../../../db/connection';
import type { NewExpense } from '../../../db/schema';
import * as schema from '../../../db/schema';
import { ExpenseRepository, parseAmountTerm } from '../repository';

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

describe('findPaginated search', () => {
  test('finds a match that lives beyond the first page', async () => {
    for (let i = 0; i < 25; i++) {
      await repo.create(input({ description: `filler ${i}`, date: new Date(2026, 0, 28 - i) }));
    }
    await repo.create(input({ description: 'rare needle expense', date: new Date(2025, 0, 1) }));

    const unfiltered = await repo.findPaginated({ userId: USER_A, limit: 20, offset: 0 });
    expect(unfiltered.data.some((e) => e.description === 'rare needle expense')).toBe(false);

    const result = await repo.findPaginated({
      userId: USER_A,
      search: 'needle',
      limit: 20,
      offset: 0,
    });
    expect(result.totalCount).toBe(1);
    expect(result.data[0]?.description).toBe('rare needle expense');
  });

  test('search is case-insensitive', async () => {
    await repo.create(input({ description: 'Premium Gasoline' }));

    for (const term of ['premium', 'PREMIUM', 'PrEmIuM']) {
      const result = await repo.findPaginated({ userId: USER_A, search: term });
      expect(result.totalCount).toBe(1);
    }
  });

  test('matches category as well as description', async () => {
    await repo.create(input({ category: 'maintenance', description: 'oil change' }));
    await repo.create(input({ category: 'fuel', description: 'gas' }));

    const byCategory = await repo.findPaginated({ userId: USER_A, search: 'mainten' });
    expect(byCategory.totalCount).toBe(1);
    expect(byCategory.data[0]?.category).toBe('maintenance');
  });

  test("search is user-scoped — never returns another user's rows", async () => {
    await repo.create(input({ userId: USER_A, vehicleId: VEHICLE_A, description: 'shared word' }));
    await repo.create(input({ userId: USER_B, vehicleId: VEHICLE_B, description: 'shared word' }));

    const resultA = await repo.findPaginated({ userId: USER_A, search: 'shared' });
    expect(resultA.totalCount).toBe(1);
    expect(resultA.data.every((e) => e.userId === USER_A)).toBe(true);
  });

  test('no match returns an empty set with totalCount 0', async () => {
    await repo.create(input({ description: 'something' }));
    const result = await repo.findPaginated({ userId: USER_A, search: 'zzz-no-match' });
    expect(result.totalCount).toBe(0);
    expect(result.data).toHaveLength(0);
  });

  test('blank/whitespace search behaves as no filter', async () => {
    await repo.create(input({ description: 'one' }));
    await repo.create(input({ description: 'two' }));

    const blank = await repo.findPaginated({ userId: USER_A, search: '   ' });
    expect(blank.totalCount).toBe(2);
  });

  describe('LIKE-wildcard escaping', () => {
    test('a literal "%" matches only rows containing "%", not every row', async () => {
      await repo.create(input({ description: '50% synthetic oil' }));
      await repo.create(input({ description: '1000 mile service' }));
      await repo.create(input({ description: 'plain gas' }));

      const result = await repo.findPaginated({ userId: USER_A, search: '50%' });
      expect(result.totalCount).toBe(1);
      expect(result.data[0]?.description).toBe('50% synthetic oil');
    });

    test('a literal "_" matches only rows containing "_", not any single char', async () => {
      await repo.create(input({ description: 'oil_change' }));
      await repo.create(input({ description: 'oilXchange' }));

      const result = await repo.findPaginated({ userId: USER_A, search: 'oil_change' });
      expect(result.totalCount).toBe(1);
      expect(result.data[0]?.description).toBe('oil_change');
    });

    test('a bare "%" no longer matches every row', async () => {
      await repo.create(input({ description: 'alpha' }));
      await repo.create(input({ description: 'beta' }));
      await repo.create(input({ description: '100% beef' }));

      const result = await repo.findPaginated({ userId: USER_A, search: '%' });
      expect(result.totalCount).toBe(1);
      expect(result.data[0]?.description).toBe('100% beef');
    });

    test('a backslash in the term is matched literally (escape-char not double-applied)', async () => {
      await repo.create(input({ description: 'path a\\b' }));
      await repo.create(input({ description: 'path ab' }));

      const result = await repo.findPaginated({ userId: USER_A, search: 'a\\b' });
      expect(result.totalCount).toBe(1);
      expect(result.data[0]?.description).toBe('path a\\b');
    });

    test('normal (metacharacter-free) search still matches as a substring', async () => {
      await repo.create(input({ description: 'premium gasoline' }));
      const result = await repo.findPaginated({ userId: USER_A, search: 'premium' });
      expect(result.totalCount).toBe(1);
    });
  });

  describe('fields beyond description and category', () => {
    test('matches the location', async () => {
      await repo.create(input({ description: 'fill-up', location: 'Arco, Main St' }));
      await repo.create(input({ description: 'fill-up', location: 'Shell' }));

      const result = await repo.findPaginated({ userId: USER_A, search: 'arco' });
      expect(result.totalCount).toBe(1);
      expect(result.data[0]?.location).toBe('Arco, Main St');
    });

    test('matches a tag, with LIKE wildcards still escaped', async () => {
      await repo.create(input({ description: 'one', tags: ['road-trip', 'work'] }));
      await repo.create(input({ description: 'two', tags: ['commute'] }));
      await repo.create(input({ description: 'three', tags: ['50%_off'] }));

      expect((await repo.findPaginated({ userId: USER_A, search: 'road' })).totalCount).toBe(1);
      const literal = await repo.findPaginated({ userId: USER_A, search: '%_' });
      expect(literal.totalCount).toBe(1);
      expect(literal.data[0]?.description).toBe('three');
    });

    test("matches the vehicle's nickname, make and model", async () => {
      sqliteDb.run(`UPDATE vehicles SET nickname = 'Daily Driver' WHERE id = '${VEHICLE_A}'`);
      sqliteDb.run(
        `INSERT INTO vehicles (id, user_id, make, model, year) VALUES ('veh-a2', '${USER_A}', 'Tesla', 'Model 3', 2023)`
      );
      await repo.create(input({ description: 'camry gas' }));
      await repo.create(input({ vehicleId: 'veh-a2', description: 'charging' }));

      for (const [term, description] of [
        ['daily', 'camry gas'],
        ['toyota', 'camry gas'],
        ['model 3', 'charging'],
      ] as const) {
        const result = await repo.findPaginated({ userId: USER_A, search: term });
        expect(result.data.map((e) => e.description)).toEqual([description]);
      }
    });

    test("another user's vehicle name never brings in their rows", async () => {
      await repo.create(input({ userId: USER_B, vehicleId: VEHICLE_B, description: 'b row' }));

      const result = await repo.findPaginated({ userId: USER_A, search: 'civic' });
      expect(result.totalCount).toBe(0);
    });

    test('a decimal amount matches that exact amount', async () => {
      await repo.create(input({ description: 'exact', expenseAmount: 4250 }));
      await repo.create(input({ description: 'near', expenseAmount: 4205 }));

      for (const term of ['42.50', '42.5', '$42.50']) {
        const result = await repo.findPaginated({ userId: USER_A, search: term });
        expect(result.data.map((e) => e.description)).toEqual(['exact']);
      }
    });

    test('a whole number matches every amount in that dollar', async () => {
      await repo.create(input({ description: 'a', expenseAmount: 4200 }));
      await repo.create(input({ description: 'b', expenseAmount: 4299 }));
      await repo.create(input({ description: 'c', expenseAmount: 4300 }));
      await repo.create(input({ description: 'd', expenseAmount: 14250 }));

      const result = await repo.findPaginated({ userId: USER_A, search: '42' });
      expect(result.data.map((e) => e.description).sort()).toEqual(['a', 'b']);
    });

    test('a number still matches text that contains it', async () => {
      await repo.create(input({ description: 'Route 42 toll', expenseAmount: 300 }));

      const result = await repo.findPaginated({ userId: USER_A, search: '42' });
      expect(result.data.map((e) => e.description)).toEqual(['Route 42 toll']);
    });
  });
});

describe('parseAmountTerm', () => {
  test.each([
    ['42', { whole: 42 }],
    ['$42.50', { whole: 42, cents: 50 }],
    ['42.5', { whole: 42, cents: 50 }],
    ['€42,50', { whole: 42, cents: 50 }],
    ['42,50 €', { whole: 42, cents: 50 }],
    ['1.234,56', { whole: 1234, cents: 56 }],
    ['1,234.56', { whole: 1234, cents: 56 }],
    ['1 234,56', { whole: 1234, cents: 56 }],
    ['1\u202f234,56', { whole: 1234, cents: 56 }],
    ['1,234', { whole: 1234 }],
    ['£1,234,567', { whole: 1234567 }],
    ['42.505', { whole: 42505 }],
    ['1,23', { whole: 1, cents: 23 }],
  ])('reads %s', (term, expected) => {
    expect(parseAmountTerm(term)).toEqual(expected);
  });

  test.each(['oil', '1,234,56', '1.234.5', '12,34,567', '4,2,5', '$'])(
    'does not read %s as an amount',
    (term) => {
      expect(parseAmountTerm(term)).toBeNull();
    }
  );
});

describe('findPaginated amount search across number formats', () => {
  test('a comma-decimal or grouped amount finds its exact expense', async () => {
    await repo.create(input({ description: 'small', expenseAmount: 4250 }));
    await repo.create(input({ description: 'large', expenseAmount: 123456 }));

    for (const [term, description] of [
      ['€42,50', 'small'],
      ['1.234,56', 'large'],
      ['1,234.56', 'large'],
    ] as const) {
      const result = await repo.findPaginated({ userId: USER_A, search: term });
      expect(result.data.map((e) => e.description)).toEqual([description]);
    }
  });
});
