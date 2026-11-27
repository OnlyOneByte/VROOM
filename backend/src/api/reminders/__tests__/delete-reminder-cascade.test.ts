import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
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

async function expensesByIds(ids: string[]): Promise<ExpenseRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return (await ctx.sql.all(
    `SELECT id, expense_amount, source_type, source_id FROM expenses WHERE id IN (${placeholders})`,
    [...ids]
  )) as ExpenseRow[];
}

async function materializedExpenseIds(reminderId: string): Promise<string[]> {
  const rows = (await ctx.sql.all(
    'SELECT id FROM expenses WHERE source_type = ? AND source_id = ?',
    ['reminder', reminderId]
  )) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

describe('reminder delete cascade', () => {
  test('deleting an expense reminder keeps its materialized expenses but clears their source link', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createOverdueExpenseReminder(vehicleId);

    const trigRes = await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(trigRes.status).toBe(200);
    const ids = await materializedExpenseIds(reminderId);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    const countBefore = ids.length;

    const delRes = await ctx.authed('DELETE', `/api/v1/reminders/${reminderId}`);
    expect(delRes.status).toBe(200);

    const remRow = (await ctx.sql.get('SELECT id FROM reminders WHERE id = ?', [reminderId])) as {
      id: string;
    } | null;
    expect(remRow).toBeNull();

    const rows = await expensesByIds(ids);
    expect(rows.length).toBe(countBefore);
    for (const r of rows) {
      expect(r.source_type).toBeNull();
      expect(r.source_id).toBeNull();
      expect(r.expense_amount).toBe(12550);
    }

    expect(await materializedExpenseIds(reminderId)).toHaveLength(0);
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

    expect(await materializedExpenseIds(reminderId)).toHaveLength(0);
  });

  test('a failure clearing the source link fails the delete and keeps the reminder', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createOverdueExpenseReminder(vehicleId);
    const spy = spyOn(repos().expenses, 'clearSource').mockRejectedValue(
      new Error('connection lost')
    );

    try {
      const delRes = await ctx.authed('DELETE', `/api/v1/reminders/${reminderId}`);
      expect(delRes.status).toBeGreaterThanOrEqual(500);
    } finally {
      spy.mockRestore();
    }

    const remRow = await ctx.sql.get('SELECT id FROM reminders WHERE id = ?', [reminderId]);
    expect(remRow).not.toBeNull();
  });
});
