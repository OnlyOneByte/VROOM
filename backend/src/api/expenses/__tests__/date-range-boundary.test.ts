/**
 * Regression guard (C139, bug #39) for the expense-list date-range END boundary.
 *
 * The UI DatePicker sends `endDate` as a date-only `YYYY-MM-DD`, which `z.coerce.date()` turns into
 * LOCAL midnight (00:00:00 — the START of that day). A bare `lte(expenses.date, midnight)` then drops
 * every same-day expense NOT stamped at exactly midnight, so a "through Mar 31" filter silently hides
 * all of Mar 31 (the C6/C61/C103 local-vs-UTC boundary class). The fix treats a midnight `endDate` as
 * INCLUSIVE of the whole local day (extends to 23:59:59.999 local); a non-midnight `endDate` is
 * honored verbatim. This builder backs BOTH the list (findPaginated) and the CSV export (findAll), so
 * the guard pins the most-used surface + keeps list==export.
 *
 * Dates are built with `new Date(Y, M, D, …)` (LOCAL) so the test is host-independent — the picked
 * day and the seeded timestamps share whatever the host TZ is (sidesteps the C77 UTC-host vacuity trap).
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

describe('findPaginated endDate boundary (bug #39 same-day inclusive)', () => {
  test('an afternoon expense on the endDate day is INCLUDED (the regression)', async () => {
    // Picked range: Mar 1 → Mar 31. Expense stamped Mar 31, 2:00pm LOCAL.
    await repo.create(
      input({ description: 'mar 31 afternoon', date: new Date(2026, 2, 31, 14, 0) })
    );

    const result = await repo.findPaginated({
      userId: USER_A,
      // date-only picker values → local midnight, exactly what z.coerce.date() yields server-side.
      startDate: new Date(2026, 2, 1),
      endDate: new Date(2026, 2, 31),
    });

    // Pre-fix this was 0 — the 2pm timestamp exceeded the midnight upper bound and was dropped.
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
    // If a caller passes an explicit mid-day upper bound, an expense later that same day must NOT match.
    await repo.create(input({ description: 'before noon', date: new Date(2026, 2, 31, 9, 0) }));
    await repo.create(input({ description: 'after noon', date: new Date(2026, 2, 31, 15, 0) }));

    const result = await repo.findPaginated({
      userId: USER_A,
      endDate: new Date(2026, 2, 31, 12, 0), // noon — not midnight, so NOT day-extended
    });

    expect(result.totalCount).toBe(1);
    expect(result.data[0]?.description).toBe('before noon');
  });

  test('findAll (CSV export path) shares the same inclusive boundary', async () => {
    // The export must surface exactly what the filtered table shows (list==export invariant).
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
