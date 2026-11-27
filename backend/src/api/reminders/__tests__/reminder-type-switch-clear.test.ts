import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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

interface ReminderRowDb {
  id: string;
  type: string;
  expense_category: string | null;
  expense_amount: number | null;
  expense_tags: string | null;
}

async function reminderRow(id: string): Promise<ReminderRowDb> {
  return (await ctx.sql.get(
    'SELECT id, type, expense_category, expense_amount, expense_tags FROM reminders WHERE id = ?',
    [id]
  )) as ReminderRowDb;
}

describe('reminder type switch clears expense-template fields', () => {
  test('expense → notification nulls expense_category / expense_amount / expense_tags', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });

    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Insurance premium',
      type: 'expense',
      frequency: 'monthly',
      startDate: '2024-01-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
      expenseCategory: 'financial',
      expenseAmount: 125.5,
      expenseTags: ['insurance'],
    });
    const createdBody = await json<DataEnvelope<{ reminder: { id: string } }>>(created);
    expect(created.status, JSON.stringify(createdBody)).toBe(201);
    const id = createdBody.data.reminder.id;

    const before = await reminderRow(id);
    expect(before.type).toBe('expense');
    expect(before.expense_category).toBe('financial');
    expect(before.expense_amount).toBe(12550);

    const updated = await ctx.authed('PUT', `/api/v1/reminders/${id}`, {
      type: 'notification',
      expenseCategory: null,
      expenseAmount: null,
      expenseTags: null,
    });
    const updatedBody = await json<DataEnvelope<{ reminder: unknown }>>(updated);
    expect(updated.status, JSON.stringify(updatedBody)).toBe(200);

    const after = await reminderRow(id);
    expect(after.type).toBe('notification');
    expect(after.expense_category, 'category cleared').toBeNull();
    expect(after.expense_amount, 'amount cleared').toBeNull();
    expect(after.expense_tags, 'tags cleared').toBeNull();
  });

  test('notification → expense sets the template fields', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const created = await ctx.authed('POST', '/api/v1/reminders', {
      name: 'Rotate tires',
      type: 'notification',
      frequency: 'monthly',
      startDate: '2024-01-01T00:00:00.000Z',
      vehicleIds: [vehicleId],
    });
    const id = (await json<DataEnvelope<{ reminder: { id: string } }>>(created)).data.reminder.id;

    const updated = await ctx.authed('PUT', `/api/v1/reminders/${id}`, {
      type: 'expense',
      expenseCategory: 'maintenance',
      expenseAmount: 80,
    });
    expect(updated.status, await updated.text()).toBe(200);

    const after = await reminderRow(id);
    expect(after.type).toBe('expense');
    expect(after.expense_category).toBe('maintenance');
    expect(after.expense_amount).toBe(8000);
  });
});
