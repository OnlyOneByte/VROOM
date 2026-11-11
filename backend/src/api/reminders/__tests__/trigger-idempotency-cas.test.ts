/**
 * Pins reminder-trigger idempotency. advanceNextDueDate is a compare-and-swap on nextDueDate. A stale
 * expected date matches no rows and is a silent no-op, so the trigger loop must supply the current value.
 */

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

async function createOverdueExpenseReminder(vehicleId: string): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Monthly premium',
    type: 'expense',
    frequency: 'monthly',
    startDate: '2024-01-15T00:00:00.000Z', // past => immediately overdue
    vehicleIds: [vehicleId],
    expenseCategory: 'financial',
    expenseAmount: 100,
  });
  const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.reminder.id;
}

function expenseCountForReminder(reminderId: string): number {
  const row = ctx.sqlite
    .query('SELECT COUNT(*) AS n FROM expenses WHERE source_type = ? AND source_id = ?')
    .get('reminder', reminderId) as { n: number };
  return row.n;
}

describe('reminder-trigger idempotency (CAS on nextDueDate)', () => {
  test('re-triggering after the due date advanced past now writes no new expense', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createOverdueExpenseReminder(vehicleId);

    await ctx.authed('POST', '/api/v1/reminders/trigger');
    const first = expenseCountForReminder(reminderId);
    expect(first).toBeGreaterThanOrEqual(1);

    await ctx.authed('POST', '/api/v1/reminders/trigger');
    await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(expenseCountForReminder(reminderId)).toBe(first);
  });

  test('advanceNextDueDate ignores a stale expected date', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createOverdueExpenseReminder(vehicleId);

    // Read the real current nextDueDate (epoch seconds in sqlite).
    const before = ctx.sqlite
      .query('SELECT next_due_date FROM reminders WHERE id = ?')
      .get(reminderId) as { next_due_date: number };

    // Dynamic import binds to the test database; a static import would bind the production singleton.
    const { reminderRepository } = await import('../repository');

    const staleExpected = new Date(before.next_due_date * 1000 - 86_400_000);
    const newDate = new Date(before.next_due_date * 1000 + 999 * 86_400_000);
    await reminderRepository.advanceNextDueDate(reminderId, staleExpected, newDate);

    const after = ctx.sqlite
      .query('SELECT next_due_date FROM reminders WHERE id = ?')
      .get(reminderId) as { next_due_date: number };
    expect(after.next_due_date).toBe(before.next_due_date);

    const correctExpected = new Date(before.next_due_date * 1000);
    await reminderRepository.advanceNextDueDate(reminderId, correctExpected, newDate);
    const advanced = ctx.sqlite
      .query('SELECT next_due_date FROM reminders WHERE id = ?')
      .get(reminderId) as { next_due_date: number };
    expect(advanced.next_due_date).toBe(Math.floor(newDate.getTime() / 1000));
  });
});
