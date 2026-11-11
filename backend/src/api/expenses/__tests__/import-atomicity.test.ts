/**
 * CSV-import atomicity: `importExpenses` must commit the whole batch or none of it.
 *
 * bun-sqlite is a SYNCHRONOUS dialect, so an `async` transaction callback returns a pending promise
 * and bun's BEGIN/COMMIT wrap nothing — every `await tx.*` autocommits on its own and a throw
 * mid-loop leaves the earlier rows committed. That is exactly the shape importExpenses had while its
 * doc comment (and the route's) promised "all-or-nothing": a mid-batch failure left a half-imported
 * file behind while the route answered 500, so the user was told the import failed after it partly
 * succeeded. The forcing function here is a vehicle FK violation (expenses.vehicle_id references
 * vehicles(id) with PRAGMA foreign_keys=ON) on the LAST row, after four good rows have inserted.
 *
 * The repository is called DIRECTLY: the route resolves every vehicle by name within the user's own
 * fleet before committing, which is what keeps a bogus id from reaching the insert in production.
 *
 * createTestApp() must run before static config/connection imports — keep this file's imports to the
 * harness + bun:test only.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function expenseCount(): number {
  const r = ctx.sqlite.query('SELECT COUNT(*) as n FROM expenses').get() as { n: number };
  return r.n;
}

describe('importExpenses atomicity', () => {
  test('a mid-batch FK failure rolls back the rows that already inserted', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const { expenseRepository } = await import('../repository');
    type ImportRows = Parameters<typeof expenseRepository.importExpenses>[0];

    const good = [0, 1, 2, 3].map((i) => ({
      vehicleId,
      category: 'misc',
      date: new Date(Date.UTC(2024, 5, 1 + i, 12)),
      expenseAmount: 1000 + i,
      description: `row ${i}`,
    }));
    // The fifth row names a vehicle that does not exist → FK violation on ITS insert, i.e. after the
    // four good inserts in the same transaction.
    const rows = [
      ...good,
      {
        vehicleId: 'nonexistent-vehicle-id',
        category: 'misc',
        date: new Date(Date.UTC(2024, 5, 9, 12)),
        expenseAmount: 9999,
        description: 'the poisoned row',
      },
    ] as ImportRows;

    expect(expenseCount()).toBe(0);

    let threw = false;
    try {
      await expenseRepository.importExpenses(rows, ctx.user.id);
    } catch {
      threw = true;
    }

    expect(threw, 'the FK violation should surface as a throw').toBe(true);
    // THE ATOMICITY ASSERTION: not one of the four good rows survived the failed import.
    expect(expenseCount(), 'the whole batch rolled back — no half-imported file').toBe(0);
  });

  test('a clientId repeated WITHIN one file is counted as a duplicate, not inserted twice', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const { expenseRepository } = await import('../repository');
    type ImportRows = Parameters<typeof expenseRepository.importExpenses>[0];

    // The already-present clientIds are read ONCE before the transaction (a per-row SELECT inside
    // the loop more than doubles the wall time on a 5,000-row file), so the set has to grow as rows
    // insert — otherwise the second copy reaches the (userId, clientId) unique index and takes the
    // whole batch down with it.
    const rows = [
      {
        vehicleId,
        category: 'misc',
        date: new Date(Date.UTC(2024, 5, 1, 12)),
        expenseAmount: 1000,
        clientId: 'repeated-within-file',
      },
      {
        vehicleId,
        category: 'misc',
        date: new Date(Date.UTC(2024, 5, 2, 12)),
        expenseAmount: 2000,
        clientId: 'repeated-within-file',
      },
    ] as ImportRows;

    const first = await expenseRepository.importExpenses(rows, ctx.user.id);
    expect(first).toEqual({ imported: 1, duplicates: 1 });
    expect(expenseCount()).toBe(1);

    // And re-importing the same file is still a no-op (the pre-fetched set).
    const second = await expenseRepository.importExpenses(rows, ctx.user.id);
    expect(second).toEqual({ imported: 0, duplicates: 2 });
    expect(expenseCount()).toBe(1);
  });
});
