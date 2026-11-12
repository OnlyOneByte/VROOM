import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
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

async function createOverdueExpenseReminder(vehicleId: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Monthly insurance premium',
    type: 'expense',
    frequency: 'monthly',
    startDate: '2024-01-15T00:00:00.000Z',
    vehicleIds: [vehicleId],
    expenseCategory: 'financial',
    expenseAmount: 125.5,
  });
  const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.reminder.id;
}

interface ExpenseRow {
  id: string;
  expense_amount: number;
  source_type: string | null;
  source_id: string | null;
}

function expensesByIds(ids: string[]): ExpenseRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return ctx.sqlite
    .query(
      `SELECT id, expense_amount, source_type, source_id FROM expenses WHERE id IN (${placeholders})`
    )
    .all(...ids) as ExpenseRow[];
}

function materializedExpenseIds(reminderId: string): string[] {
  const rows = ctx.sqlite
    .query('SELECT id FROM expenses WHERE source_type = ? AND source_id = ?')
    .all('reminder', reminderId) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

describe('reminder delete cascade', () => {
  test('deleting an expense reminder keeps its materialized expenses but clears their source link', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createOverdueExpenseReminder(vehicleId);

    const trigRes = await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(trigRes.status).toBe(200);
    const ids = materializedExpenseIds(reminderId);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    const countBefore = ids.length;

    const delRes = await ctx.authed('DELETE', `/api/v1/reminders/${reminderId}`);
    expect(delRes.status).toBe(200);

    const remRow = ctx.sqlite.query('SELECT id FROM reminders WHERE id = ?').get(reminderId) as {
      id: string;
    } | null;
    expect(remRow).toBeNull();

    const rows = expensesByIds(ids);
    expect(rows.length).toBe(countBefore);
    for (const r of rows) {
      expect(r.source_type).toBeNull();
      expect(r.source_id).toBeNull();
      expect(r.expense_amount).toBe(12550);
    }

    expect(materializedExpenseIds(reminderId)).toHaveLength(0);
  });

  test('deleting a non-expense (notification) reminder is a clean no-op on expenses', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const res = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Oil change',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-01-15T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
    expect(res.status, JSON.stringify(body)).toBe(201);
    const reminderId = body.data.reminder.id;

    const delRes = await ctx.authed('DELETE', `/api/v1/reminders/${reminderId}`);
    expect(delRes.status).toBe(200);

    expect(materializedExpenseIds(reminderId)).toHaveLength(0);
  });

  test('a failure clearing the source link fails the delete and keeps the reminder', async () => {
    const { expenseRepository } = await import('../../expenses/repository');
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createOverdueExpenseReminder(vehicleId);
    const spy = spyOn(expenseRepository, 'clearSource').mockRejectedValue(
      new Error('connection lost')
    );

    try {
      const delRes = await ctx.authed('DELETE', `/api/v1/reminders/${reminderId}`);
      expect(delRes.status).toBeGreaterThanOrEqual(500);
    } finally {
      spy.mockRestore();
    }

    const remRow = ctx.sqlite.query('SELECT id FROM reminders WHERE id = ?').get(reminderId);
    expect(remRow).not.toBeNull();
  });
});
