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

async function createOverdueReminder(
  vehicleId: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const res = await ctx.authed('POST', '/api/v1/reminders', {
    name: 'Monthly premium',
    type: 'expense',
    frequency: 'monthly',
    startDate: '2024-01-15T00:00:00.000Z',
    vehicleIds: [vehicleId],
    expenseCategory: 'financial',
    expenseAmount: 100,
    ...overrides,
  });
  const body = await json<DataEnvelope<{ reminder: { id: string } }>>(res);
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.data.reminder.id;
}

async function materializedRows(reminderId: string): Promise<Array<{ date: number; n: number }>> {
  return (await ctx.sql.all(
    `SELECT date, COUNT(*) AS n FROM expenses
       WHERE source_type = 'reminder' AND source_id = ?
       GROUP BY date ORDER BY date`,
    [reminderId]
  )) as Array<{ date: number; n: number }>;
}

async function notificationRows(
  reminderId: string
): Promise<Array<{ due_date: number; n: number }>> {
  return (await ctx.sql.all(
    `SELECT due_date, COUNT(*) AS n FROM reminder_notifications
       WHERE reminder_id = ? GROUP BY due_date ORDER BY due_date`,
    [reminderId]
  )) as Array<{ due_date: number; n: number }>;
}

describe('POST /reminders/trigger under concurrency', () => {
  test('two overlapping triggers materialize each expense period exactly once', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createOverdueReminder(vehicleId);

    const [a, b] = await Promise.all([
      ctx.authed('POST', '/api/v1/reminders/trigger'),
      ctx.authed('POST', '/api/v1/reminders/trigger'),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const periods = await materializedRows(reminderId);
    expect(periods.length).toBeGreaterThan(1);
    const duplicated = periods.filter((p) => p.n !== 1);
    expect(duplicated).toEqual([]);

    const bodyA = await json<DataEnvelope<{ createdExpenses: unknown[] }>>(a);
    const bodyB = await json<DataEnvelope<{ createdExpenses: unknown[] }>>(b);
    const reported = bodyA.data.createdExpenses.length + bodyB.data.createdExpenses.length;
    expect(reported).toBe(periods.length);
  });

  test('two overlapping triggers write each notification period exactly once', async () => {
    const vehicleId = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const reminderId = await createOverdueReminder(vehicleId, {
      type: 'notification',
      expenseCategory: null,
      expenseAmount: null,
    });

    const [a, b] = await Promise.all([
      ctx.authed('POST', '/api/v1/reminders/trigger'),
      ctx.authed('POST', '/api/v1/reminders/trigger'),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const periods = await notificationRows(reminderId);
    expect(periods.length).toBeGreaterThan(1);
    expect(periods.filter((p) => p.n !== 1)).toEqual([]);
  });

  test('a split reminder keeps its legs summing to the group total under concurrency', async () => {
    const first = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const second = await seedVehicle(ctx, { make: 'Mazda', model: '3', year: 2019 });
    const reminderId = await createOverdueReminder(first, {
      vehicleIds: [first, second],
      expenseSplitConfig: { method: 'even', vehicleIds: [first, second] },
    });

    await Promise.all([
      ctx.authed('POST', '/api/v1/reminders/trigger'),
      ctx.authed('POST', '/api/v1/reminders/trigger'),
    ]);

    const groups = (await ctx.sql.all(
      `SELECT group_id, COUNT(*) AS legs, SUM(expense_amount) AS total, MAX(group_total) AS declared
         FROM expenses WHERE source_type = 'reminder' AND source_id = ? GROUP BY group_id`,
      [reminderId]
    )) as Array<{ legs: number; total: number; declared: number }>;
    expect(groups.length).toBeGreaterThan(1);
    for (const group of groups) {
      expect(group.legs).toBe(2);
      expect(group.total).toBe(group.declared);
    }

    const perDate = await materializedRows(reminderId);
    expect(perDate.filter((p) => p.n !== 2)).toEqual([]);
  });
});

describe('a reminder period commits all-or-nothing', () => {
  test('a split leg that cannot be written leaves no partial group and keeps the period due', async () => {
    const live = await seedVehicle(ctx, { make: 'Honda', model: 'Civic', year: 2021 });
    const doomed = await seedVehicle(ctx, { make: 'Mazda', model: '3', year: 2019 });
    const dueDate = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const reminderId = await createOverdueReminder(live, {
      startDate: dueDate,
      vehicleIds: [live, doomed],
      expenseSplitConfig: { method: 'even', vehicleIds: [live, doomed] },
    });

    await ctx.sql.run('DELETE FROM vehicles WHERE id = ?', [doomed]);
    const dueBefore = (await ctx.sql.get(
      'SELECT next_due_date, last_triggered_at FROM reminders WHERE id = ?',
      [reminderId]
    )) as { next_due_date: number; last_triggered_at: number | null };

    const res = await ctx.authed('POST', '/api/v1/reminders/trigger');
    expect(res.status).toBe(200);
    const body =
      await json<
        DataEnvelope<{ createdExpenses: unknown[]; skipped: Array<{ reminderId: string }> }>
      >(res);
    expect(body.data.createdExpenses).toEqual([]);
    expect(body.data.skipped.map((s) => s.reminderId)).toEqual([reminderId]);

    expect(await materializedRows(reminderId)).toEqual([]);
    const dueAfter = (await ctx.sql.get(
      'SELECT next_due_date, last_triggered_at FROM reminders WHERE id = ?',
      [reminderId]
    )) as { next_due_date: number; last_triggered_at: number | null };
    expect(dueAfter.next_due_date).toBe(dueBefore.next_due_date);
    expect(dueAfter.last_triggered_at).toBe(dueBefore.last_triggered_at);
  });
});
