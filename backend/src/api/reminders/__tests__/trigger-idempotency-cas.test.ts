import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { appContext, repos } from '../../../app-context';
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
    name: 'Monthly premium',
    type: 'expense',
    frequency: 'monthly',
    startDate: '2024-01-15T00:00:00.000Z',
    vehicleIds: [vehicleId],
    expenseCategory: 'financial',
    expenseAmount: 100,
  });
  const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.reminder.id;
}

async function expenseCountForReminder(reminderId: string): Promise<number> {
  const row = (await ctx.sql.get(
    'SELECT COUNT(*) AS n FROM expenses WHERE source_type = ? AND source_id = ?',
    ['reminder', reminderId]
  )) as { n: number };
  return row.n;
}

describe('reminder-trigger idempotency (CAS on nextDueDate)', () => {
  test('re-triggering after the due date advanced past now writes no new expense', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createOverdueExpenseReminder(vehicleId);

    await ctx.authed('POST', '/api/v1/reminders/trigger');
    const first = await expenseCountForReminder(reminderId);
    expect(first).toBeGreaterThanOrEqual(1);

    await ctx.authed('POST', '/api/v1/reminders/trigger');
    await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(await expenseCountForReminder(reminderId)).toBe(first);
  });

  test('advanceNextDueDate ignores a stale expected date', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createOverdueExpenseReminder(vehicleId);

    const before = (await ctx.sql.get('SELECT next_due_date FROM reminders WHERE id = ?', [
      reminderId,
    ])) as { next_due_date: number };

    const staleExpected = new Date(before.next_due_date * 1000 - 86_400_000);
    const newDate = new Date(before.next_due_date * 1000 + 999 * 86_400_000);
    await repos().reminders.advanceNextDueDate(reminderId, staleExpected, newDate);

    const after = (await ctx.sql.get('SELECT next_due_date FROM reminders WHERE id = ?', [
      reminderId,
    ])) as { next_due_date: number };
    expect(after.next_due_date).toBe(before.next_due_date);

    const correctExpected = new Date(before.next_due_date * 1000);
    await repos().reminders.advanceNextDueDate(reminderId, correctExpected, newDate);
    const advanced = (await ctx.sql.get('SELECT next_due_date FROM reminders WHERE id = ?', [
      reminderId,
    ])) as { next_due_date: number };
    expect(advanced.next_due_date).toBe(Math.floor(newDate.getTime() / 1000));
  });

  test('a switched-off reminder cannot be claimed from an earlier read', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createOverdueExpenseReminder(vehicleId);
    const before = (await ctx.sql.get('SELECT next_due_date FROM reminders WHERE id = ?', [
      reminderId,
    ])) as { next_due_date: number };
    await ctx.sql.run('UPDATE reminders SET is_active = FALSE WHERE id = ?', [reminderId]);

    const expected = new Date(before.next_due_date * 1000);
    const claimed = await appContext().asyncDb.transaction((tx) =>
      repos().reminders.claimPeriod(tx, reminderId, expected, new Date(), new Date())
    );

    expect(claimed).toBeNull();
  });
});
