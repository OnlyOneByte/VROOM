import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createTestApp,
  type DataEnvelope,
  json,
  type TestApp,
} from '../../../test-helpers/http-client';
import { seedVehicle } from '../../../test-helpers/seed';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

function blockExpenseDeletes(): void {
  ctx.sqlite.run(
    `CREATE TRIGGER test_block_expense_delete BEFORE DELETE ON expenses
     BEGIN SELECT RAISE(ABORT, 'expense delete blocked by test'); END`
  );
}
function unblockExpenseDeletes(): void {
  ctx.sqlite.run('DROP TRIGGER IF EXISTS test_block_expense_delete');
}

function photoCount(): number {
  const r = ctx.sqlite.query('SELECT COUNT(*) as n FROM photos').get() as { n: number };
  return r.n;
}
function expenseCount(): number {
  const r = ctx.sqlite.query('SELECT COUNT(*) as n FROM expenses').get() as { n: number };
  return r.n;
}

function attachPhoto(expenseId: string, id: string): void {
  ctx.sqlite.run(
    `INSERT INTO photos (id, entity_type, entity_id, user_id, file_name, mime_type, file_size)
     VALUES (?, 'expense', ?, ?, 'receipt.jpg', 'image/jpeg', 1234)`,
    [id, expenseId, ctx.user.id]
  );
}

describe('expense deletes that also drop photos are atomic', () => {
  test('deleteBySource: a failing expense delete leaves the photo rows intact', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const { expenseRepository } = await import('../repository');

    const created = await expenseRepository.create({
      vehicleId,
      userId: ctx.user.id,
      category: 'insurance',
      date: new Date(Date.UTC(2024, 5, 1, 12)),
      expenseAmount: 42_000,
      sourceType: 'insurance_term',
      sourceId: 'term-1',
    } as Parameters<typeof expenseRepository.create>[0]);
    attachPhoto(created.id, 'photo-source-1');

    expect(photoCount()).toBe(1);

    blockExpenseDeletes();
    let threw = false;
    try {
      await expenseRepository.deleteBySource('insurance_term', 'term-1', ctx.user.id);
    } catch {
      threw = true;
    } finally {
      unblockExpenseDeletes();
    }

    expect(threw, 'the blocked expense delete should surface as a throw').toBe(true);
    expect(expenseCount(), 'the expense survived the failed delete').toBe(1);
    expect(photoCount(), 'its photo row rolled back with it').toBe(1);
  });

  test('deleteSplitExpense: a failing sibling delete leaves the photo rows intact', async () => {
    const v1 = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const v2 = await seedVehicle(ctx, { make: 'Toyota', model: 'Camry', year: 2022 });
    const { expenseRepository } = await import('../repository');

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
    attachPhoto(body.data.siblings[0].id, 'photo-split-1');

    expect(expenseCount()).toBe(2);
    expect(photoCount()).toBe(1);

    blockExpenseDeletes();
    let threw = false;
    try {
      await expenseRepository.deleteSplitExpense(groupId, ctx.user.id);
    } catch {
      threw = true;
    } finally {
      unblockExpenseDeletes();
    }

    expect(threw, 'the blocked sibling delete should surface as a throw').toBe(true);
    expect(expenseCount(), 'both siblings survived the failed delete').toBe(2);
    expect(photoCount(), 'the attached photo row rolled back with them').toBe(1);
  });
});
