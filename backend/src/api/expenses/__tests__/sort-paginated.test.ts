/**
 * Tests for server-side expense sort in findPaginated().
 *
 * Regression guard for the sort/pagination bug: the table sorted client-side over
 * the current 20-row page only, so "sort by amount desc" surfaced the biggest
 * expense ON PAGE 1, not overall (same class as the cycle-10 search fix). Sort now
 * runs in SQL across the whole result set, with an allowlisted column + a stable id
 * tiebreaker so paginated ties don't drop or duplicate rows.
 *
 * Properties verified:
 * - sort by amount spans ALL pages (the global max appears on page 1, not page N)
 * - asc / desc both honored
 * - sort by category works
 * - default (no sortBy) is date desc — backward-compatible
 * - the id tiebreaker makes equal-key ordering stable across pages (no overlap/gap)
 * - user-scoped (sort never leaks another user's rows)
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { applyMigration, loadMigrations } from '../../../db/__tests__/migration-helpers';
import type { AppDatabase } from '../../../db/connection';
import * as schema from '../../../db/schema';
import type { NewExpense } from '../../../db/schema';
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

describe('findPaginated sort', () => {
  test('sort by amount desc surfaces the GLOBAL max on page 1 (not just the page max)', async () => {
    // 25 small filler rows, then one large expense with the OLDEST date so a default
    // date-desc sort would bury it on the last page. Amount-desc must float it to top.
    for (let i = 0; i < 25; i++) {
      await repo.create(input({ expenseAmount: 10 + i, date: new Date(2026, 0, 28 - i) }));
    }
    await repo.create(input({ expenseAmount: 9999.99, date: new Date(2020, 0, 1) }));

    // Default (date desc) page 1 does NOT contain the big old expense.
    const byDate = await repo.findPaginated({ userId: USER_A, limit: 20, offset: 0 });
    expect(byDate.data.some((e) => e.expenseAmount === 9999.99)).toBe(false);

    // Amount desc puts it first, even though it's the oldest row.
    const byAmount = await repo.findPaginated({
      userId: USER_A,
      sortBy: 'amount',
      sortDir: 'desc',
      limit: 20,
      offset: 0,
    });
    expect(byAmount.data[0]?.expenseAmount).toBe(9999.99);
    expect(byAmount.totalCount).toBe(26);
  });

  test('sort by amount asc puts the smallest first', async () => {
    await repo.create(input({ expenseAmount: 500 }));
    await repo.create(input({ expenseAmount: 1.25 }));
    await repo.create(input({ expenseAmount: 75 }));

    const asc = await repo.findPaginated({ userId: USER_A, sortBy: 'amount', sortDir: 'asc' });
    expect(asc.data.map((e) => e.expenseAmount)).toEqual([1.25, 75, 500]);
  });

  test('sort by category orders alphabetically', async () => {
    await repo.create(input({ category: 'maintenance' }));
    await repo.create(input({ category: 'fuel' }));
    await repo.create(input({ category: 'insurance' }));

    const asc = await repo.findPaginated({ userId: USER_A, sortBy: 'category', sortDir: 'asc' });
    expect(asc.data.map((e) => e.category)).toEqual(['fuel', 'insurance', 'maintenance']);
  });

  test('default sort (no sortBy) is date desc — backward compatible', async () => {
    await repo.create(input({ date: new Date(2026, 0, 1), description: 'old' }));
    await repo.create(input({ date: new Date(2026, 5, 1), description: 'new' }));
    await repo.create(input({ date: new Date(2026, 2, 1), description: 'mid' }));

    const def = await repo.findPaginated({ userId: USER_A });
    expect(def.data.map((e) => e.description)).toEqual(['new', 'mid', 'old']);
  });

  test('stable id tiebreaker — paginating equal-amount rows never drops or duplicates', async () => {
    // 30 rows all the SAME amount → ties. Without a deterministic tiebreaker, SQLite
    // could order ties differently per query, so a row could appear on both pages or
    // neither. Page through and assert we see exactly the 30 distinct ids, once each.
    for (let i = 0; i < 30; i++) {
      await repo.create(input({ expenseAmount: 50, description: `tie ${i}` }));
    }
    const opts = { userId: USER_A, sortBy: 'amount' as const, sortDir: 'desc' as const };
    const page1 = await repo.findPaginated({ ...opts, limit: 20, offset: 0 });
    const page2 = await repo.findPaginated({ ...opts, limit: 20, offset: 20 });

    const ids = [...page1.data, ...page2.data].map((e) => e.id);
    const unique = new Set(ids);
    expect(page1.data).toHaveLength(20);
    expect(page2.data).toHaveLength(10);
    expect(unique.size).toBe(30); // no overlap between pages, no gaps
  });

  test('sort is user-scoped — never returns another user\'s rows', async () => {
    await repo.create(input({ userId: USER_A, vehicleId: VEHICLE_A, expenseAmount: 100 }));
    await repo.create(input({ userId: USER_B, vehicleId: VEHICLE_B, expenseAmount: 999 }));

    const a = await repo.findPaginated({ userId: USER_A, sortBy: 'amount', sortDir: 'desc' });
    expect(a.totalCount).toBe(1);
    expect(a.data.every((e) => e.userId === USER_A)).toBe(true);
  });
});

describe('findPaginated category filter', () => {
  test('category filter spans ALL pages, not just the current slice', async () => {
    // 25 fuel filler rows (push past a 20-row page) + 1 maintenance row buried on an
    // OLD date so default date-desc puts it last. A page-local filter (the bug this
    // closes) would miss it on page 1; the SQL filter must find it regardless.
    for (let i = 0; i < 25; i++) {
      await repo.create(input({ category: 'fuel', date: new Date(2026, 0, 27 - i) }));
    }
    await repo.create(
      input({ category: 'maintenance', date: new Date(2020, 0, 1), description: 'rare maint' })
    );

    const res = await repo.findPaginated({
      userId: USER_A,
      category: 'maintenance',
      limit: 20,
      offset: 0,
    });
    expect(res.totalCount).toBe(1);
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.description).toBe('rare maint');
  });

  test('no category filter returns every category', async () => {
    await repo.create(input({ category: 'fuel' }));
    await repo.create(input({ category: 'maintenance' }));
    await repo.create(input({ category: 'misc' }));

    const all = await repo.findPaginated({ userId: USER_A });
    expect(all.totalCount).toBe(3);
  });

  test('category filter composes with search (both applied)', async () => {
    await repo.create(input({ category: 'maintenance', description: 'brake job' }));
    await repo.create(input({ category: 'maintenance', description: 'oil change' }));
    await repo.create(input({ category: 'fuel', description: 'brake cleaner top-up' }));

    // "brake" matches a maintenance row AND a fuel row; category=maintenance narrows it.
    const res = await repo.findPaginated({
      userId: USER_A,
      category: 'maintenance',
      search: 'brake',
    });
    expect(res.totalCount).toBe(1);
    expect(res.data[0]?.description).toBe('brake job');
  });

  test('category filter is user-scoped', async () => {
    await repo.create(input({ userId: USER_A, vehicleId: VEHICLE_A, category: 'maintenance' }));
    await repo.create(input({ userId: USER_B, vehicleId: VEHICLE_B, category: 'maintenance' }));

    const a = await repo.findPaginated({ userId: USER_A, category: 'maintenance' });
    expect(a.totalCount).toBe(1);
    expect(a.data.every((e) => e.userId === USER_A)).toBe(true);
  });
});
