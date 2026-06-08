/**
 * Regression guard for the clear-optional-field data-loss class (cycles 82-85),
 * newly reachable on the reminder EXPENSE-TEMPLATE fields via the cycle-158
 * expense-type form. When the user switches an expense reminder to notification,
 * the form sends expenseCategory/expenseAmount/expenseTags as null. This proves
 * those actually CLEAR in the DB (column → NULL), not silently keep their old
 * value — the exact failure mode that bit claims/terms/policy-notes/vehicles.
 *
 * Goes through the REAL stack (route merge + re-validate + repo .set()), then
 * reads the row straight off sqlite. createTestApp() rewrites env + dynamic-
 * imports DB-bound modules, so keep static imports to the harness + bun:test.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type DataEnvelope, json, type TestApp } from '../../../test-helpers/http-client';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(() => ctx.close());

async function seedVehicle(): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/vehicles', { make: 'Honda', model: 'Civic', year: 2021 });
  const body = await json<DataEnvelope<{ id: string }>>(res);
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return body.data.id;
}

interface ReminderRowDb {
  id: string;
  type: string;
  expense_category: string | null;
  expense_amount: number | null;
  expense_tags: string | null;
}

function reminderRow(id: string): ReminderRowDb {
  return ctx.sqlite
    .query('SELECT id, type, expense_category, expense_amount, expense_tags FROM reminders WHERE id = ?')
    .get(id) as ReminderRowDb;
}

describe('reminder type switch clears expense-template fields (clear-field class)', () => {
  test('expense → notification nulls expense_category / expense_amount / expense_tags', async () => {
    const vehicleId = await seedVehicle();

    // Create an EXPENSE reminder with a populated template (what the cycle-158 form sends).
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

    // Sanity: the template landed in the DB.
    const before = reminderRow(id);
    expect(before.type).toBe('expense');
    expect(before.expense_category).toBe('financial');
    expect(before.expense_amount).toBe(125.5);

    // Switch to notification, sending the expense fields as null (exactly what
    // ReminderForm submits on a notification edit).
    const updated = await ctx.authed('PUT', `/api/v1/reminders/${id}`, {
      type: 'notification',
      expenseCategory: null,
      expenseAmount: null,
      expenseTags: null,
    });
    const updatedBody = await json<DataEnvelope<{ reminder: unknown }>>(updated);
    expect(updated.status, JSON.stringify(updatedBody)).toBe(200);

    // The columns must now be NULL — not the stale 'financial' / 125.5.
    const after = reminderRow(id);
    expect(after.type).toBe('notification');
    expect(after.expense_category, 'category cleared').toBeNull();
    expect(after.expense_amount, 'amount cleared').toBeNull();
    expect(after.expense_tags, 'tags cleared').toBeNull();
  });

  test('notification → expense sets the template fields', async () => {
    // The reverse direction also round-trips (a notification reminder gains a
    // template when promoted to expense).
    const vehicleId = await seedVehicle();
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

    const after = reminderRow(id);
    expect(after.type).toBe('expense');
    expect(after.expense_category).toBe('maintenance');
    expect(after.expense_amount).toBe(80);
  });
});
