import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AppContext } from '../../../app-context';
import { repos } from '../../../app-context';
import {
  createTestApp,
  type DataEnvelope,
  json,
  SETUP_TIMEOUT_MS,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function blockExpenseDeletes(): Promise<void> {
  await ctx.sql.run(
    `CREATE TRIGGER test_block_expense_delete BEFORE DELETE ON expenses
     BEGIN SELECT RAISE(ABORT, 'expense delete blocked by test'); END`
  );
}
async function unblockExpenseDeletes(): Promise<void> {
  await ctx.sql.run('DROP TRIGGER IF EXISTS test_block_expense_delete');
}

async function photoCount(): Promise<number> {
  const r = (await ctx.sql.get('SELECT COUNT(*) as n FROM photos')) as { n: number };
  return r.n;
}
async function expenseCount(): Promise<number> {
  const r = (await ctx.sql.get('SELECT COUNT(*) as n FROM expenses')) as { n: number };
  return r.n;
}

async function attachPhoto(expenseId: string, id: string): Promise<void> {
  await ctx.sql.run(
    `INSERT INTO photos (id, entity_type, entity_id, user_id, file_name, mime_type, file_size)
     VALUES (?, 'expense', ?, ?, 'receipt.jpg', 'image/jpeg', 1234)`,
    [id, expenseId, ctx.user.id]
  );
}

describe('expense deletes that also drop photos are atomic', () => {
  test('deleteBySource: a failing expense delete leaves the photo rows intact', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });

    const created = await repos().expenses.create({
      vehicleId,
      userId: ctx.user.id,
      category: 'insurance',
      date: new Date(Date.UTC(2024, 5, 1, 12)),
      expenseAmount: 42_000,
      sourceType: 'insurance_term',
      sourceId: 'term-1',
    } as Parameters<AppContext['repos']['expenses']['create']>[0]);
    await attachPhoto(created.id, 'photo-source-1');

    expect(await photoCount()).toBe(1);

    await blockExpenseDeletes();
    let threw = false;
    try {
      await repos().expenses.deleteBySource('insurance_term', 'term-1', ctx.user.id);
    } catch {
      threw = true;
    } finally {
      await unblockExpenseDeletes();
    }

    expect(threw, 'the blocked expense delete should surface as a throw').toBe(true);
    expect(await expenseCount(), 'the expense survived the failed delete').toBe(1);
    expect(await photoCount(), 'its photo row rolled back with it').toBe(1);
  });

  test('deleteSplitExpense: a failing sibling delete leaves the photo rows intact', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const v2 = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });

    const res = await ctx.authed('POST', '/api/v1/expenses/split', {
      splitConfig: { method: 'even', vehicleIds: [v1, v2] },
      category: 'maintenance',
      date: '2024-06-01T12:00:00.000Z',
      totalAmount: 100,
    });
    const body =
      await json<DataEnvelope<{ groupId: string; siblings: Array<{ id: string }> }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const { groupId } = body.data;
    await attachPhoto(body.data.siblings[0].id, 'photo-split-1');

    expect(await expenseCount()).toBe(2);
    expect(await photoCount()).toBe(1);

    await blockExpenseDeletes();
    let threw = false;
    try {
      await repos().expenses.deleteSplitExpense(groupId, ctx.user.id);
    } catch {
      threw = true;
    } finally {
      await unblockExpenseDeletes();
    }

    expect(threw, 'the blocked sibling delete should surface as a throw').toBe(true);
    expect(await expenseCount(), 'both siblings survived the failed delete').toBe(2);
    expect(await photoCount(), 'the attached photo row rolled back with them').toBe(1);
  });
});
