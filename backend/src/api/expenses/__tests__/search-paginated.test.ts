/**
 * Tests for server-side expense search in findPaginated().
 *
 * Regression guard for the search/pagination UX bug: search was applied
 * client-side over the current 20-row page only, so a term that matched an
 * expense on page 2+ returned zero results. Search now runs in SQL across the
 * whole result set.
 *
 * Properties verified:
 * - search matches across ALL pages (not just the first page)
 * - case-insensitive
 * - matches description OR category
 * - user-scoped (never leaks another user's rows)
 * - totalCount reflects the filtered set
 */

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

describe('findPaginated search', () => {
  test('finds a match that lives beyond the first page', async () => {
    // 25 filler rows so the match is pushed past a 20-row first page. Rows are
    // ordered by date desc, so make the match the OLDEST row.
    for (let i = 0; i < 25; i++) {
      await repo.create(input({ description: `filler ${i}`, date: new Date(2026, 0, 28 - i) }));
    }
    await repo.create(input({ description: 'rare needle expense', date: new Date(2025, 0, 1) }));

    // Without search, page 1 (limit 20) would NOT contain the needle.
    const unfiltered = await repo.findPaginated({ userId: USER_A, limit: 20, offset: 0 });
    expect(unfiltered.data.some((e) => e.description === 'rare needle expense')).toBe(false);

    // With search, it is found regardless of page.
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

  // bug #41: LIKE metacharacters in the search term must be treated as LITERALS, not wildcards.
  describe('LIKE-wildcard escaping (#41)', () => {
    test('a literal "%" matches only rows containing "%", not every row', async () => {
      await repo.create(input({ description: '50% synthetic oil' }));
      await repo.create(input({ description: '1000 mile service' }));
      await repo.create(input({ description: 'plain gas' }));

      const result = await repo.findPaginated({ userId: USER_A, search: '50%' });
      // Pre-fix `%50%%` matched "1000 mile service" (contains "50") too → 2. Now only the literal.
      expect(result.totalCount).toBe(1);
      expect(result.data[0]?.description).toBe('50% synthetic oil');
    });

    test('a literal "_" matches only rows containing "_", not any single char', async () => {
      await repo.create(input({ description: 'oil_change' }));
      await repo.create(input({ description: 'oilXchange' }));

      const result = await repo.findPaginated({ userId: USER_A, search: 'oil_change' });
      // Pre-fix `_` was "any one char" → matched "oilXchange" too. Now the underscore is literal.
      expect(result.totalCount).toBe(1);
      expect(result.data[0]?.description).toBe('oil_change');
    });

    test('a bare "%" no longer matches every row', async () => {
      await repo.create(input({ description: 'alpha' }));
      await repo.create(input({ description: 'beta' }));
      await repo.create(input({ description: '100% beef' }));

      const result = await repo.findPaginated({ userId: USER_A, search: '%' });
      // Pre-fix `%%%` matched all 3. Now only the row with a literal "%".
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
});
