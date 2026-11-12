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
    expect(expenseCount(), 'the whole batch rolled back — no half-imported file').toBe(0);
  });

  test('a clientId repeated WITHIN one file is counted as a duplicate, not inserted twice', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const { expenseRepository } = await import('../repository');
    type ImportRows = Parameters<typeof expenseRepository.importExpenses>[0];

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

    const second = await expenseRepository.importExpenses(rows, ctx.user.id);
    expect(second).toEqual({ imported: 0, duplicates: 2 });
    expect(expenseCount()).toBe(1);
  });
});
